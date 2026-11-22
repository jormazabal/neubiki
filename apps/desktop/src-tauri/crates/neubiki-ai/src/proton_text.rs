//! One structured Responses call. The caller owns scope, permissions and document changes.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextAction {
    Answer,
    ReplaceRange,
    ReplaceDocument,
    InsertAt,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextReply {
    pub kind: TextAction,
    pub text: String,
}

pub struct TextCompletion {
    pub reply: Result<TextReply, String>,
    pub usage: Option<Value>,
}

#[derive(Clone, Copy, PartialEq, Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextMode {
    #[default]
    Quick,
    Reasoning,
}

pub struct TextOptions<'a> {
    pub max_output_tokens: u32,
    pub mode: TextMode,
    pub image: Option<&'a str>,
}

fn text_request(
    model: &str,
    instructions: &str,
    input: &Value,
    actions: &[TextAction],
    options: TextOptions<'_>,
) -> Result<Value, String> {
    let mut request = json!({
        "model": model,
        "store": false,
        "input": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": input.to_string()}
        ],
        "max_output_tokens": options.max_output_tokens,
        "text": {"format": {
            "type": "json_schema",
            "name": "neubiki_document_text",
            "strict": true,
            "schema": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": actions},
                    "text": {"type": "string"}
                },
                "required": ["kind", "text"],
                "additionalProperties": false
            }
        }}
    });
    if let Some(image) = options.image {
        neubiki_core::model_catalog::validate(model, "vision")?;
        request["input"][1]["content"] = json!([
            {"type": "input_text", "text": input.to_string()},
            {"type": "input_image", "image_url": image, "detail": "low"}
        ]);
    }
    let efforts =
        neubiki_core::model_catalog::model(model).and_then(|model| model["reasoning"].as_array());
    let effort = match options.mode {
        TextMode::Quick => efforts
            .and_then(|efforts| efforts.first())
            .and_then(Value::as_str),
        TextMode::Reasoning => {
            if !efforts.is_some_and(|efforts| efforts.iter().any(|effort| effort == "medium")) {
                return Err("El modelo de texto seleccionado no admite el modo Razonar.".into());
            }
            Some("medium")
        }
    };
    if let Some(effort) = effort {
        request["reasoning"] = json!({"effort":effort});
    }
    Ok(request)
}

fn read_reply(value: &Value, actions: &[TextAction]) -> Result<TextReply, String> {
    if value["status"] != "completed" {
        return Err("OpenAI no completó la respuesta.".into());
    }
    let reply = extract_response_text(value)
        .and_then(|text| serde_json::from_str::<TextReply>(&text).ok())
        .filter(|reply| {
            actions.contains(&reply.kind)
                && !reply.text.trim().is_empty()
                && reply.text.len() <= 128 * 1024
                && !reply.text.contains('\0')
        })
        .ok_or("OpenAI no devolvió una respuesta completa y válida para esta solicitud.")?;
    Ok(reply)
}

pub fn complete(
    key: &str,
    model: &str,
    instructions: &str,
    input: &Value,
    actions: &[TextAction],
    max_output_tokens: u32,
) -> TextCompletion {
    complete_with_options(
        key,
        model,
        instructions,
        input,
        actions,
        TextOptions {
            max_output_tokens,
            mode: TextMode::Quick,
            image: None,
        },
    )
}

pub fn complete_with_options(
    key: &str,
    model: &str,
    instructions: &str,
    input: &Value,
    actions: &[TextAction],
    options: TextOptions<'_>,
) -> TextCompletion {
    let failed = |message: String| TextCompletion {
        reply: Err(message),
        usage: None,
    };
    if let Err(message) = neubiki_core::model_catalog::validate(model, "text") {
        return failed(message);
    }
    let capability = if options.image.is_some() {
        "vision"
    } else {
        "document_ai"
    };
    let request = match text_request(model, instructions, input, actions, options) {
        Ok(request) => request,
        Err(message) => return failed(message),
    };
    let response = match openai_client(key)
        .post("https://api.openai.com/v1/responses")
        .json(&request)
        .send()
    {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            return failed(format!(
                "OpenAI rechazó la solicitud (HTTP {}).",
                response.status()
            ));
        }
        Err(_) => {
            return failed("No se recibió respuesta de OpenAI. Comprueba la conexión.".into())
        }
    };
    let Ok(value) = response.json::<Value>() else {
        return failed("No se pudo leer la respuesta de OpenAI.".into());
    };
    TextCompletion {
        reply: read_reply(&value, actions),
        usage: provider_usage_record(capability, model, &value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proton_text_request_disables_storage_and_only_advertises_allowed_actions() {
        let request = text_request(
            "gpt-5.4-mini",
            "Translate text",
            &json!({"markdown": "Hello"}),
            &[TextAction::ReplaceRange],
            TextOptions {
                max_output_tokens: 4000,
                mode: TextMode::Quick,
                image: None,
            },
        )
        .unwrap();
        assert_eq!(request["store"], false);
        assert_eq!(request["reasoning"]["effort"], "low");
        assert!(request.get("tools").is_none());
        assert_eq!(request["input"][1]["content"], r#"{"markdown":"Hello"}"#);
        assert_eq!(request["text"]["format"]["strict"], true);
        assert_eq!(
            request["text"]["format"]["schema"]["properties"]["kind"]["enum"],
            json!(["replace_range"])
        );
    }

    #[test]
    fn proton_text_reasoning_stays_direct_and_uses_declared_catalog_effort() {
        let actions = [TextAction::Answer];
        let request = text_request(
            "gpt-5.4-mini",
            "Analyze",
            &json!({}),
            &actions,
            TextOptions {
                max_output_tokens: 8000,
                mode: TextMode::Reasoning,
                image: None,
            },
        )
        .unwrap();
        assert_eq!(request["reasoning"]["effort"], "medium");
        assert_eq!(request["store"], false);
        assert_eq!(request["max_output_tokens"], 8000);
        assert!(request.get("tools").is_none());
        assert!(text_request(
            "gpt-image-2.5-flare",
            "Analyze",
            &json!({}),
            &actions,
            TextOptions {
                max_output_tokens: 8000,
                mode: TextMode::Reasoning,
                image: None
            },
        )
        .is_err());
    }

    #[test]
    fn proton_text_vision_adds_one_explicit_image_to_the_structured_request() {
        let request = text_request(
            "gpt-6.1-terra",
            "Describe",
            &json!({"sources":[{"name":"Figura.png"}]}),
            &[TextAction::Answer],
            TextOptions {
                max_output_tokens: 4000,
                mode: TextMode::Quick,
                image: Some("data:image/png;base64,c3ludGhldGlj"),
            },
        )
        .unwrap();
        let content = request["input"][1]["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "input_text");
        assert_eq!(content[1]["type"], "input_image");
        assert_eq!(content[1]["detail"], "low");
        assert_eq!(request["store"], false);
        assert!(request.get("tools").is_none());
    }

    #[test]
    fn proton_text_response_rejects_partial_wrong_kind_and_extra_operations() {
        let allowed = [TextAction::Answer];
        for output in [
            r#"{"kind":"replace_range","text":"a"}"#,
            r#"{"kind":"answer","text":" "}"#,
            r#"{"kind":"answer","text":"a","path":"other.md"}"#,
        ] {
            assert!(read_reply(
                &json!({"status":"completed","output_text":output}),
                &allowed
            )
            .is_err());
        }
        let mut value = json!({
            "status": "incomplete",
            "output_text": r#"{"kind":"answer","text":"a"}"#
        });
        assert!(read_reply(&value, &allowed).is_err());
        value["status"] = json!("completed");
        assert_eq!(read_reply(&value, &allowed).unwrap().text, "a");
    }
}

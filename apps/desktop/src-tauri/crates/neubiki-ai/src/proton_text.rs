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

fn text_request(
    model: &str,
    instructions: &str,
    input: &Value,
    actions: &[TextAction],
    max_output_tokens: u32,
) -> Value {
    let mut request = json!({
        "model": model,
        "store": false,
        "input": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": input.to_string()}
        ],
        "max_output_tokens": max_output_tokens,
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
    if let Some(effort) = neubiki_core::model_catalog::model(model)
        .and_then(|model| model["reasoning"].get(0))
        .and_then(Value::as_str)
    {
        request["reasoning"] = json!({"effort":effort});
    }
    request
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
    let failed = |message: String| TextCompletion {
        reply: Err(message),
        usage: None,
    };
    if let Err(message) = neubiki_core::model_catalog::validate(model, "text") {
        return failed(message);
    }
    let request = text_request(model, instructions, input, actions, max_output_tokens);
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
        usage: provider_usage_record("document_ai", model, &value),
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
            4000,
        );
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

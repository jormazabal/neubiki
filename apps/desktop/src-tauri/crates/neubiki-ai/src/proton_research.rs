use super::*;
use std::collections::BTreeSet;

pub const OUTPUT_TOKENS: u32 = 4000;
pub const WEB_CALL_USD: f64 = 0.01;

pub struct ResearchCompletion {
    pub report: Result<Value, String>,
    pub usage: Option<Value>,
}

fn request(model: &str, question: &str) -> Value {
    json!({
        "model":model, "store":false, "max_output_tokens":OUTPUT_TOKENS,
        "max_tool_calls":1,
        "tools":[{"type":"web_search","search_context_size":"low"}],
        "tool_choice":"required",
        "input":[
            {"role":"system","content":"Answer the research question in the user's language. Use only evidence found in the web search. Cite relevant claims using the web tool citations. State limitations and uncertainty. Never request additional tools or actions. Keep the report concise."},
            {"role":"user","content":question}
        ]
    })
}

fn parse_report(response: &Value, source_limit: usize) -> Result<Value, String> {
    if response["status"] != "completed" {
        return Err("OpenAI no confirmó un informe completo.".into());
    }
    let output = response["output"]
        .as_array()
        .ok_or("Faltan los resultados de la investigación.")?;
    if output
        .iter()
        .filter(|item| item["type"] == "web_search_call" && item["status"] == "completed")
        .count()
        != 1
    {
        return Err("El proveedor no confirmó la búsqueda web solicitada.".into());
    }
    let mut sources = Vec::new();
    let mut seen = BTreeSet::new();
    for item in output.iter().filter(|item| item["role"] == "assistant") {
        for content in item["content"].as_array().into_iter().flatten() {
            for citation in content["annotations"].as_array().into_iter().flatten() {
                if citation["type"] != "url_citation" {
                    continue;
                }
                let Some(url) = citation["url"]
                    .as_str()
                    .filter(|value| value.len() <= 2048)
                    .and_then(|value| reqwest::Url::parse(value).ok())
                else {
                    continue;
                };
                if url.scheme() != "https"
                    || url.host_str().is_none()
                    || !url.username().is_empty()
                    || url.password().is_some()
                {
                    continue;
                }
                if !seen.insert(url.as_str().to_owned()) {
                    continue;
                }
                let title = citation["title"]
                    .as_str()
                    .filter(|title| {
                        !title.trim().is_empty()
                            && title.len() <= 512
                            && !title.chars().any(char::is_control)
                    })
                    .or_else(|| url.host_str())
                    .unwrap_or("Fuente");
                sources.push(json!({"url":url.as_str(),"title":title}));
            }
        }
    }
    let report = extract_response_text(response)
        .filter(|text| !text.trim().is_empty() && text.len() <= 32 * 1024 && !text.contains('\0'))
        .ok_or("OpenAI no devolvió texto válido para el informe.")?;
    if sources.is_empty() {
        return Err("La respuesta no incluyó citas de la búsqueda que se puedan comprobar.".into());
    }
    let limited = sources.len() > source_limit;
    sources.truncate(source_limit);
    Ok(json!({"report":report,"sources":sources,"limited":limited}))
}

pub fn complete(key: &str, model: &str, question: &str, source_limit: usize) -> ResearchCompletion {
    let failed = |message: String| ResearchCompletion {
        report: Err(message),
        usage: None,
    };
    if let Err(message) = neubiki_core::model_catalog::validate(model, "text") {
        return failed(message);
    }
    let response = match openai_client(key)
        .post("https://api.openai.com/v1/responses")
        .json(&request(model, question))
        .send()
    {
        Ok(response) if response.status().is_success() => response,
        _ => return failed(
            "OpenAI no confirmó la investigación. Comprueba el consumo antes de volver a enviarla."
                .into(),
        ),
    };
    let Ok(value) = response.json::<Value>() else {
        return failed("No se pudo leer el resultado de la investigación.".into());
    };
    let mut usage = provider_usage_record("agentic_tasks", model, &value);
    let web_call = value["output"].as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item["type"] == "web_search_call" && item["status"] == "completed")
    });
    if web_call {
        if let Some(entry) = &mut usage {
            if let Some(cost) = entry["estimatedCost"].as_f64() {
                entry["estimatedCost"] = json!(cost + WEB_CALL_USD);
            }
        }
    }
    ResearchCompletion {
        report: parse_report(&value, source_limit),
        usage,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proton_research_requires_one_search_and_returns_only_provider_citations() {
        let sent = request("gpt-6.1-sol", "Public question");
        assert_eq!(sent["max_tool_calls"], 1);
        assert_eq!(sent["store"], false);
        assert_eq!(sent["input"][1]["content"], "Public question");
        let mut response = json!({"status":"completed","output":[
            {"type":"web_search_call","status":"completed"},
            {"type":"message","role":"assistant","content":[{"type":"output_text",
              "text":"Markdown mentions https://example.test/unverified",
              "annotations":[
                {"type":"url_citation","url":"https://example.test/verified","title":"Evidence"},
                {"type":"url_citation","url":"https://user:secret@example.test/hidden","title":"Private"}
              ]
            }]}
        ]});
        let parsed = parse_report(&response, 8).unwrap();
        assert_eq!(
            parsed["sources"],
            json!([{"url":"https://example.test/verified","title":"Evidence"}])
        );
        response["output"][0]["status"] = json!("failed");
        assert!(parse_report(&response, 8).is_err());
    }
}

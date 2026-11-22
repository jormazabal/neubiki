//! Adapt native failures to the correlated v1 command contract.
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum OperationOutcome {
    NotStarted,
    NotApplied,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeFailure {
    pub(crate) status: u16,
    pub(crate) code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation_outcome: Option<OperationOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation_id: Option<String>,
}

impl RuntimeFailure {
    pub(crate) fn new(status: u16, code: &'static str, outcome: Option<OperationOutcome>) -> Self {
        Self {
            status,
            code,
            operation_outcome: outcome,
            operation_id: None,
        }
    }

    pub(crate) fn rejected(status: u16, code: &'static str) -> Self {
        Self::new(status, code, Some(OperationOutcome::NotStarted))
    }

    pub(crate) fn window_denied() -> Self {
        Self::rejected(403, "runtime-window-denied")
    }

    pub(crate) fn unconfirmed(code: &'static str) -> Self {
        Self::new(500, code, Some(OperationOutcome::Unknown))
    }

    pub(crate) fn service(code: &'static str, may_change_state: bool) -> Self {
        Self::new(
            500,
            code,
            may_change_state.then_some(OperationOutcome::Unknown),
        )
    }

    pub(crate) fn service_failure(
        error: &str,
        fallback: &'static str,
        may_change_state: bool,
    ) -> Self {
        let code = match error {
            "operation-stopped-before-publication" => "operation-stopped-before-publication",
            "github-session-changed" => "github-session-changed",
            _ => return Self::service(fallback, may_change_state),
        };
        Self::new(409, code, Some(OperationOutcome::NotApplied))
    }

    pub(crate) fn with_id(mut self, id: Option<&str>) -> Self {
        self.operation_id = id
            .filter(|id| {
                id.starts_with("operation-")
                    && (20..=80).contains(&id.len())
                    && id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            })
            .map(str::to_owned);
        self
    }

    pub(crate) fn admission(code: &str, id: Option<&str>) -> Self {
        let failure = match code {
            "invalid-runtime-request" => Self::rejected(400, "invalid-runtime-request"),
            "invalid-operation-id" => Self::rejected(400, "invalid-operation-id"),
            "invalid-operation-resource" => Self::rejected(400, "invalid-operation-resource"),
            "runtime-restart-reserved" => Self::rejected(409, "runtime-restart-reserved"),
            "operation-queue-full" => Self::rejected(503, "operation-queue-full"),
            "operation-cancelled" => Self::rejected(409, "operation-cancelled"),
            "operation-expired" => Self::rejected(409, "operation-expired"),
            "operation-not-found" => {
                Self::new(404, "operation-not-found", Some(OperationOutcome::Unknown))
            }
            "operation-registry-unavailable" => Self::new(
                503,
                "operation-registry-unavailable",
                Some(OperationOutcome::Unknown),
            ),
            "operation-already-registered" => Self::new(
                409,
                "operation-already-registered",
                Some(OperationOutcome::Unknown),
            ),
            "operation-already-started" => Self::new(
                409,
                "operation-already-started",
                Some(OperationOutcome::Unknown),
            ),
            _ => Self::new(
                503,
                "runtime-request-failed",
                Some(OperationOutcome::Unknown),
            ),
        };
        failure.with_id(id)
    }
}

/// Stable domains for older services whose return type carries only free text.
/// Never infer meaning, retryability or permissions from that text.
pub(crate) fn request_code(path: &str) -> &'static str {
    let path = path.split('?').next().unwrap_or(path);
    let parts: Vec<_> = path.trim_matches('/').split('/').collect();
    match parts.as_slice() {
        ["api", "proton", "accounts", ..] => "proton-account-failed",
        ["api", "proton", "ai", ..] | ["api", "ai", ..] | ["api", "transcription"] => {
            "proton-ai-request-failed"
        }
        ["api", "proton", "handwritten", ..] => "proton-note-ai-failed",
        ["api", "proton", "meetings", ..] => "proton-meeting-failed",
        ["api", "proton", "workspace", "recovery-list" | "recovery-read" | "recovery-remove-copy"]
        | ["api", "recovery", ..] => "proton-recovery-failed",
        ["api", "proton", "packages" | "export-batches" | "templates" | "export", ..] => {
            "runtime-transfer-failed"
        }
        ["api", "config", ..] | ["api", "runtime", ..] => "runtime-settings-failed",
        _ => "runtime-request-failed",
    }
}

pub(crate) fn runtime_reply<T: Serialize>(
    id: &str,
    result: Result<T, RuntimeFailure>,
    fallback_code: &'static str,
    may_change_state: bool,
) -> Result<Value, RuntimeFailure> {
    let response = match result {
        Ok(response) => serde_json::to_value(response).map_err(|_| {
            RuntimeFailure::unconfirmed("invalid-runtime-response").with_id(Some(id))
        })?,
        Err(failure) => json!({"status":failure.status,"body":failure}),
    };
    let mut response = response;
    let object = response
        .as_object_mut()
        .ok_or_else(|| RuntimeFailure::unconfirmed("invalid-runtime-response").with_id(Some(id)))?;
    if object
        .get("status")
        .and_then(Value::as_u64)
        .is_some_and(|status| status >= 400)
    {
        // Structured service failures already include their original code, status
        // and domain metadata. A legacy uncoded or binary failure has only a
        // safe operation category, since raw details may contain private data.
        let mut body = object
            .remove("body")
            .filter(|body| body["code"].as_str().is_some_and(|code| !code.is_empty()))
            .unwrap_or_else(|| json!({"code":fallback_code}));
        if let Some(body) = body.as_object_mut() {
            body.entry("operationId").or_insert_with(|| json!(id));
            if may_change_state {
                body.entry("operationOutcome")
                    .or_insert_with(|| json!(OperationOutcome::Unknown));
            }
        }
        object.insert("body".into(), body);
        object.remove("dataBase64");
    }
    object.insert("protocolVersion".into(), json!(1));
    object.insert("operationId".into(), json!(id));
    object.insert("completedAt".into(), json!(neubiki_core::now_iso()));
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_categories_and_window_denials_need_no_untrusted_message() {
        assert_eq!(
            request_code("/api/proton/handwritten/ocr"),
            "proton-note-ai-failed"
        );
        assert_eq!(
            request_code("/api/proton/packages/restore/review?ignored=private"),
            "runtime-transfer-failed"
        );
        let denied = json!(RuntimeFailure::window_denied());
        assert_eq!(denied["code"], "runtime-window-denied");
        assert_eq!(denied["status"], 403);
        assert_eq!(denied["operationOutcome"], "not-started");
    }

    #[test]
    fn errors_join_the_same_correlated_envelope_as_success() {
        let id = "operation-contract-v1";
        let failure = RuntimeFailure::unconfirmed("proton-ai-request-failed");
        let response =
            runtime_reply::<Value>(id, Err(failure), "runtime-request-failed", true).unwrap();
        assert_eq!(response["status"], 500);
        assert_eq!(response["protocolVersion"], 1);
        assert_eq!(response["operationId"], id);
        assert_eq!(response["body"]["operationId"], id);
        assert_eq!(response["body"]["operationOutcome"], "unknown");
        assert_eq!(response["body"]["code"], "proton-ai-request-failed");
    }

    #[test]
    fn preserves_structured_metadata_and_excludes_uncoded_binary_payloads() {
        let id = "operation-contract-v1";
        let known = json!({"status":409, "body":{
            "code":"proton-operation-missing","operationId":"domain-receipt-1",
            "operationOutcome":"not-applied","receipt":{"checked":true}
        }});
        let reply = runtime_reply(id, Ok(known), "runtime-request-failed", true).unwrap();
        assert_eq!(reply["body"]["operationId"], "domain-receipt-1");
        assert_eq!(reply["body"]["operationOutcome"], "not-applied");
        assert_eq!(reply["body"]["receipt"]["checked"], true);

        let uncoded =
            json!({"status":404,"dataBase64":"private-payload","body":{"detail":"private-path"}});
        let reply = runtime_reply(id, Ok(uncoded), "runtime-content-unavailable", false).unwrap();
        assert_eq!(reply["status"], 404);
        assert_eq!(reply["body"]["code"], "runtime-content-unavailable");
        assert!(reply["body"]["operationOutcome"].is_null());
        assert!(!reply.to_string().contains("private"));
    }

    #[test]
    fn duplicate_admission_cannot_claim_that_the_original_attempt_never_started() {
        let id = "operation-contract-v1";
        let duplicate = json!(RuntimeFailure::admission(
            "operation-already-registered",
            Some(id)
        ));
        assert_eq!(duplicate["code"], "operation-already-registered");
        assert_eq!(duplicate["operationOutcome"], "unknown");
        assert_eq!(duplicate["operationId"], id);
        let rejected = json!(RuntimeFailure::admission(
            "invalid-operation-id",
            Some("private-path")
        ));
        assert_eq!(rejected["operationOutcome"], "not-started");
        assert!(rejected.get("operationId").is_none());

        let stopped = json!(RuntimeFailure::service_failure(
            "operation-stopped-before-publication",
            "runtime-request-failed",
            true,
        ));
        assert_eq!(stopped["code"], "operation-stopped-before-publication");
        assert_eq!(stopped["operationOutcome"], "not-applied");
    }
}

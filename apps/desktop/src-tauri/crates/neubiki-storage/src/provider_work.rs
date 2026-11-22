//! Legacy prompt/audio requests only return a proposal and a usage receipt.
//! They do not need the document mutation authority while a provider responds.
use super::*;
pub fn is_provider_work(method: &str, path: &str) -> bool {
    if !method.eq_ignore_ascii_case("POST") {
        return false;
    }
    let (path, _) = split_path(path);
    let parts: Vec<_> = path.trim_matches('/').split('/').collect();
    matches!(
        parts.as_slice(),
        ["api", "transcription"]
            | ["api", "proton", "ai", "text" | "image" | "dictation" | "research-run" | "replacement-suggestion-run" | "semantic-run" | "batch-edit-run"]
            | ["api", "proton", "handwritten", "ocr" | "drawing" | "transcription"]
            | ["api", "proton", "meetings", _, "summary"]
            | ["api", "handwritten-notes", _, "ocr"]
            | ["api", "documents", _, "ai", "prompt"]
            | ["api", "projects", _, "ai", "prompt"]
            | ["api", "projects", _, "ai", "research", "brief"]
    )
}

pub fn is_proton_ai_review_work(method: &str, path: &str) -> bool {
    if method != "POST" {
        return false;
    }
    let (path, _) = split_path(path);
    matches!(path.as_str(), "/api/proton/ai/research-review" | "/api/proton/ai/research-status" | "/api/proton/ai/replacement-suggestion-review" | "/api/proton/ai/semantic-review" | "/api/proton/ai/batch-edit-review")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proton_ai_review_and_paid_execution_use_separate_routes() {
        for workflow in ["research", "replacement-suggestion", "semantic", "batch-edit"] {
            let review = format!("/api/proton/ai/{workflow}-review");
            let execution = format!("/api/proton/ai/{workflow}-run");
            assert!(is_proton_ai_review_work("POST", &review));
            assert!(!is_provider_work("POST", &review));
            assert!(is_provider_work("POST", &execution));
            assert!(!is_proton_ai_review_work("POST", &execution));
        }
        assert!(!is_proton_ai_review_work("GET", "/api/proton/ai/semantic-review"));
        assert!(is_proton_ai_review_work("POST", "/api/proton/ai/research-status"));
        assert!(!is_provider_work("POST", "/api/proton/ai/research-status"));
        assert!(!is_provider_work("POST", "/api/proton/ai/research-report-delete"));
    }
}

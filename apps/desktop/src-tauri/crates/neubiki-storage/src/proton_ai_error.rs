//! Carry the stage of an AI failure without exposing provider requests or responses.
use super::LocalApiResponse;
use serde_json::json;

#[derive(Debug)]
pub(super) struct ProtonAiFailure {
    status: u16,
    code: &'static str,
    detail: &'static str,
    outcome: &'static str,
}

impl ProtonAiFailure {
    pub(super) fn before(status: u16, code: &'static str, detail: &'static str) -> Self {
        Self {
            status,
            code,
            detail,
            outcome: "not-started",
        }
    }

    pub(super) fn invalid_input() -> Self {
        Self::before(
            400,
            "proton-ai-input-invalid",
            "Revisa el contenido y las opciones de la solicitud de IA.",
        )
    }

    pub(super) fn settings() -> Self {
        Self::before(
            503,
            "runtime-settings-failed",
            "No se pudo comprobar la configuración de IA.",
        )
    }

    pub(super) fn key_required() -> Self {
        Self::before(
            401,
            "proton-ai-key-required",
            "Configura la clave de OpenAI en Ajustes de IA.",
        )
    }

    pub(super) fn model_required() -> Self {
        Self::before(
            400,
            "proton-ai-model-required",
            "Configura un modelo compatible en Ajustes de IA.",
        )
    }

    pub(super) fn budget() -> Self {
        Self::before(
            409,
            "proton-ai-budget-unavailable",
            "El envío está detenido. Revisa los permisos y el presupuesto en Consumo de IA.",
        )
    }

    pub(super) fn target_changed() -> Self {
        Self::before(
            409,
            "proton-ai-target-changed",
            "La solicitud no coincide con el documento actual. Vuelve a abrir la herramienta.",
        )
    }

    pub(super) fn secret_present() -> Self {
        Self::before(
            400,
            "proton-ai-secret-present",
            "Retira la clave de OpenAI del contenido antes de enviarlo.",
        )
    }

    pub(super) fn provider_unconfirmed() -> Self {
        Self {
            status: 502,
            code: "proton-ai-provider-unconfirmed",
            detail: "No se pudo confirmar un resultado válido. Comprueba el consumo antes de volver a enviar.",
            outcome: "unknown",
        }
    }

    pub(super) fn response(self) -> LocalApiResponse {
        LocalApiResponse {
            status: self.status,
            body: json!({"code":self.code,"detail":self.detail,"operationOutcome":self.outcome}),
        }
    }

    pub(super) fn detail(&self) -> &'static str {
        self.detail
    }
}

use neubiki_storage::{LocalApi, LocalApiFile, LocalApiResponse};
use std::sync::Mutex;

// Audited snapshots bypass mutations; the separate AI queue preserves provider
// serialisation while the main text response waits outside mutation authority.
pub(crate) struct LocalApiState(
    pub(crate) Mutex<LocalApi>,
    pub(crate) LocalApi,
    pub(crate) Mutex<()>,
    pub(crate) Mutex<()>,
    pub(crate) Mutex<()>,
);
// Only association changes and recording commands share this gate. Ordinary
// document edits/saves do not wait for audio controls.

impl LocalApiState {
    pub(crate) fn request(&self, request: LocalApiRequest) -> Result<LocalApiResponse, String> {
        if let Some(failure) = self.1.request_scope_failure(&request.method, &request.path) {
            return Ok(failure);
        }
        // Remote workspace requests manage their private recovery ordering.
        // A network wait must leave local draft intake available.
        if request.method == "POST" && request.path.starts_with("/api/proton/workspace/") {
            return self.1.handle(
                &request.method,
                &request.path,
                request.body.unwrap_or(serde_json::Value::Null),
                request.files.unwrap_or_default(),
            );
        }
        if neubiki_storage::is_scheduled_backup_work(&request.method, &request.path) {
            return self.1.handle(&request.method, &request.path, request.body.unwrap_or(serde_json::Value::Null), request.files.unwrap_or_default());
        }
        if request.method == "POST" && request.path.starts_with("/api/proton/templates/shared/") {
            let _queue = self.3.lock().map_err(|_| "No se puede reservar el catálogo de plantillas")?;
            return self.1.handle(&request.method, &request.path, request.body.unwrap_or_default(), vec![]);
        }
        if request.method == "POST" && matches!(request.path.as_str(), "/api/proton/templates/package"|"/api/proton/templates/source/prepare"|"/api/proton/templates/capture"|"/api/proton/templates/capture/check") {
            let _queue=self.3.lock().map_err(|_|"No se puede reservar la plantilla")?;
            return self.1.handle(&request.method,&request.path,request.body.unwrap_or(serde_json::Value::Null),vec![]);
        }
        if neubiki_storage::is_proton_restore_work(&request.method, &request.path) {
            let _queue=self.3.lock().map_err(|_|"No se puede reservar la restauración")?;
            return neubiki_storage::dispatch_proton_restore(&self.1,&request.path,request.body.unwrap_or(serde_json::Value::Null));
        }
        if neubiki_storage::is_proton_package_work(&request.method, &request.path) {
            let _queue=self.3.lock().map_err(|_|"No se puede reservar la copia")?;
            return neubiki_storage::dispatch_proton_package(&self.1,request.body.unwrap_or(serde_json::Value::Null));
        }
        if neubiki_storage::is_proton_backup_work(&request.method, &request.path) {
            let Ok(_queue) = self.3.try_lock() else {
                return Ok(LocalApiResponse { status: 200, body: serde_json::Value::Null });
            };
            return neubiki_storage::dispatch_proton_backup(&self.1, request.body.unwrap_or(serde_json::Value::Null));
        }
        if neubiki_storage::is_proton_export_batch_work(&request.method, &request.path) {
            let _queue = self.3.lock().map_err(|_| "No se puede reservar la exportación")?;
            return neubiki_storage::dispatch_proton_export_batch(&self.1, request.body.unwrap_or(serde_json::Value::Null));
        }
        if neubiki_storage::is_proton_ai_review_work(&request.method, &request.path) {
            return self.1.handle(&request.method, &request.path, request.body.unwrap_or_default(), vec![]);
        }
        if neubiki_storage::is_export_batch_work(&request.method,&request.path){let _queue=self.3.lock().map_err(|_|"No se puede reservar la exportación")?;let project=request.path.trim_matches('/').split('/').nth(2).map(neubiki_core::percent_decode).ok_or("Proyecto no válido")?;return neubiki_storage::dispatch_export_batch(&self.0,&self.1,&project,request.body.unwrap_or(serde_json::Value::Null));}
        if neubiki_storage::is_slow_runtime_work(&request.method,&request.path){return neubiki_storage::dispatch_slow_runtime(&self.0,&self.1,&request.method,&request.path,request.body.unwrap_or(serde_json::Value::Null));}
        if neubiki_storage::asset_work_request(&request.method,&request.path).is_some(){
            return neubiki_storage::dispatch_asset_work(&self.0,&self.3,&request.method,&request.path,request.files.unwrap_or_default());
        }
        if neubiki_storage::is_provider_work(&request.method, &request.path) {
            let _private=self.1.private_work()?;
            let _provider = self
                .2
                .lock()
                .map_err(|_| "No se puede reservar la operación de IA")?;
            return self.1.handle(
                &request.method,
                &request.path,
                request.body.unwrap_or(serde_json::Value::Null),
                request.files.unwrap_or_default(),
            );
        }
        if let Some(project) =
            neubiki_storage::index_rebuild_project(&request.method, &request.path)
        {
            return neubiki_storage::dispatch_index_rebuild(&self.0, &self.4, &project);
        }
        if neubiki_storage::is_project_lifecycle_work(&request.method, &request.path) {
            return neubiki_storage::dispatch_project_lifecycle(
                &self.0,
                &self.1,
                &request.method,
                &request.path,
                request.body.unwrap_or(serde_json::Value::Null),
            );
        }
        if neubiki_storage::is_portable_history_work(&request.method, &request.path) {
            let _work = self
                .3
                .lock()
                .map_err(|_| "No se puede reservar la preparación del historial")?;
            return self.1.handle(
                &request.method,
                &request.path,
                request.body.unwrap_or(serde_json::Value::Null),
                vec![],
            );
        }
        if neubiki_storage::is_project_transfer_work(&request.method, &request.path) {
            return neubiki_storage::dispatch_project_transfer(
                &self.0,
                &self.1,
                &self.3,
                &request.path,
                request.body.unwrap_or(serde_json::Value::Null),
            );
        }
        if neubiki_storage::is_export_request(&request.method, &request.path) {
            return neubiki_storage::dispatch_export(
                &self.0,
                &self.3,
                &request.path,
                request.body.unwrap_or(serde_json::Value::Null),
            );
        }
        if let Some(project) =
            neubiki_storage::interaction_project_id(&request.method, &request.path)
        {
            return neubiki_storage::dispatch_interaction(
                &self.0,
                &self.2,
                &project,
                request.body.unwrap_or(serde_json::Value::Null),
            );
        }
        if neubiki_storage::is_recovery_lifecycle_work(&request.method,&request.path){
            let _transfer=self.3.lock().map_err(|_|"No se pudo reservar la conservación")?;
            return self.1.handle(&request.method,&request.path,request.body.unwrap_or(serde_json::Value::Null),vec![]);
        }
        if LocalApi::is_independent_snapshot(&request.method, &request.path) {
            return self.1.handle(
                &request.method,
                &request.path,
                request.body.unwrap_or(serde_json::Value::Null),
                request.files.unwrap_or_default(),
            );
        }
        self.0.lock().map_err(|error| error.to_string())?.handle(
            &request.method,
            &request.path,
            request.body.unwrap_or(serde_json::Value::Null),
            request.files.unwrap_or_default(),
        )
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase",deny_unknown_fields)]
pub(crate) struct LocalApiRequest {
    pub(crate) method: String,
    pub(crate) path: String,
    pub(crate) body: Option<serde_json::Value>,
    pub(crate) files: Option<Vec<LocalApiFile>>,
}

//! A portable import stays in native staging. Only a scoped restore-as-copy can create remote entries.
use super::*;
pub fn is_proton_restore_work(method: &str, path: &str) -> bool {
    method == "POST"
        && matches!(
            path.trim_matches('/')
                .split('/')
                .collect::<Vec<_>>()
                .as_slice(),
            [
                "api",
                "proton",
                "packages",
                "restore",
                "review" | "apply" | "check"
            ]
        )
}
pub fn dispatch_proton_restore(api: &LocalApi, path: &str, body: Value) -> ApiResult {
    let action = path
        .trim_matches('/')
        .rsplit('/')
        .next()
        .ok_or("Acción no válida")?;
    ok(api.proton_package_restore(action, body)?)
}
impl LocalApi {
    pub(crate) fn proton_package_restore(
        &self,
        action: &str,
        body: Value,
    ) -> Result<Value, String> {
        validate_runtime_input(&body, &[])?;
        self.proton_batch_scope(&body)?;
        let id = body["transferId"]
            .as_str()
            .ok_or("Elige un paquete preparado")?;
        let job = jobs::read(self, id)?;
        if job.kind != jobs::Kind::Import
            || job.phase != jobs::Phase::Ready
            || job.template_catalogue
            || job.archive_sha256.as_deref() != body["archiveSha256"].as_str()
        {
            return Err("El paquete ya no coincide con la revisión preparada".into());
        }
        let manifest = job
            .manifest
            .as_ref()
            .ok_or("Falta la revisión del paquete")?;
        if manifest.schema_version != 1 || manifest.supplement.is_some() {
            return Err("La restauración en Proton admite paquetes de documentos sin archivo privado. No se incorporan ajustes, grabaciones ni conversaciones.".into());
        }
        if manifest.files.len() > 32
            || manifest.directories.len() > 32
            || manifest
                .files
                .iter()
                .any(|file| file.size > 8 * 1024 * 1024)
            || manifest.files.iter().map(|file| file.size).sum::<u64>() > 128 * 1024 * 1024
            || manifest
                .directories
                .iter()
                .any(|path| path.matches('/').count() >= 12)
        {
            return Err("La restauración admite hasta32 archivos y32 carpetas,8MiB por archivo y128MiB en total.".into());
        }
        let directory = jobs::folder(self, id)?;
        if matches!(action, "review" | "apply") {
            let payload = directory.join("payload.zip");
            let (_, digest) = worker::file_hash(&payload, &|| Ok(()))?;
            if job.archive_sha256.as_deref() != Some(digest.as_str())
                || archive::inspect(&payload)? != *manifest
            {
                return Err("El paquete preparado cambió. No se crea ninguna copia.".into());
            }
        }
        let stage = directory.join(
            job.staged_folder
                .as_deref()
                .ok_or("Falta el contenido verificado")?,
        );
        jobs::regular_directory(&stage)?;
        let source = |path: &str| -> Result<Vec<u8>, String> {
            let file = manifest
                .files
                .iter()
                .find(|file| file.path == path)
                .ok_or("Archivo fuera del paquete revisado")?;
            let path = path_policy::resolve(&stage, path)?;
            let bytes = export_execution::bounded_read(&path, 8 * 1024 * 1024)?;
            if bytes.len() as u64 != file.size || sha256_hex(&bytes) != file.sha256 {
                return Err("El archivo preparado cambió. No se copia.".into());
            }
            Ok(bytes)
        };
        self.proton_restore_workspace(
            action,
            &body,
            &directory,
            &serde_json::to_value(manifest).map_err(|_| "Manifiesto no representable")?,
            &source,
        )
    }
}

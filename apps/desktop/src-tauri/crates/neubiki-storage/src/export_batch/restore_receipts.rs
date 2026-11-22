//! Compact restore receipts stay in the existing bounded private export record family.
use super::*;
impl LocalApi {
    pub(crate) fn archive_proton_restore_receipt(&self, directory: &Path) -> Result<(), String> {
        let path = directory.join("proton-restore.json");
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Ok(meta) if meta.is_file() && !batch::linked(&meta) => (),
            _ => return Err(
                "El resultado de restauración no se puede conservar; la preparación se mantiene"
                    .into(),
            ),
        }
        let raw = export_execution::bounded_read(&path, 120 * 1024)?;
        let receipt: Value =
            serde_json::from_slice(&raw).map_err(|_| "Recibo de restauración no compatible")?;
        if receipt["schemaVersion"] != 1
            || receipt["accountId"]
                .as_str()
                .is_none_or(|id| id.is_empty() || id.len() > 1024)
            || receipt["rootId"]
                .as_str()
                .is_none_or(|id| id.is_empty() || id.len() > 1024)
            || receipt["archiveSha256"]
                .as_str()
                .is_none_or(|id| id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err(
                "El recibo de restauración no es verificable; se conserva la preparación".into(),
            );
        }
        if receipt["entries"]
            .as_array()
            .is_some_and(|entries| entries.iter().all(|entry| entry["status"] == "planned"))
        {
            return Ok(());
        }
        let revision = sha256_hex(&raw);
        let id = format!("export-batch-restore-{revision}");
        let target = folder(self, &id)?;
        if target.exists() {
            let previous = load(self, &id)?;
            if previous.source_metadata["receipt"] == receipt {
                return Ok(());
            }
            return Err("El recibo archivado cambió; se conservan ambas preparaciones".into());
        }
        let root = self.app_data_dir.join("export-batches");
        fs::create_dir_all(&root).map_err(|_| "No se puede conservar el recibo")?;
        let meta = fs::symlink_metadata(&root).map_err(|_| "Archivo de recibos no accesible")?;
        if !meta.is_dir() || batch::linked(&meta) {
            return Err("Archivo de recibos no regular".into());
        }
        if fs::read_dir(&root)
            .map_err(|_| "Recibos no accesibles")?
            .take(recovery_quotas::EXPORT_BATCH_RECORDS + 1)
            .count()
            >= recovery_quotas::EXPORT_BATCH_RECORDS
        {
            return Err("Los recibos alcanzan su límite; la preparación se conserva".into());
        }
        let _budget = recovery_inventory::admit(self, 128 * 1024)?;
        let scope = format!(
            "proton-{}",
            sha256_hex(
                &serde_json::to_vec(&json!([receipt["accountId"], receipt["rootId"]]))
                    .map_err(|_| "Ámbito no representable")?
            )
        );
        let job = Job {
            schema_version: 1,
            id,
            project_id: scope,
            revision,
            phase: "discarded".into(),
            format: "restore".into(),
            profile_name: None,
            rows: vec![],
            source_metadata: json!({"kind":"proton-restore-receipt","accountId":receipt["accountId"],"rootId":receipt["rootId"],"receipt":receipt}),
            archive_sha256: receipt["archiveSha256"].as_str().unwrap().into(),
            archive_bytes: 0,
            checked_at: receipt["checkedAt"].as_str().unwrap_or("").into(),
        };
        let raw = serde_json::to_vec(&job).map_err(|_| "Recibo no representable")?;
        if raw.len() > 128 * 1024 {
            return Err("El recibo supera su límite; se conserva la preparación".into());
        }
        let temporary = tempfile::Builder::new()
            .prefix("prepare-")
            .tempdir_in(&root)
            .map_err(|_| "No se pudo reservar el recibo")?;
        atomic_io::create(&temporary.path().join("review.json"), &raw)
            .map_err(|_| "No se pudo conservar el recibo")?;
        atomic_io::rename_no_replace(&temporary.keep(), &target)
            .map_err(|_| "La conservación del recibo requiere comprobación")?;
        Ok(())
    }
    pub(crate) fn proton_restore_receipts(&self, body: &Value) -> Result<Value, String> {
        self.proton_batch_scope(body)?;
        let scope = format!(
            "proton-{}",
            sha256_hex(
                &serde_json::to_vec(&json!([body["accountId"], body["rootId"]]))
                    .map_err(|_| "Ámbito no representable")?
            )
        );
        let root = self.app_data_dir.join("export-batches");
        let mut receipts = vec![];
        if root.exists() {
            let meta = fs::symlink_metadata(&root).map_err(|_| "Recibos no disponibles")?;
            if !meta.is_dir() || batch::linked(&meta) {
                return Err("Recibos no regulares".into());
            }
            for entry in fs::read_dir(root)
                .map_err(|_| "Recibos no disponibles")?
                .take(recovery_quotas::EXPORT_BATCH_RECORDS + 1)
            {
                let name = entry
                    .map_err(|_| "Recibo no disponible")?
                    .file_name()
                    .to_string_lossy()
                    .into_owned();
                if name.starts_with("prepare-") {
                    continue;
                }
                let job = load(self, &name)?;
                if job.project_id == scope
                    && job.source_metadata["kind"] == "proton-restore-receipt"
                {
                    receipts.push(job.source_metadata["receipt"].clone());
                }
            }
        }
        receipts.sort_by(|a, b| b["checkedAt"].as_str().cmp(&a["checkedAt"].as_str()));
        Ok(
            json!({"schemaVersion":1,"accountId":body["accountId"],"rootId":body["rootId"],"items":receipts,"checkedAt":neubiki_core::now_iso()}),
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restore_receipt_is_retained_without_payload_and_archives_idempotently() {
        let directory = tempfile::tempdir().unwrap();
        let api = LocalApi::new(directory.path().join("state"), "qa".into(), "test".into());
        let source = directory.path().join("transfer");
        fs::create_dir(&source).unwrap();
        let receipt = json!({"schemaVersion":1,"accountId":"account","rootId":"v~root","archiveSha256":"a".repeat(64),"checkedAt":neubiki_core::now_iso(),"entries":[{"status":"pending","path":"Acta.md"}]});
        fs::write(
            source.join("proton-restore.json"),
            serde_json::to_vec(&receipt).unwrap(),
        )
        .unwrap();
        api.archive_proton_restore_receipt(&source).unwrap();
        api.archive_proton_restore_receipt(&source).unwrap();
        let names = fs::read_dir(api.app_data_dir.join("export-batches"))
            .unwrap()
            .collect::<Vec<_>>();
        assert_eq!(names.len(), 1);
        let id = names[0]
            .as_ref()
            .unwrap()
            .file_name()
            .to_string_lossy()
            .into_owned();
        let job = load(&api, &id).unwrap();
        assert_eq!(job.phase, "discarded");
        assert_eq!(job.archive_bytes, 0);
        assert_eq!(job.source_metadata["receipt"], receipt);
        assert!(!folder(&api, &id).unwrap().join("payload.zip").exists());
    }
}

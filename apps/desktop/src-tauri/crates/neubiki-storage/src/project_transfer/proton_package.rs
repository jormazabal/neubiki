//! Proton originals become the standard portable manifest; no settings or private supplement is imported.
use super::*;
pub fn is_proton_package_work(method:&str,path:&str)->bool {method=="POST"&&path.trim_matches('/')=="api/proton/packages/prepare"}
pub fn dispatch_proton_package(api:&LocalApi,body:Value)->ApiResult {ok(api.prepare_proton_package(body)?)}
impl LocalApi {
    pub(crate) fn stage_proton_template_package(&self,name:&str,files:BTreeMap<String,Vec<u8>>,directories:Vec<String>)->Result<Value,String>{
        let entries=files.iter().map(|(path,bytes)|Ok(PackageFile{path:path.clone(),size:bytes.len() as u64,sha256:sha256_hex(bytes),kind:paths::kind(path).ok_or("Formato de adjunto no portable")?})).collect::<Result<Vec<_>,String>>()?;
        let manifest=Manifest{supplement:None,template_description:None,format:FORMAT.into(),schema_version:1,project_name:name.into(),created_at:neubiki_core::now_iso(),
            directories,files:entries,exclusions:vec![],adjustments:vec![],reference_warnings:vec![]};manifest.validate()?;
        if manifest.files.len()>32||manifest.directories.len()>32{return Err("La plantilla supera el alcance de restauración".into());}
        let job=self.begin_project_transfer(json!({"kind":"import"}))?;let id=job["id"].as_str().ok_or("Preparación no confirmada")?;
        let directory=jobs::folder(self,id)?;
        let temporary=tempfile::Builder::new().prefix("template-").tempdir_in(&directory).map_err(|_|"No se pudo preparar la plantilla")?;
        for directory in &manifest.directories {std::fs::create_dir_all(path_policy::resolve(temporary.path(),directory)?).map_err(|_|"No se pudo preparar una carpeta de adjuntos")?;}
        for (path,bytes) in files {atomic_io::create(&path_policy::resolve(temporary.path(),&path)?,&bytes).map_err(|_|"No se pudo preparar un adjunto")?;}
        let payload=temporary.path().join("template.neubiki-project.zip");archive::write(temporary.path(),&manifest,&payload)?;
        self.reserve_project_transfer_source(id)?;self.copy_project_transfer_source(id,&payload)?;self.record_project_transfer_source(id,Some("Plantilla con adjuntos Neubiki"))?;
        self.prepare_project_transfer(id)
    }
    pub(crate) fn verify_proton_package_archive(&self,path:&Path,expected:&Value)->Result<(),String>{
        let manifest:Manifest=serde_json::from_value(expected.clone()).map_err(|_|"Manifiesto portable no compatible")?;
        if archive::inspect(path)?!=manifest{return Err("El paquete no coincide con su manifiesto; no se entrega".into());}Ok(())
    }

    pub(crate) fn prepare_proton_package(&self,body:Value)->Result<Value,String> {
        validate_runtime_input(&body,&[])?;
        self.proton_batch_scope(&body)?;
        let snapshot=self.proton_package_snapshot(&body,&|path,folder| {
            !paths::backup_exclusion(path)&&paths::validate(path).is_ok()&&(folder||paths::kind(path).is_some())
        })?;
        let files=snapshot.files.iter().map(|file|Ok(PackageFile{path:file.path.clone(),size:file.bytes.len() as u64,
            sha256:sha256_hex(&file.bytes),kind:paths::kind(&file.path).ok_or("Tipo de archivo no compatible")?})).collect::<Result<Vec<_>,String>>()?;
        let manifest=Manifest{supplement:None,template_description:None,format:FORMAT.into(),schema_version:1,
            project_name:snapshot.name,created_at:neubiki_core::now_iso(),directories:snapshot.directories,files,
            exclusions:snapshot.exclusions.iter().map(|(path,reason)|Exclusion{path:path.clone(),reason:reason.clone()}).collect(),
            adjustments:vec![],reference_warnings:vec![]};
        manifest.validate()?;
        if serde_json::to_vec(&manifest).map_err(|_|"Manifiesto no representable")?.len()>64*1024{return Err("El manifiesto de la copia supera64KiB".into());}
        let mut results:Vec<Value>=snapshot.files.iter().map(|file|json!({"path":file.path,"nodeId":file.node_id,"revisionId":file.revision_id,"status":"included"})).collect();
        results.extend(snapshot.exclusions.iter().map(|(path,detail)|json!({"path":path,"status":"omitted","detail":detail})));
        let metadata=json!({"kind":"proton-project-package","accountId":body["accountId"],"rootId":body["rootId"],
            "includesPrivateDrafts":false,"manifest":manifest,"results":results});
        let scope=format!("proton-{}",sha256_hex(&serde_json::to_vec(&json!([body["accountId"],body["rootId"]])).map_err(|_|"Ámbito no representable")?));
        let prepared=snapshot.files.into_iter().map(|file|{
            let name=Path::new(&file.path).file_name().and_then(|name|name.to_str()).ok_or("Nombre de archivo no portable")?.to_owned();
            Ok((file.path,name,file.bytes))
        });
        let job=export_batch::freeze_batch(self,&scope,"project".into(),None,prepared,BTreeMap::new(),metadata)?.body;
        let id=job["id"].as_str().ok_or("Copia no verificable")?;
        let path=self.app_data_dir.join("export-batches").join(id).join("payload.zip");
        // Use exactly the same verifier as restore review, including hashes, names, CRC and bounded content.
        let verified=archive::inspect(&path)?;
        if verified!=manifest {return Err("La copia no coincide con su manifiesto. Consúltala antes de repetir.".into());}
        Ok(job)
    }
    pub(crate) fn proton_package_catalog(&self,body:Value)->Result<Value,String>{
        self.proton_batch_scope(&body)?;
        let scope=format!("proton-{}",sha256_hex(&serde_json::to_vec(&json!([body["accountId"],body["rootId"]])).map_err(|_|"Ámbito no representable")?));
        let mut catalog=self.scoped_export_batch_catalog(&scope)?;
        catalog["items"].as_array_mut().ok_or("Catálogo no verificable")?.retain(|job|job["sourceMetadata"]["kind"]=="proton-project-package");
        Ok(catalog)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_proton_packet_matches_the_restore_validator_and_preserves_native_note_names() {
        let directory=tempfile::tempdir().unwrap();let api=LocalApi::new(directory.path().join("state"),"qa".into(),"test".into());
        let bytes=b"# Guardado\n".to_vec();
        assert_eq!(paths::kind("Acta.mdown"),Some(FileKind::Markdown));assert_eq!(paths::kind("Nota.nbnote"),Some(FileKind::Handwritten));
        let manifest=Manifest{supplement:None,template_description:None,format:FORMAT.into(),schema_version:1,project_name:"Proyecto".into(),created_at:neubiki_core::now_iso(),
            directories:vec!["Vacía".into()],files:vec![PackageFile{path:"Acta.mdown".into(),size:bytes.len() as u64,sha256:sha256_hex(&bytes),kind:FileKind::Markdown}],
            exclusions:vec![],adjustments:vec![],reference_warnings:vec![]};manifest.validate().unwrap();
        let job=export_batch::freeze_batch(&api,"proton-qa","project".into(),None,vec![Ok(("Acta.mdown".into(),"Acta.mdown".into(),bytes))],BTreeMap::new(),
            json!({"kind":"proton-project-package","accountId":"account","rootId":"root","manifest":manifest})).unwrap().body;
        let archive=api.app_data_dir.join("export-batches").join(job["id"].as_str().unwrap()).join("payload.zip");
        assert_eq!(archive::inspect(&archive).unwrap(),manifest);
        let (restored,stage)=archive::extract(&archive,directory.path()).unwrap();
        assert_eq!(restored,manifest);assert_eq!(std::fs::read(stage.path().join("Acta.mdown")).unwrap(),b"# Guardado\n");assert!(stage.path().join("Vacía").is_dir());
    }
}

//! Resource templates become a reviewed native package, preserving relative links under one new folder.
use super::*;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
impl LocalApi {
    pub(crate) fn prepare_proton_template_package(&self,mut body:Value)->Result<Value,String>{
        let expected=body["previewDigest"].as_str().filter(|digest|digest.len()==64).ok_or("Revisa la plantilla con sus adjuntos antes de prepararla")?.to_owned();
        body.as_object_mut().ok_or("Solicitud no válida")?.remove("previewDigest");
        let preview=self.render_proton_document_template(body.clone())?;
        if preview["previewDigest"]!=expected{return Err("El documento o sus campos cambiaron. Vuelve a revisar la plantilla.".into());}
        let template=self.document_template(body["templateId"].as_str().ok_or("Plantilla no válida")?)?;
        if template["revision"]!=body["revision"]{return Err("La plantilla cambió; vuelve a seleccionarla".into());}
        let resources:Vec<Attachment>=serde_json::from_value(template.get("resources").cloned().unwrap_or_else(||json!([]))).map_err(|_|"Adjuntos no compatibles")?;
        if resources.is_empty(){return Err("Esta plantilla no necesita preparar una carpeta de adjuntos".into());}
        let name=preview["name"].as_str().ok_or("Nombre no válido")?;
        let mut files=BTreeMap::from([(name.to_owned(),preview["markdown"].as_str().ok_or("Texto no disponible")?.as_bytes().to_vec())]);
        let mut directories=BTreeSet::from(["_template-resources".to_owned()]);
        for resource in resources {
            let directory=format!("_template-resources/{}",resource.sha256);directories.insert(directory.clone());
            let path=format!("{directory}/{}",resource.name);
            let bytes=BASE64.decode(resource.data_base64).map_err(|_|"Adjunto no compatible")?;
            if bytes.len() as u64!=resource.byte_length||sha256_hex(&bytes)!=resource.sha256{return Err("Un adjunto no coincide con su revisión; no se prepara la carpeta".into());}
            if let Some(old)=files.insert(path,bytes.clone()){if old!=bytes{return Err("Dos adjuntos colisionan; no se prepara la carpeta".into());}}
        }
        self.stage_proton_template_package(&name[..name.len()-3],files,directories.into_iter().collect())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn proton_resource_template_preserves_encoded_links_and_stages_without_project_registration(){
        let directory=tempfile::tempdir().unwrap();let api=LocalApi::new(directory.path().join("state"),"qa".into(),"test".into());
        let workspace=api.pd_private_root().join("proton-workspace");fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("selection.json"),json!({"schemaVersion":1,"accountId":"acct","root":{"nodeId":"root","type":"folder","name":"Proyecto"}}).to_string()).unwrap();
        let bytes=b"Contenido exacto";let digest=sha256_hex(bytes);let token=format!("neubiki-template-resource:{digest}/Anexo%20com%C3%BAn.txt");
        let saved=api.capture_document_template(json!({"name":"Con adjunto","markdown":format!("# {{{{titulo}}}}\n[Anexo]({token}#seccion)"),"reviewedResources":true,
            "resources":[{"path":token,"name":"Anexo común.txt","mimeType":"text/plain","sha256":digest,"byteLength":bytes.len(),"dataBase64":BASE64.encode(bytes)}]})).unwrap();
        let mut body=json!({"accountId":"acct","rootId":"root","templateId":saved["id"],"revision":saved["revision"],"name":"Acta.md","localDate":"2026-11-17","values":{}});
        let preview=api.render_proton_document_template(body.clone()).unwrap();
        assert!(preview["markdown"].as_str().unwrap().contains(&format!("_template-resources/{digest}/Anexo%20com%C3%BAn.txt#seccion")));
        body["previewDigest"]=preview["previewDigest"].clone();
        let job=api.prepare_proton_template_package(body.clone()).unwrap();assert_eq!(job["phase"],"ready");assert_eq!(job["projectId"],Value::Null);
        assert_eq!(job["manifest"]["files"].as_array().unwrap().len(),2);
        assert!(job["manifest"]["files"].as_array().unwrap().iter().any(|file|file["path"]==format!("_template-resources/{digest}/Anexo común.txt")));
        body["previewDigest"]=json!("f".repeat(64));assert!(api.prepare_proton_template_package(body).unwrap_err().contains("cambiaron"));
    }
}

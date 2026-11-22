//! Bounded saved Proton snapshots rendered by the normal export engine and frozen before delivery.
use super::*;
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Input {
    account_id: String, root_id: String, documents: Vec<Source>, format: String,
    profile_id: Option<String>, profile_revision: Option<String>, profile_source: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Source { node_id: String, revision_id: String, name: Option<String>, diagram_assets: Option<Value> }
fn scope_id(body: &Value) -> Result<String, String> {
    Ok(format!("proton-{}", sha256_hex(&serde_json::to_vec(&json!([body["accountId"],body["rootId"]])).map_err(|_|"Ámbito no representable")?)))
}
pub fn is_proton_export_batch_work(method: &str, path: &str) -> bool {
    method == "POST" && path.trim_matches('/') == "api/proton/export-batches/prepare"
}
pub fn dispatch_proton_export_batch(api: &LocalApi, body: Value) -> ApiResult {
    validate_runtime_input(&body, &[])?;
    let q: Input = serde_json::from_value(body.clone()).map_err(|_|"Selección de exportación no válida")?;
    if q.documents.is_empty() || q.documents.len()>32
        || q.documents.iter().any(|d|d.node_id.is_empty() || d.node_id.len()>1024 || d.revision_id.is_empty() || d.revision_id.len()>1024 || d.name.as_ref().is_some_and(|n|n.is_empty() || n.len()>1024))
        || !matches!(q.format.as_str(),"pdf"|"docx"|"md")
        || q.documents.iter().map(|d|&d.node_id).collect::<BTreeSet<_>>().len()!=q.documents.len() {
        return Err("Selecciona 1–32 documentos y un formato admitido".into());
    }
    api.proton_batch_scope(&body)?;
    let profile = match (&q.profile_id,&q.profile_revision) {
        (None,None)=>None,
        (Some(id),Some(revision)) if q.format!="md" => Some(match q.profile_source.as_deref() {
            Some("project") => api.proton_shared_export_profile(&body,id,revision)?,
            None | Some("device") => api.proton_export_profile(id,revision)?,
            _ => return Err("El origen del perfil no es válido.".into()),
        }),
        _=>return Err("Revisa el perfil de exportación antes de preparar el lote".into()),
    };
    let template = api.read_export_template_checked()?;
    let mut documents = vec![];
    let mut resources = BTreeMap::new();
    let mut results = vec![];
    let mut total = 0usize;
    for (index, item) in q.documents.iter().enumerate() {
        // Selection changes abort the entire operation, including any incomplete local preparation.
        api.proton_batch_scope(&body)?;
        let mut name = item.name.clone().unwrap_or_else(||item.node_id.clone());
        let output: Result<_,String> = (|| {
            let mut snapshot = api.proton_batch_snapshot(&json!({"accountId":q.account_id,"rootId":q.root_id,
                "nodeId":item.node_id,"revisionId":item.revision_id}))?;
            name = snapshot["name"].as_str().ok_or("Nombre no verificable")?.to_owned();
            if snapshot.get("handwritten").is_some() && q.format!="pdf" {
                return Err("Las notas manuscritas se incluyen al elegir PDF.".into());
            }
            snapshot["profileId"]=json!(q.profile_id);
            snapshot["profileRevision"]=json!(q.profile_revision);
            snapshot["profileSource"]=json!(q.profile_source);
            snapshot["diagramAssets"]=json!(item.diagram_assets);
            let directory = format!("Documentos/{:02}",index+1);
            let mut extras = BTreeMap::new();
            if q.format=="md" {
                let markdown = snapshot["markdown"].as_str().ok_or("Markdown no disponible")?;
                let assets = api.proton_export_assets(&snapshot,markdown,true)?;
                let (rewritten, images) = portable_markdown(markdown,assets)?;
                snapshot["markdown"]=json!(rewritten);
                extras = images.into_iter().map(|(path,bytes)|(format!("{directory}/{path}"),bytes)).collect();
            }
            let (_, filename, bytes) = export_execution::render_proton_export_with_template(api,&snapshot,&q.format,Some(&template),profile.as_ref())?;
            let footprint = bytes.len()+extras.values().map(Vec::len).sum::<usize>();
            if total.saturating_add(footprint)>128*1024*1024 {return Err("El lote supera 128 MiB; selecciona menos documentos.".into());}
            total+=footprint;
            Ok((format!("{directory}/{name}"),filename,bytes,extras))
        })();
        match output {
            Ok((source,filename,bytes,extras)) => {
                results.push(json!({"nodeId":item.node_id,"revisionId":item.revision_id,"name":name,"status":"included"}));
                documents.push(Ok((source,filename,bytes)));
                resources.extend(extras);
            }
            Err(detail) => results.push(json!({"nodeId":item.node_id,"revisionId":item.revision_id,"name":name,"status":"omitted","detail":detail.chars().take(512).collect::<String>()})),
        }
    }
    api.proton_batch_scope(&body)?;
    // A profile changed during conversion invalidates the review rather than mixing styles.
    if let (Some(id),Some(revision))=(&q.profile_id,&q.profile_revision) {
        if q.profile_source.as_deref()==Some("project") {api.proton_shared_export_profile(&body,id,revision)?;}
        else {api.proton_export_profile(id,revision)?;}
    }
    if documents.is_empty() {return ok(json!({"schemaVersion":1,"batch":null,"results":results,"checkedAt":neubiki_core::now_iso()}));}
    let metadata=json!({"kind":"proton-saved-revisions","accountId":q.account_id,"rootId":q.root_id,"results":results,"includesPrivateDrafts":false,
        "profileSource":q.profile_source,"profileId":q.profile_id,"profileRevision":q.profile_revision});
    let job = export_batch::freeze_batch(api,&scope_id(&body)?,q.format,profile.map(|p|p.name),documents,resources,metadata)?.body;
    ok(json!({"schemaVersion":1,"batch":job,"results":results,"checkedAt":neubiki_core::now_iso()}))
}
impl LocalApi {
    pub(super) fn proton_export_batch_catalog(&self, body: Value) -> Result<Value,String> {
        self.proton_batch_scope(&body)?;
        let mut catalog=self.scoped_export_batch_catalog(&scope_id(&body)?)?;
        catalog["items"].as_array_mut().ok_or("Catálogo no verificable")?.retain(|job|job["sourceMetadata"]["kind"]=="proton-saved-revisions");
        Ok(catalog)
    }
}
fn portable_markdown(markdown:&str, assets:Vec<neubiki_docs::ExportImageAsset>) -> Result<(String,BTreeMap<String,Vec<u8>>),String> {
    let mut targets = BTreeMap::new();
    let mut files = BTreeMap::new();
    for asset in assets {
        // Data URLs remain embedded. Relative images use hash names to avoid path traversal and collisions.
        if asset.source.starts_with("data:") {continue;}
        let ext=match asset.content_type.as_str(){"image/png"=>"png","image/jpeg"=>"jpg","image/gif"=>"gif","image/webp"=>"webp",_=>return Err("Imagen no compatible".into())};
        let target=format!("_assets/{}.{}",sha256_hex(&asset.bytes),ext);
        targets.insert(asset.source,target.clone());
        files.insert(target,asset.bytes);
    }
    let mut text=markdown.to_owned();
    let spans=neubiki_docs::markdown_destinations(markdown);
    for span in spans.into_iter().rev() {
        if let Some(target)=targets.get(&span.target) {text.replace_range(span.range,target);}
    }
    Ok((text,files))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_batch_images_keep_formatting_and_remove_ancestor_paths() {
        let asset=neubiki_docs::ExportImageAsset{source:"../foto.png".into(),alt:None,content_type:"image/png".into(),bytes:vec![1,2,3]};
        let (md,files)=portable_markdown("# Acta\n![Foto](../foto.png)\n",vec![asset]).unwrap();
        assert!(!md.contains("../")); assert!(md.starts_with("# Acta\n![Foto](_assets/")); assert_eq!(files.len(),1);
        assert!(!files.keys().next().unwrap().contains(".."));
    }
    #[test]
    fn proton_batch_has_exact_route_and_scope_identity() {
        assert!(is_proton_export_batch_work("POST","/api/proton/export-batches/prepare"));
        assert!(!is_proton_export_batch_work("POST","/api/projects/p/export-batches"));
        assert_ne!(scope_id(&json!({"accountId":"a","rootId":"r"})).unwrap(),scope_id(&json!({"accountId":"b","rootId":"r"})).unwrap());
    }
}

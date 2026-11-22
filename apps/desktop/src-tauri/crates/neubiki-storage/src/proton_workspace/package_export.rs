//! Exact saved bytes for bounded portable copies, with per-file failures and no private journals.
use super::*;
pub(crate) struct SavedPackageFile { pub path:String, pub node_id:String, pub revision_id:String, pub bytes:Vec<u8> }
pub(crate) struct SavedPackage { pub name:String, pub directories:Vec<String>, pub files:Vec<SavedPackageFile>, pub exclusions:Vec<(String,String)> }
impl LocalApi {
    pub(crate) fn proton_package_snapshot(&self, body:&Value, accept:&dyn Fn(&str,bool)->bool) -> std::result::Result<SavedPackage,String> {
        self.with_proton_workspace(|workspace| workspace.package_snapshot(body,accept)).map_err(|error|error.detail)
    }
}
impl Workspace<'_> {
    fn package_snapshot(&self,body:&Value,accept:&dyn Fn(&str,bool)->bool)->Result<SavedPackage> {
        let account=token(body,"accountId")?; let root=token(body,"rootId")?;
        self.check_selection(account,root)?;
        let selection=self.selection()?.ok_or_else(Error::input)?;
        let mut output=SavedPackage{name:selection.root.name,directories:vec![],files:vec![],exclusions:vec![]};
        let mut queue=vec![(root.to_owned(),String::new(),0usize)];
        let mut seen=BTreeSet::from([root.to_owned()]); let mut count=0; let mut total=0usize;
        let mut names=std::collections::HashSet::new(); let mut path_bytes=0;
        while let Some((parent,prefix,depth))=queue.pop() {
            let listing=self.list(&json!({"accountId":account,"rootId":root,"parentId":parent}))?;
            let items:Vec<Node>=serde_json::from_value(listing["items"].clone()).map_err(|_|Error::invalid_response())?;
            for node in items {
                count+=1;
                if count>64 {return Err(Error::new(413,"package-limit","La copia admite hasta 32 archivos y 32 carpetas. Reduce el contenido de la carpeta seleccionada."));}
                if !seen.insert(node.node_id.clone()) {return Err(Error::invalid_response());}
                let path=if prefix.is_empty(){node.name.clone()}else{format!("{prefix}/{}",node.name)};
                path_bytes+=path.len();
                if path_bytes>16*1024 || !names.insert(super::super::portable_paths::key(&path)) {return Err(Error::new(422,"package-paths","Las rutas del proyecto no se pueden conservar de forma portable."));}
                let folder=node.kind==NodeKind::Folder;
                if !accept(&path,folder) {output.exclusions.push((path,"Nombre reservado, carpeta privada o formato no compatible.".into()));continue;}
                if folder {
                    if depth>=12 || output.directories.len()>=32 {return Err(Error::new(413,"package-limit","La copia admite hasta 32 carpetas y 12 niveles."));}
                    output.directories.push(path.clone()); queue.push((node.node_id,path,depth+1)); continue;
                }
                if output.files.len()>=32 {return Err(Error::new(413,"package-limit","La copia admite hasta 32 archivos."));}
                let result=(||->Result<_>{
                    let revision=node.revision_id.as_deref().ok_or_else(Error::invalid_response)?;
                    if !valid_revision(&node.node_id,revision){return Err(Error::invalid_response());}
                    let scope=DocumentScope{account_id:account.into(),root_id:root.into(),node_id:node.node_id.clone()};
                    let document=self.document(&scope)?;
                    let mut request=document.request();request["package"]=json!(true);request["expectedRevisionId"]=json!(revision);
                    let remote:RemoteRead=self.provider(account,"drive.workspaceRead",request)?;
                    validate_node(&remote.node)?;
                    if remote.node.node_id!=node.node_id || remote.node.name!=node.name || remote.node.kind!=NodeKind::File
                        || remote.revision_id!=revision || remote.node.revision_id.as_deref()!=Some(revision) {return Err(Error::new(409,"stale-node","El archivo cambió durante la copia."));}
                    if remote.content_base64.len()>4*(8usize*1024*1024).div_ceil(3){return Err(Error::new(413,"file-too-large","El archivo supera 8 MiB."));}
                    let bytes=BASE64.decode(remote.content_base64).map_err(|_|Error::invalid_response())?;
                    if bytes.len()>8*1024*1024 {return Err(Error::new(413,"file-too-large","El archivo supera 8 MiB."));}
                    if is_markdown(&node.name) {std::str::from_utf8(&bytes).map_err(|_|Error::new(422,"invalid-markdown-encoding","El Markdown no es UTF-8 válido."))?;}
                    if is_handwritten(&node.name) {let value:Value=serde_json::from_slice(&bytes).map_err(|_|Error::invalid_response())?;
                        super::super::document_validation::handwritten(&value).map_err(|detail|Error::new(422,"invalid-note",&detail))?;}
                    Ok(bytes)
                })();
                match result {
                    Ok(bytes)=>{total+=bytes.len();if total>128*1024*1024{return Err(Error::new(413,"package-limit","El contenido de la copia supera 128 MiB."));}
                        output.files.push(SavedPackageFile{path,node_id:node.node_id,revision_id:node.revision_id.unwrap(),bytes});}
                    Err(error)=>output.exclusions.push((path,error.detail.chars().filter(|ch|!ch.is_control()).take(512).collect())),
                }
            }
            self.check_selection(account,root)?;
        }
        output.directories.sort();output.files.sort_by(|a,b|a.path.cmp(&b.path));Ok(output)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_copy_preserves_bytes_and_empty_folders_without_recovery() {
        let directory=tempfile::tempdir().unwrap();
        let invoke=|_:&str,action:&str,request:Value|match action {
            "drive.workspaceFolder"=>Ok(json!({"nodeId":"v~root","name":"Proyecto","type":"folder"})),
            "drive.workspaceList"=>Ok(json!({"complete":true,"items":if request["parentId"]=="v~root"{json!([
                {"nodeId":"v~doc","name":"Acta.mdown","type":"file","revisionId":"v~doc~r1"},
                {"nodeId":"v~empty","name":"Vacía","type":"folder"}])}else{json!([])}})),
            "drive.workspaceRead"=>{assert_eq!(request["package"],true);assert_eq!(request["expectedRevisionId"],"v~doc~r1");
                Ok(json!({"node":{"nodeId":"v~doc","name":"Acta.mdown","type":"file","revisionId":"v~doc~r1"},"revisionId":"v~doc~r1","contentBase64":BASE64.encode("# Original\n")}))},
            _=>panic!("Unexpected {action}"),
        };
        let workspace=Workspace{directory:directory.path().join("workspace"),invoke:&invoke,can_write:false};
        workspace.handle("select",json!({"accountId":"account","rootId":"v~root"})).unwrap();
        let snapshot=workspace.package_snapshot(&json!({"accountId":"account","rootId":"v~root"}),&|_,_|true).unwrap();
        assert_eq!(snapshot.files[0].bytes,b"# Original\n");assert_eq!(snapshot.directories,vec!["Vacía"]);assert!(snapshot.exclusions.is_empty());
    }
}

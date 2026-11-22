//! Recent, explicitly retained AI results. No project, provider or backup writes.
use super::*;
use std::fs::{self, File, Metadata};
use std::io::{self, Read};
use std::sync::Mutex;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

const HISTORY_SECONDS: i64 = 7 * 24 * 60 * 60;
const MAX_ENTRIES: usize = 100;
const MAX_SCANNED: usize = 512;
const MAX_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TEXT_ENTRY: u64 = 2 * 1024 * 1024;
const MAX_IMAGE_ENTRY: u64 = 12 * 1024 * 1024;
const UNAVAILABLE: &str = "No se pudo acceder al historial privado de IA.";
static HISTORY_GATE: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Assistant,
    Translation,
    Image,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Self::Assistant => "assistant",
            Self::Translation => "translation",
            Self::Image => "image",
        }
    }

    fn max_entry(self) -> u64 {
        match self {
            Self::Assistant | Self::Translation => MAX_TEXT_ENTRY,
            Self::Image => MAX_IMAGE_ENTRY,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EntrySummary {
    id: String,
    kind: &'static str,
    created_at: String,
    expires_at: String,
}

struct EntryId {
    created: i64,
    kind: Kind,
}

impl EntryId {
    fn parse(id: &str) -> Option<Self> {
        let mut parts = id.split('-');
        let created = i64::from_str_radix(parts.next().filter(|v| hex(v, 16))?, 16).ok()?;
        let kind = match parts.next()? {
            "assistant" => Kind::Assistant,
            "translation" => Kind::Translation,
            "image" => Kind::Image,
            _ => return None,
        };
        if parts.next()? != "entry"
            || !hex(parts.next()?, 32)
            || !hex(parts.next()?, 16)
            || parts.next().is_some()
        {
            return None;
        }
        Some(Self { created, kind })
    }

    fn is_visible(&self, now: i64) -> bool {
        (0..HISTORY_SECONDS).contains(&now.saturating_sub(self.created))
    }

    fn summary(&self, id: String) -> Option<EntrySummary> {
        Some(EntrySummary {
            id,
            kind: self.kind.name(),
            created_at: format_time(self.created)?,
            expires_at: format_time(self.created.checked_add(HISTORY_SECONDS)?)?,
        })
    }
}

fn hex(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn format_time(unix_seconds: i64) -> Option<String> {
    OffsetDateTime::from_unix_timestamp(unix_seconds)
        .ok()?
        .format(&Rfc3339)
        .ok()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    schema_version: u8,
    content: Content,
}

#[derive(Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Content {
    Assistant {
        prompt: String,
        text: String,
    },
    Translation {
        language: String,
        text: String,
    },
    Image {
        content_type: String,
        content_base64: String,
    },
}

impl Content {
    fn kind(&self) -> Kind {
        match self {
            Self::Assistant { .. } => Kind::Assistant,
            Self::Translation { .. } => Kind::Translation,
            Self::Image { .. } => Kind::Image,
        }
    }

    fn is_valid(&self) -> bool {
        match self {
            Self::Assistant { prompt, text } => {
                valid_text(prompt, 32 * 1024) && valid_text(text, 512 * 1024)
            }
            Self::Translation { language, text } => {
                valid_text(language, 1024) && valid_text(text, 512 * 1024)
            }
            Self::Image {
                content_type,
                content_base64,
            } => proton_workspace::checked_image_type(content_base64)
                .is_ok_and(|verified| verified == content_type),
        }
    }
}

fn valid_text(text: &str, byte_limit: usize) -> bool {
    !text.trim().is_empty() && text.len() <= byte_limit && !text.contains('\0')
}

// Do not retain the destination of an external link. It may contain access credentials.
pub(super) fn redact_external_links(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut cursor = 0;
    for (start, _) in text.match_indices(['h', 'H']) {
        if start < cursor {
            continue;
        }
        let suffix = &text[start..];
        let is_http = ["http://", "https://"].iter().any(|prefix| {
            suffix
                .get(..prefix.len())
                .is_some_and(|part| part.eq_ignore_ascii_case(prefix))
        });
        if !is_http {
            continue;
        }
        let end = suffix
            .find(|c: char| {
                c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | '`' | ')' | ']' | '}')
            })
            .unwrap_or(suffix.len());
        result.push_str(&text[cursor..start]);
        result.push_str("[enlace omitido]");
        cursor = start + end;
    }
    result.push_str(&text[cursor..]);
    result
}

struct History {
    root: PathBuf,
    now: i64,
}

impl History {
    fn check_dir(&self, create: bool) -> Result<bool, String> {
        match fs::symlink_metadata(&self.root) {
            Ok(meta) if meta.is_dir() && !batch::linked(&meta) => Ok(true),
            Ok(_) => Err(UNAVAILABLE.into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound && !create => Ok(false),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                fs::create_dir(&self.root).map_err(|_| UNAVAILABLE)?;
                self.check_dir(false)
            }
            Err(_) => Err(UNAVAILABLE.into()),
        }
    }

    fn visit(
        &self,
        mut callback: impl FnMut(String, PathBuf, EntryId, Metadata, bool),
    ) -> Result<(), String> {
        if !self.check_dir(false)? {
            return Ok(());
        }
        for (index, file) in fs::read_dir(&self.root)
            .map_err(|_| UNAVAILABLE)?
            .enumerate()
        {
            if index >= MAX_SCANNED {
                return Err(UNAVAILABLE.into());
            }
            let file = file.map_err(|_| UNAVAILABLE)?;
            let name = file.file_name();
            let Some(name) = name.to_str() else { continue };
            let (id, is_temporary) = if let Some(id) = name.strip_suffix(".json") {
                (id, false)
            } else if let Some((id, suffix)) = name
                .strip_prefix('.')
                .and_then(|name| name.split_once(".json.write-"))
            {
                if !suffix.ends_with(".tmp") {
                    continue;
                }
                (id, true)
            } else {
                continue;
            };
            let Some(parsed) = EntryId::parse(id) else {
                continue;
            };
            let path = file.path();
            let meta = fs::symlink_metadata(&path).map_err(|_| UNAVAILABLE)?;
            if meta.is_file() && !batch::linked(&meta) {
                callback(id.to_owned(), path, parsed, meta, is_temporary);
            }
        }
        Ok(())
    }

    fn expire(&self) -> Result<(), String> {
        let mut failed = false;
        self.visit(|_, path, id, _, _| {
            if self.now.saturating_sub(id.created) >= HISTORY_SECONDS
                && fs::remove_file(path).is_err()
            {
                failed = true;
            }
        })?;
        if failed {
            Err(UNAVAILABLE.into())
        } else {
            Ok(())
        }
    }

    fn save(&self, content: Content) -> Result<(), String> {
        if !content.is_valid() {
            return Err(UNAVAILABLE.into());
        }
        let kind = content.kind();
        let bytes = serde_json::to_vec(&Entry {
            schema_version: 1,
            content,
        })
        .map_err(|_| UNAVAILABLE)?;
        if bytes.len() as u64 > kind.max_entry() {
            return Err(UNAVAILABLE.into());
        }
        self.check_dir(true)?;
        self.expire()?;
        let mut count = 0;
        let mut size = bytes.len() as u64;
        self.visit(|_, _, _, meta, _| {
            count += 1;
            size = size.saturating_add(meta.len());
        })?;
        if count >= MAX_ENTRIES || size > MAX_BYTES {
            return Err("El historial privado de IA ha alcanzado su límite de espacio.".into());
        }
        let id = format!(
            "{:x}-{}-{}",
            self.now,
            kind.name(),
            neubiki_core::compact_id("entry")
        );
        atomic_io::create(&self.root.join(format!("{id}.json")), &bytes)
            .map_err(|_| UNAVAILABLE.into())
    }

    fn list(&self) -> Result<Vec<EntrySummary>, String> {
        let mut entries = Vec::new();
        self.visit(|id, _, parsed, meta, is_temporary| {
            if !is_temporary && meta.len() <= parsed.kind.max_entry() && parsed.is_visible(self.now)
            {
                if let Some(summary) = parsed.summary(id) {
                    entries.push(summary);
                }
            }
        })?;
        // Timestamp encoded in the ID has a stable width for the supported date range.
        entries.sort_unstable_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        entries.truncate(MAX_ENTRIES);
        Ok(entries)
    }

    fn entry_path(&self, id: &str, limit: u64) -> Result<Option<PathBuf>, String> {
        if !self.check_dir(false)? {
            return Ok(None);
        }
        let path = self.root.join(format!("{id}.json"));
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_file() && !batch::linked(&meta) && meta.len() <= limit => {
                Ok(Some(path))
            }
            Ok(_) => Err(UNAVAILABLE.into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(UNAVAILABLE.into()),
        }
    }

    fn read(&self, id: &str) -> Result<Option<Value>, String> {
        let Some(parsed) = EntryId::parse(id).filter(|id| id.is_visible(self.now)) else {
            return Ok(None);
        };
        let Some(path) = self.entry_path(id, parsed.kind.max_entry())? else {
            return Ok(None);
        };
        let mut bytes = Vec::new();
        File::open(path)
            .and_then(|file| {
                file.take(parsed.kind.max_entry() + 1)
                    .read_to_end(&mut bytes)
            })
            .map_err(|_| UNAVAILABLE)?;
        if bytes.len() as u64 > parsed.kind.max_entry() {
            return Err(UNAVAILABLE.into());
        }
        let entry: Entry = serde_json::from_slice(&bytes).map_err(|_| UNAVAILABLE)?;
        if entry.schema_version != 1
            || entry.content.kind() != parsed.kind
            || !entry.content.is_valid()
        {
            return Err(UNAVAILABLE.into());
        }
        let summary = parsed.summary(id.to_owned()).ok_or(UNAVAILABLE)?;
        Ok(Some(json!({"summary":summary,"content":entry.content})))
    }

    fn delete(&self, id: &str) -> Result<bool, String> {
        let Some(parsed) = EntryId::parse(id) else {
            return Ok(false);
        };
        let Some(path) = self.entry_path(id, parsed.kind.max_entry())? else {
            return Ok(false);
        };
        fs::remove_file(path).map_err(|_| UNAVAILABLE)?;
        Ok(true)
    }
}

impl LocalApi {
    fn with_proton_history<T>(
        &self,
        run: impl FnOnce(History) -> Result<T, String>,
    ) -> Result<T, String> {
        let _guard = HISTORY_GATE.lock().map_err(|_| UNAVAILABLE)?;
        let root = self.pd_private_root();
        let metadata = fs::symlink_metadata(&root).map_err(|_| UNAVAILABLE)?;
        if !metadata.is_dir() || batch::linked(&metadata) {
            return Err(UNAVAILABLE.into());
        }
        run(History {
            root: root.join("proton-ai-history"),
            now: OffsetDateTime::now_utc().unix_timestamp(),
        })
    }

    pub fn expire_proton_ai_history(&self) -> Result<(), String> {
        self.with_proton_history(|history| history.expire())
    }

    pub(super) fn list_proton_ai_history(&self) -> Result<Value, String> {
        self.with_proton_history(|history| Ok(json!({"entries":history.list()?})))
    }

    pub(super) fn read_proton_ai_history(&self, id: &str) -> ApiResult {
        match self.with_proton_history(|history| history.read(id))? {
            Some(entry) => ok(entry),
            None => bad(404, "La entrada ya no está disponible en este dispositivo."),
        }
    }

    pub(super) fn delete_proton_ai_history(&self, id: &str) -> ApiResult {
        self.with_proton_history(|history| history.delete(id))?;
        no_content()
    }

    pub(super) fn retain_proton_ai_text(&self, body: &Value, credential: &str, result: &mut Value) {
        if body["retainHistory"] != true {
            return;
        }
        let saved = (|| {
            let text = result["text"]
                .as_str()
                .filter(|text| !text.contains(credential))
                .ok_or(UNAVAILABLE)?;
            let content = match body["kind"].as_str() {
                Some("assistant") => {
                    let prompt = body["prompt"]
                        .as_str()
                        .filter(|prompt| !prompt.contains(credential))
                        .ok_or(UNAVAILABLE)?;
                    Content::Assistant {
                        prompt: redact_external_links(prompt),
                        text: redact_external_links(text),
                    }
                }
                Some("translate") => {
                    let language = body["language"]
                        .as_str()
                        .filter(|language| !language.contains(credential))
                        .ok_or(UNAVAILABLE)?;
                    Content::Translation {
                        language: redact_external_links(language),
                        text: redact_external_links(text),
                    }
                }
                _ => return Err(UNAVAILABLE.into()),
            };
            self.with_proton_history(|history| history.save(content))
        })()
        .is_ok();
        result["historySaved"] = json!(saved);
    }

    pub(super) fn retain_proton_ai_image(&self, body: &Value, result: &mut Value) {
        if body["retainHistory"] != true {
            return;
        }
        let saved = (|| {
            self.with_proton_history(|history| {
                history.save(Content::Image {
                    content_type: result["contentType"].as_str().ok_or(UNAVAILABLE)?.into(),
                    content_base64: result["contentBase64"].as_str().ok_or(UNAVAILABLE)?.into(),
                })
            })
        })()
        .is_ok();
        result["historySaved"] = json!(saved);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proton_ai_history_expires_at_seven_days_without_renewal_or_affecting_other_data() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("history");
        let mut history = History {
            root: root.clone(),
            now: 1_790_000_000,
        };
        history
            .save(Content::Assistant {
                prompt: "Pregunta".into(),
                text: "Respuesta".into(),
            })
            .unwrap();
        let id = history.list().unwrap().remove(0).id;
        let independent = tmp.path().join("summary.json");
        fs::write(&independent, "Acta revisada").unwrap();
        history.now += HISTORY_SECONDS - 1;
        let loaded = history.read(&id).unwrap().unwrap();
        assert_eq!(loaded["content"]["text"], "Respuesta");
        history.now += 1;
        assert!(history.read(&id).unwrap().is_none());
        assert!(history.list().unwrap().is_empty());
        assert!(root.join(format!("{id}.json")).is_file());
        history.expire().unwrap();
        assert!(!root.join(format!("{id}.json")).exists());
        assert_eq!(fs::read_to_string(independent).unwrap(), "Acta revisada");
    }

    #[test]
    fn proton_ai_history_requires_retention_and_omits_context_and_link_targets() {
        let tmp = tempfile::tempdir().unwrap();
        let api = LocalApi::new(tmp.path().to_owned(), "test".into(), "test".into());
        let mut request = json!({"kind":"assistant","prompt":"Pide un [enlace](https://example.test/token)","markdown":"contexto privado"});
        let mut result = json!({"text":"Consulta HTTPS://example.test/secret"});
        api.retain_proton_ai_text(&request, "secret-key", &mut result);
        assert_eq!(api.list_proton_ai_history().unwrap()["entries"], json!([]));
        request["retainHistory"] = json!(true);
        api.retain_proton_ai_text(&request, "secret-key", &mut result);
        assert_eq!(result["historySaved"], true);
        let list = api.list_proton_ai_history().unwrap();
        let entry = &list["entries"][0];
        let id = entry["id"].as_str().unwrap();
        assert!(!entry.to_string().contains("Pide un"));
        let text = api.read_proton_ai_history(id).unwrap().body.to_string();
        assert!(text.contains("[enlace omitido]"), "{text}");
        assert!(!text.contains("example.test") && !text.contains("contexto privado"));
        assert_eq!(api.delete_proton_ai_history(id).unwrap().status, 204);
        assert_eq!(api.read_proton_ai_history(id).unwrap().status, 404);
        assert_eq!(
            api.read_proton_ai_history("../summary").unwrap().status,
            404
        );
    }
}

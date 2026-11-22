use super::*;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

const MAX_RECEIPTS: usize = 64;
const MAX_DIRECTORY_ENTRIES: usize = 512;
const MAX_RECEIPT_BYTES: u64 = 256 * 1024;
const RETENTION_SECONDS: i64 = 7 * 24 * 60 * 60;
const UNAVAILABLE: &str = "No se puede acceder a los recibos de investigación de este dispositivo.";
const ALREADY_STARTED: &str =
    "Ese intento ya se inició. Consulta su recibo para comprobar el resultado.";
static STORE_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) enum WebState {
    Started,
    Completed,
    Unconfirmed,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) enum SynthesisState {
    NotRequested,
    Waiting,
    Started,
    Completed,
    Unconfirmed,
    Skipped,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Receipt {
    schema_version: u8,
    document_id: String,
    started_at: i64,
    pub(super) web_state: WebState,
    pub(super) synthesis_state: SynthesisState,
    pub(super) web_usage_recorded: Option<bool>,
    pub(super) synthesis_usage_recorded: Option<bool>,
    pub(super) public_report: Option<PublicReport>,
    #[serde(default)]
    report_removed: bool,
}

impl Receipt {
    pub(super) fn new(document_id: String, started_at: i64, synthesis: bool) -> Self {
        Self {
            schema_version: 1,
            document_id,
            started_at,
            web_state: WebState::Started,
            synthesis_state: if synthesis {
                SynthesisState::Waiting
            } else {
                SynthesisState::NotRequested
            },
            web_usage_recorded: None,
            synthesis_usage_recorded: None,
            public_report: None,
            report_removed: false,
        }
    }

    fn is_valid(&self, id: &str) -> bool {
        let web_finished = self.web_state != WebState::Started;
        let synthesis_finished = matches!(
            self.synthesis_state,
            SynthesisState::Completed | SynthesisState::Unconfirmed
        );
        self.schema_version == 1
            && self
                .document_id
                .strip_prefix("proton-")
                .is_some_and(|digest| digest.len() == 64 && hex(digest))
            && issued_at(id).is_some_and(|issued| {
                (0..=QUOTE_SECONDS).contains(&self.started_at.saturating_sub(issued))
            })
            && self.web_usage_recorded.is_some() == web_finished
            && self.synthesis_usage_recorded.is_some() == synthesis_finished
            && match self.web_state {
                WebState::Started => matches!(
                    self.synthesis_state,
                    SynthesisState::Waiting | SynthesisState::NotRequested
                ),
                WebState::Unconfirmed => matches!(
                    self.synthesis_state,
                    SynthesisState::Skipped | SynthesisState::NotRequested
                ),
                WebState::Completed => true,
            }
            && (self.public_report.is_none()
                || (self.web_state == WebState::Completed && !self.report_removed))
            && self
                .public_report
                .as_ref()
                .is_none_or(PublicReport::is_valid)
    }

    fn view(&self, id: &str, include_report: bool) -> Value {
        let mut value = json!({
            "attemptId": id,
            "startedAt": self.started_at,
            "webState": self.web_state,
            "synthesisState": self.synthesis_state,
            "webUsageRecorded": self.web_usage_recorded,
            "synthesisUsageRecorded": self.synthesis_usage_recorded,
            "publicReportAvailable": self.public_report.is_some()
        });
        if include_report {
            if let Some(report) = &self.public_report {
                value["publicReport"] = json!({
                    "report": report.report,
                    "sources": report.sources,
                    "limited": report.limited,
                    "usageRecorded": self.web_usage_recorded == Some(true)
                });
            }
        }
        value
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PublicReport {
    report: String,
    sources: Vec<Citation>,
    limited: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Citation {
    url: String,
    title: String,
}

fn public_url(text: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(text).ok()?;
    (text.len() <= 2048
        && url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none())
    .then_some(url)
}

impl PublicReport {
    fn is_valid(&self) -> bool {
        !self.report.trim().is_empty()
            && self.report.len() <= 32 * 1024
            && !self.report.contains('\0')
            && (1..=8).contains(&self.sources.len())
            && self.sources.iter().all(|source| {
                !source.title.trim().is_empty()
                    && source.title.len() <= 512
                    && !source.title.chars().any(char::is_control)
                    && public_url(&source.url)
                        .is_some_and(|url| url.query().is_none() && url.fragment().is_none())
            })
    }

    pub(super) fn from_output(output: &Value, credential: &str) -> Option<Self> {
        if !credential.is_empty() && contains_secret(output, credential) {
            return None;
        }
        let report =
            super::super::proton_ai_history::redact_external_links(output["report"].as_str()?);
        let mut seen = BTreeSet::new();
        let raw = output["sources"].as_array()?;
        let sources: Vec<_> = raw
            .iter()
            .filter_map(|source| {
                let mut url = public_url(source["url"].as_str()?)?;
                url.set_query(None);
                url.set_fragment(None);
                let url = url.to_string();
                let title = super::super::proton_ai_history::redact_external_links(
                    source["title"].as_str()?,
                );
                seen.insert(url.clone()).then_some(Citation { url, title })
            })
            .take(8)
            .collect();
        let limited = output["limited"].as_bool()? || sources.len() < raw.len();
        let snapshot = Self {
            report,
            sources,
            limited,
        };
        snapshot.is_valid().then_some(snapshot)
    }
}

pub(super) struct Receipts {
    root: PathBuf,
    now: i64,
}

impl Receipts {
    pub(super) fn new(private_root: PathBuf, now: i64) -> Self {
        Self {
            root: private_root.join("proton-research-receipts"),
            now,
        }
    }

    fn directory_exists(&self, create: bool) -> Result<bool, String> {
        let parent = self.root.parent().ok_or(UNAVAILABLE)?;
        if !is_directory(parent)? {
            return if create {
                Err(UNAVAILABLE.into())
            } else {
                Ok(false)
            };
        }
        let exists = is_directory(&self.root)?;
        if exists || !create {
            return Ok(exists);
        }
        match fs::create_dir(&self.root) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => is_directory(&self.root),
            Err(_) => Err(UNAVAILABLE.into()),
        }
    }

    fn paths(&self) -> Result<Vec<(String, PathBuf, bool)>, String> {
        let mut paths = Vec::new();
        if !self.directory_exists(false)? {
            return Ok(paths);
        }
        for (count, entry) in fs::read_dir(&self.root)
            .map_err(|_| UNAVAILABLE)?
            .enumerate()
        {
            if count >= MAX_DIRECTORY_ENTRIES {
                return Err(UNAVAILABLE.into());
            }
            let entry = entry.map_err(|_| UNAVAILABLE)?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let (id, temporary) = if let Some(id) = name.strip_suffix(".json") {
                (id, false)
            } else if let Some((id, suffix)) = name
                .strip_prefix('.')
                .and_then(|value| value.split_once(".json."))
            {
                let Some(write) = suffix.strip_suffix(".tmp") else {
                    continue;
                };
                if timestamp_id(write, "write-").is_none() {
                    continue;
                }
                (id, true)
            } else {
                continue;
            };
            if issued_at(id).is_some() {
                paths.push((id.into(), entry.path(), temporary));
            }
        }
        Ok(paths)
    }

    fn visible(&self, id: &str) -> bool {
        issued_at(id).is_some_and(|issued| {
            (-30..RETENTION_SECONDS).contains(&self.now.saturating_sub(issued))
        })
    }

    fn expire_locked(&self) -> Result<usize, String> {
        let mut count = 0;
        for (id, path, temporary) in self.paths()? {
            if issued_at(&id)
                .is_some_and(|issued| self.now.saturating_sub(issued) >= RETENTION_SECONDS)
            {
                if matches!(fs::symlink_metadata(&path), Ok(meta) if meta.is_file() && !batch::linked(&meta))
                {
                    fs::remove_file(path).map_err(|_| UNAVAILABLE)?;
                }
            } else if !temporary {
                count += 1;
            }
        }
        Ok(count)
    }

    pub(super) fn expire(&self) -> Result<(), String> {
        let _guard = STORE_GATE.lock().map_err(|_| UNAVAILABLE)?;
        self.expire_locked()?;
        Ok(())
    }

    fn read(path: &Path, id: &str) -> Result<Option<Receipt>, String> {
        match fs::symlink_metadata(path) {
            Ok(meta)
                if meta.is_file() && !batch::linked(&meta) && meta.len() <= MAX_RECEIPT_BYTES => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            _ => return Err(UNAVAILABLE.into()),
        }
        let mut bytes = Vec::new();
        File::open(path)
            .and_then(|file| file.take(MAX_RECEIPT_BYTES + 1).read_to_end(&mut bytes))
            .map_err(|_| UNAVAILABLE)?;
        if bytes.len() as u64 > MAX_RECEIPT_BYTES {
            return Err(UNAVAILABLE.into());
        }
        let receipt: Receipt = serde_json::from_slice(&bytes).map_err(|_| UNAVAILABLE)?;
        if !receipt.is_valid(id) {
            return Err(UNAVAILABLE.into());
        }
        Ok(Some(receipt))
    }

    pub(super) fn status(&self, document_id: &str, attempt: Option<&str>) -> Result<Value, String> {
        let _guard = STORE_GATE.lock().map_err(|_| UNAVAILABLE)?;
        if !self.directory_exists(false)? {
            return Ok(json!({"attempts":[]}));
        }
        let mut matches = Vec::new();
        if let Some(id) = attempt {
            if self.visible(id) {
                if let Some(receipt) = Self::read(&self.root.join(format!("{id}.json")), id)?
                    .filter(|receipt| receipt.document_id == document_id)
                {
                    matches.push(receipt.view(id, true));
                }
            }
        } else {
            let mut paths = self.paths()?;
            paths.sort_unstable_by(|(left, _, _), (right, _, _)| {
                timestamp_id(right, "research-")
                    .cmp(&timestamp_id(left, "research-"))
                    .then_with(|| right.cmp(left))
            });
            for (id, path, temporary) in paths {
                if temporary || !self.visible(&id) {
                    continue;
                }
                if let Some(receipt) =
                    Self::read(&path, &id)?.filter(|receipt| receipt.document_id == document_id)
                {
                    matches.push(receipt.view(&id, false));
                }
                if matches.len() == MAX_RECEIPTS {
                    break;
                }
            }
        }
        Ok(json!({"attempts":matches}))
    }

    pub(super) fn claim(&self, id: &str, receipt: &Receipt) -> Result<(), String> {
        let _guard = STORE_GATE.lock().map_err(|_| UNAVAILABLE)?;
        if !self.visible(id) || !receipt.is_valid(id) || !self.directory_exists(true)? {
            return Err(UNAVAILABLE.into());
        }
        if self.expire_locked()? >= MAX_RECEIPTS {
            return Err("Los recibos de investigación han alcanzado su límite de espacio.".into());
        }
        let bytes = serde_json::to_vec(receipt).map_err(|_| UNAVAILABLE)?;
        atomic_io::create(&self.root.join(format!("{id}.json")), &bytes).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                ALREADY_STARTED.into()
            } else {
                UNAVAILABLE.into()
            }
        })
    }

    pub(super) fn checkpoint(&self, id: &str, receipt: &mut Receipt) -> Result<(), String> {
        let _guard = STORE_GATE.lock().map_err(|_| UNAVAILABLE)?;
        if !receipt.is_valid(id) || !self.directory_exists(false)? {
            return Err(UNAVAILABLE.into());
        }
        let path = self.root.join(format!("{id}.json"));
        let prior = Self::read(&path, id)?
            .filter(|prior| {
                prior.document_id == receipt.document_id && prior.started_at == receipt.started_at
            })
            .ok_or(UNAVAILABLE)?;
        // A later synthesis checkpoint must not restore an explicitly removed copy.
        if prior.report_removed {
            receipt.public_report = None;
            receipt.report_removed = true;
        }
        Self::write(&path, receipt)
    }

    pub(super) fn remove_report(&self, document_id: &str, id: &str) -> Result<Value, String> {
        let _guard = STORE_GATE.lock().map_err(|_| UNAVAILABLE)?;
        if !self.visible(id) || !self.directory_exists(false)? {
            return Err("El recibo ya no está disponible.".into());
        }
        let path = self.root.join(format!("{id}.json"));
        let mut receipt = Self::read(&path, id)?
            .filter(|receipt| receipt.document_id == document_id)
            .ok_or("El recibo ya no está disponible.")?;
        for (staged_id, staged, temporary) in self.paths()? {
            if temporary
                && staged_id == id
                && matches!(fs::symlink_metadata(&staged), Ok(meta) if meta.is_file() && !batch::linked(&meta))
            {
                fs::remove_file(staged).map_err(|_| UNAVAILABLE)?;
            }
        }
        if !receipt.report_removed {
            receipt.public_report = None;
            receipt.report_removed = true;
            Self::write(&path, &receipt)?;
        }
        Ok(json!({"attempts":[receipt.view(id, true)]}))
    }

    fn write(path: &Path, receipt: &Receipt) -> Result<(), String> {
        let bytes = serde_json::to_vec(receipt).map_err(|_| UNAVAILABLE)?;
        if bytes.len() as u64 > MAX_RECEIPT_BYTES {
            return Err(UNAVAILABLE.into());
        }
        atomic_io::write(path, &bytes).map_err(|_| UNAVAILABLE.into())
    }
}

fn is_directory(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !batch::linked(&meta) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        _ => Err(UNAVAILABLE.into()),
    }
}

fn hex(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn timestamp_id(id: &str, prefix: &str) -> Option<i128> {
    let (timestamp, sequence) = id.strip_prefix(prefix)?.split_once('-')?;
    if timestamp.is_empty()
        || timestamp.len() > 32
        || !hex(timestamp)
        || sequence.is_empty()
        || sequence.len() > 16
        || !hex(sequence)
    {
        return None;
    }
    let ticks = i128::from_str_radix(timestamp, 16).ok()?;
    (ticks > 0 && format!("{ticks:x}") == timestamp).then_some(ticks)
}

pub(super) fn issued_at(id: &str) -> Option<i64> {
    i64::try_from(timestamp_id(id, "research-")? / 1_000_000_000).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_790_000_000;

    fn attempt(sequence: usize) -> String {
        format!(
            "research-{:x}-{sequence:x}",
            i128::from(NOW) * 1_000_000_000
        )
    }

    fn identity(character: char) -> String {
        format!("proton-{}", character.to_string().repeat(64))
    }

    #[test]
    fn research_receipt_recovers_the_public_checkpoint_after_runtime_restart() {
        let directory = tempfile::tempdir().unwrap();
        let store = Receipts::new(directory.path().to_owned(), NOW);
        let document = identity('a');
        let id = attempt(1);
        let mut receipt = Receipt::new(document.clone(), NOW, true);
        store.claim(&id, &receipt).unwrap();
        assert_eq!(store.claim(&id, &receipt).unwrap_err(), ALREADY_STARTED);
        let status = &store.status(&document, Some(&id)).unwrap()["attempts"][0];
        assert_eq!(status["webState"], "started");
        assert_eq!(status["synthesisState"], "waiting");
        assert_eq!(status["webUsageRecorded"], Value::Null);
        assert_eq!(status["publicReportAvailable"], false);

        let output = json!({
            "report": "Public evidence [link](https://example.test/private-target)",
            "sources": [{"title":"Citation","url":"https://example.test/report?tracking=token#anchor"}],
            "limited": false,
            "question": "Unretained question",
            "synthesis": "Unretained synthesis",
            "sourceNames": ["Unretained private filename"],
        });
        receipt.web_state = WebState::Completed;
        receipt.web_usage_recorded = Some(true);
        receipt.public_report = PublicReport::from_output(&output, "api-secret");
        store.checkpoint(&id, &mut receipt).unwrap();
        receipt.synthesis_state = SynthesisState::Started;
        store.checkpoint(&id, &mut receipt).unwrap();

        let reopened = Receipts::new(directory.path().to_owned(), NOW + 1);
        let list = &reopened.status(&document, None).unwrap()["attempts"][0];
        assert_eq!(list["publicReportAvailable"], true);
        assert!(list.get("publicReport").is_none());
        let detail = &reopened.status(&document, Some(&id)).unwrap()["attempts"][0];
        assert_eq!(detail["webState"], "completed");
        assert_eq!(detail["synthesisState"], "started");
        assert_eq!(detail["webUsageRecorded"], true);
        assert_eq!(detail["synthesisUsageRecorded"], Value::Null);
        assert_eq!(
            detail["publicReport"]["sources"][0]["url"],
            "https://example.test/report"
        );
        assert_eq!(
            detail["publicReport"]["report"],
            "Public evidence [link]([enlace omitido])"
        );
        assert_eq!(
            reopened.status(&identity('b'), Some(&id)).unwrap()["attempts"],
            json!([])
        );
        let saved = fs::read_to_string(store.root.join(format!("{id}.json"))).unwrap();
        assert!(!saved.contains("Unretained"));
        assert!(!saved.contains("private-target"));
        assert!(!saved.contains("tracking"));
    }

    #[test]
    fn research_receipt_keeps_public_usage_separate_and_expires_without_touching_other_data() {
        let directory = tempfile::tempdir().unwrap();
        let store = Receipts::new(directory.path().to_owned(), NOW);
        let document = identity('a');
        let id = attempt(1);
        let mut receipt = Receipt::new(document.clone(), NOW, true);
        store.claim(&id, &receipt).unwrap();
        receipt.web_state = WebState::Completed;
        receipt.web_usage_recorded = Some(true);
        receipt.synthesis_state = SynthesisState::Unconfirmed;
        receipt.synthesis_usage_recorded = Some(false);
        store.checkpoint(&id, &mut receipt).unwrap();
        let final_status = &store.status(&document, Some(&id)).unwrap()["attempts"][0];
        assert_eq!(final_status["webUsageRecorded"], true);
        assert_eq!(final_status["synthesisUsageRecorded"], false);
        assert_eq!(final_status["publicReportAvailable"], false);
        assert!(final_status.get("publicReport").is_none());

        let sibling = directory.path().join("unrelated.json");
        fs::write(&sibling, "independent").unwrap();
        let expired = Receipts::new(directory.path().to_owned(), NOW + RETENTION_SECONDS);
        assert_eq!(
            expired.status(&document, Some(&id)).unwrap()["attempts"],
            json!([])
        );
        expired.expire().unwrap();
        assert!(!store.root.join(format!("{id}.json")).exists());
        assert_eq!(fs::read_to_string(sibling).unwrap(), "independent");
    }

    #[test]
    fn research_receipt_enforces_capacity_and_rejects_unsafe_copies() {
        let directory = tempfile::tempdir().unwrap();
        let store = Receipts::new(directory.path().to_owned(), NOW);
        let receipt = Receipt::new(identity('a'), NOW, false);
        for sequence in 1..=MAX_RECEIPTS {
            store.claim(&attempt(sequence), &receipt).unwrap();
        }
        assert!(store.claim(&attempt(MAX_RECEIPTS + 1), &receipt).is_err());
        assert_eq!(
            store.status(&identity('a'), None).unwrap()["attempts"]
                .as_array()
                .unwrap()
                .len(),
            MAX_RECEIPTS
        );
        assert!(PublicReport::from_output(
            &json!({"report":"Content with api-secret", "limited":false,
            "sources":[{"title":"Citation","url":"https://example.test/report"}]}),
            "api-secret"
        )
        .is_none());
        assert!(PublicReport::from_output(
            &json!({"report":"Report", "limited":false,
            "sources":[{"title":"Citation","url":"https://user:password@example.test/report"}]}),
            "api-secret"
        )
        .is_none());
    }

    #[test]
    fn research_receipt_removal_is_scoped_idempotent_and_survives_a_later_checkpoint() {
        let directory = tempfile::tempdir().unwrap();
        let store = Receipts::new(directory.path().to_owned(), NOW);
        let document = identity('a');
        let id = attempt(1);
        let mut receipt = Receipt::new(document.clone(), NOW, true);
        store.claim(&id, &receipt).unwrap();
        receipt.web_state = WebState::Completed;
        receipt.web_usage_recorded = Some(true);
        receipt.synthesis_state = SynthesisState::Started;
        receipt.public_report = PublicReport::from_output(
            &json!({
                "report":"Report to remove","sources":[{"title":"Citation","url":"https://example.test/report"}],"limited":false,
            }),
            "api-secret",
        );
        store.checkpoint(&id, &mut receipt).unwrap();
        let staging = store.root.join(format!(
            ".{id}.json.{}.tmp",
            neubiki_core::compact_id("write")
        ));
        fs::write(&staging, "interrupted report staging").unwrap();

        assert!(store.remove_report(&identity('b'), &id).is_err());
        assert!(staging.is_file());
        let cleared = store.remove_report(&document, &id).unwrap();
        assert!(!staging.exists());
        assert_eq!(cleared["attempts"][0]["publicReportAvailable"], false);
        assert_eq!(cleared["attempts"][0]["synthesisState"], "started");
        assert_eq!(store.remove_report(&document, &id).unwrap(), cleared);

        receipt.synthesis_state = SynthesisState::Completed;
        receipt.synthesis_usage_recorded = Some(true);
        store.checkpoint(&id, &mut receipt).unwrap();
        assert!(receipt.public_report.is_none());
        let final_status = &store.status(&document, Some(&id)).unwrap()["attempts"][0];
        assert!(final_status.get("publicReport").is_none());
        assert_eq!(final_status["webUsageRecorded"], true);
        assert_eq!(final_status["synthesisUsageRecorded"], true);
        assert_eq!(
            store
                .claim(&id, &Receipt::new(document, NOW, true))
                .unwrap_err(),
            ALREADY_STARTED
        );
    }
}

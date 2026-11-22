use super::*;
use std::fs;
use std::io::Read;
use std::sync::Mutex;

const DAY: i64 = 86_400;
static SCHEDULE_GATE: Mutex<()> = Mutex::new(());

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Schedule {
    interval_days: Option<i64>,
    next_due: Option<i64>,
    last_attempt: Option<i64>,
    package_id: Option<String>,
    status: Option<String>,
}

impl Schedule {
    fn response(&self) -> Result<Value, String> {
        let mut response =
            serde_json::to_value(self).map_err(|_| "No se pudo representar la programación.")?;
        response["revision"] = json!(sha256_hex(response.to_string().as_bytes()));
        Ok(response)
    }

    fn due(&self, now: i64) -> Option<i64> {
        self.interval_days
            .filter(|days| matches!(days, 1 | 7))
            .filter(|_| self.next_due.is_some_and(|date| date <= now))
    }
}

fn read(path: &Path) -> Result<Schedule, String> {
    let metadata = match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Schedule::default())
        }
        result => result.map_err(|_| "No se pudo consultar la programación.")?,
    };
    if !metadata.is_file() || batch::linked(&metadata) || metadata.len() > 4096 {
        return Err("La programación local no se pudo verificar.".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|file| file.take(4097).read_to_end(&mut bytes))
        .map_err(|_| "No se pudo leer la programación.")?;
    if bytes.len() > 4096 {
        return Err("La programación excede el límite.".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "La programación local no se pudo verificar.".into())
}

fn write(path: &Path, schedule: &Schedule) -> Result<(), String> {
    let directory = path.parent().ok_or("Falta la carpeta de programación.")?;
    match fs::create_dir(directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err("No se pudo preparar la carpeta de programación.".into()),
    }
    let directory = fs::symlink_metadata(directory)
        .map_err(|_| "No se pudo verificar la carpeta de programación.")?;
    if !directory.is_dir() || batch::linked(&directory) {
        return Err("La carpeta de programación local no se pudo verificar.".into());
    }
    let bytes = serde_json::to_vec(schedule).map_err(|_| "No se pudo preparar la programación.")?;
    atomic_io::write(path, &bytes).map_err(|_| "No se pudo guardar la programación.".into())
}

impl LocalApi {
    fn backup_schedule_path(&self, body: &Value) -> Result<PathBuf, String> {
        self.proton_batch_scope(body)?;
        let key = sha256_hex(
            json!([body["accountId"], body["rootId"]])
                .to_string()
                .as_bytes(),
        );
        let directory = self.app_data_dir.join("proton-backup-schedules");
        match fs::symlink_metadata(&directory) {
            Ok(metadata) if metadata.is_dir() && !batch::linked(&metadata) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err("La carpeta de programación local no se pudo verificar.".into()),
        }
        Ok(directory.join(format!("{key}.json")))
    }

    pub(super) fn proton_backup_schedule(&self, body: &Value) -> Result<Value, String> {
        let path = self.backup_schedule_path(body)?;
        read(&path)?.response()
    }

    pub(super) fn proton_update_backup_schedule(&self, body: &Value) -> Result<Value, String> {
        let _gate = SCHEDULE_GATE
            .try_lock()
            .map_err(|_| "Hay una copia programada en preparación.")?;
        let path = self.backup_schedule_path(body)?;
        let mut schedule = read(&path)?;
        if body["expectedRevision"] != schedule.response()?["revision"] {
            return Err("La programación cambió. Vuelve a consultarla.".into());
        }
        let interval = match body.get("intervalDays") {
            Some(Value::Null) => None,
            Some(value) => Some(
                value
                    .as_i64()
                    .filter(|value| matches!(value, 1 | 7))
                    .ok_or("El intervalo no es válido.")?,
            ),
            None => return Err("Elige un intervalo para la copia.".into()),
        };
        if interval != schedule.interval_days {
            schedule.interval_days = interval;
            schedule.next_due =
                interval.map(|days| time::OffsetDateTime::now_utc().unix_timestamp() + DAY * days);
            write(&path, &schedule)?;
        }
        schedule.response()
    }

    fn run_due_proton_backup(&self, body: &Value) -> Result<Value, String> {
        let Ok(_gate) = SCHEDULE_GATE.try_lock() else {
            return Ok(Value::Null);
        };
        let path = self.backup_schedule_path(body)?;
        let mut schedule = read(&path)?;
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let Some(days) = schedule.due(now) else {
            return Ok(Value::Null);
        };
        let scope = json!({"accountId":body["accountId"],"rootId":body["rootId"]});
        let catalog = self.proton_package_catalog(scope.clone())?;
        let packages = catalog["items"]
            .as_array()
            .ok_or("Falta verificar las copias preparadas.")?;
        let pending = packages.iter().any(|item| {
            matches!(
                item["phase"].as_str(),
                Some("prepared" | "picking" | "cancelled" | "uncertain")
            )
        });
        if pending {
            if schedule.status.as_deref() != Some("waiting") {
                schedule.status = Some("waiting".into());
                write(&path, &schedule)?;
            }
            return Ok(Value::Null);
        }
        let _activity = self.private_work()?;
        // Advance durably before reading; an interrupted worker cannot produce another copy on its next tick.
        schedule.next_due = Some(now + days * DAY);
        schedule.last_attempt = Some(now);
        schedule.status = Some("preparing".into());
        write(&path, &schedule)?;
        match self.prepare_proton_package(scope) {
            Ok(package) => {
                schedule.package_id = package["id"].as_str().map(str::to_owned);
                schedule.status = Some("prepared".into());
            }
            Err(_) => {
                schedule.status = Some("failed".into());
                // A brief loss of connection should defer the copy without creating a retry storm.
                schedule.next_due = Some(now + 3_600);
            }
        }
        write(&path, &schedule)?;
        schedule.response()
    }
}

pub fn is_proton_backup_work(method: &str, path: &str) -> bool {
    method == "POST" && path.trim_matches('/') == "api/proton/packages/backup-tick"
}

pub fn dispatch_proton_backup(api: &LocalApi, body: Value) -> ApiResult {
    ok(api.run_due_proton_backup(&body)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proton_backup_schedule_round_trips_and_becomes_due_only_at_the_scheduled_time() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("backup.json");
        assert_eq!(read(&path).unwrap().due(i64::MAX), None);
        let schedule = Schedule {
            interval_days: Some(7),
            next_due: Some(1000),
            ..Default::default()
        };
        write(&path, &schedule).unwrap();
        let persisted = read(&path).unwrap();
        assert_eq!(persisted.response().unwrap(), schedule.response().unwrap());
        assert_eq!(persisted.due(999), None);
        assert_eq!(persisted.due(1000), Some(7));
    }
}

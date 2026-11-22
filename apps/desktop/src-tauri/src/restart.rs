//! A restart reservation is shared by all windows; it does not stop active work.
use crate::{runtime_dispatch::LocalApiState, runtime_errors::RuntimeFailure, PROJECT_LOCATION_GATE};
use neubiki_core::operations::{Operations, Phase};
use std::sync::{Mutex, MutexGuard};
use tauri::Manager;

#[derive(Default)]
pub(crate) struct RestartFence(Mutex<Option<String>>);

#[tauri::command]
pub(crate) fn desktop_update_channel_enabled(window: tauri::WebviewWindow) -> Result<bool, RuntimeFailure> {
    crate::require_workspace_window(&window).map_err(|_| RuntimeFailure::window_denied())?;
    Ok(cfg!(target_os = "windows")
        && window.config().plugins.0.get("updater")
            .and_then(|config| config.get("endpoints"))
            .and_then(serde_json::Value::as_array)
            .is_some_and(|endpoints| !endpoints.is_empty()))
}
pub(crate) fn admission(app: &tauri::AppHandle) -> Result<MutexGuard<'_, Option<String>>, String> {
    let guard = app
        .state::<RestartFence>()
        .inner()
        .0
        .lock()
        .map_err(|_| "No se puede comprobar la preparación de la actualización")?;
    if guard.is_some() {
        return Err("runtime-restart-reserved".into());
    }
    Ok(guard)
}
#[tauri::command]
pub(crate) async fn prepare_runtime_restart(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<String, RuntimeFailure> {
    crate::require_workspace_window(&window).map_err(|_| RuntimeFailure::window_denied())?;
    tauri::async_runtime::spawn_blocking(move || {
        let unavailable = || RuntimeFailure::rejected(503, "runtime-update-failed");
        let _location = PROJECT_LOCATION_GATE.lock().map_err(|_| unavailable())?;
        let mut fence = app.state::<RestartFence>().inner().0.lock().map_err(|_| unavailable())?;
        if fence.is_some() {
            return Err(RuntimeFailure::rejected(409, "runtime-restart-reserved"));
        }
        let snapshots = app.state::<Operations>().snapshots().map_err(|_| unavailable())?;
        if snapshots.iter().any(|entry| matches!(entry.phase, Phase::Queued | Phase::Running))
            || app.state::<LocalApiState>().1.has_background_work() {
            return Err(RuntimeFailure::rejected(409, "runtime-update-work-active"));
        }
        app.state::<neubiki_recording::RecordingService>()
            .request("restart-hold", serde_json::json!({}))
            .map_err(|_| RuntimeFailure::unconfirmed("runtime-update-failed"))?;
        let token = neubiki_core::compact_id("restart");
        *fence = Some(token.clone());
        Ok(token)
    }).await.map_err(|_| RuntimeFailure::unconfirmed("runtime-update-failed"))?
}
#[tauri::command]
pub(crate) async fn release_runtime_restart(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    token: String,
) -> Result<(), RuntimeFailure> {
    crate::require_workspace_window(&window).map_err(|_| RuntimeFailure::window_denied())?;
    tauri::async_runtime::spawn_blocking(move || {
        let unavailable = || RuntimeFailure::rejected(503, "runtime-update-failed");
        let _location = PROJECT_LOCATION_GATE
            .lock()
            .map_err(|_| unavailable())?;
        let mut fence = app
            .state::<RestartFence>()
            .inner()
            .0
            .lock()
            .map_err(|_| unavailable())?;
        if fence.as_deref() != Some(token.as_str()) {
            return Err(RuntimeFailure::rejected(409, "runtime-update-reservation-changed"));
        }
        app.state::<neubiki_recording::RecordingService>()
            .request("restart-release", serde_json::json!({}))
            .map_err(|_| RuntimeFailure::unconfirmed("runtime-update-failed"))?;
        *fence = None;
        Ok(())
    })
    .await
    .map_err(|_| RuntimeFailure::unconfirmed("runtime-update-failed"))?
}

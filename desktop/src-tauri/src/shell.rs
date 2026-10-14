//! Kabuk durumu: kayıtlı mod, kiosk kilidi, oturum özeti.
//! Oturum çerezi diske yazılmaz. Kiosk çıkışı WebView çerezini okuyup
//! `POST /api/desktop/kiosk-exit` çağrısını kendisi yapar; nonce sayfaya verilmez.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};
use url::Url;

use crate::navigation::{self, AccessUser, Decision};
use crate::printer;

const INIT_SCRIPT: &str = concat!(include_str!("../../ui/policy.js"), "\n", include_str!("../../ui/inject.js"));

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub kiosk: bool,
    #[serde(default)]
    pub printer: String,
}

impl Default for Prefs {
    fn default() -> Self {
        Self { mode: None, kiosk: false, printer: String::new() }
    }
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct DesktopSession {
    pub user_id: String,
    pub name: String,
    pub role: String,
    pub company_id: String,
    pub permissions: HashMap<String, String>,
    pub modules: Option<HashMap<String, bool>>,
}

pub struct ShellState {
    pub prefs: Mutex<Prefs>,
    pub session: Mutex<Option<DesktopSession>>,
    pub shell_url: Mutex<Option<String>>,
    pub return_to_picker: AtomicBool,
    pub kiosk_locked: AtomicBool,
    pub exit_nonce: Mutex<Option<String>>,
}

impl ShellState {
    fn load(app: &AppHandle) -> Self {
        let prefs = prefs_path(app).ok().and_then(|path| fs::read(&path).ok()).and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
        Self {
            prefs: Mutex::new(prefs),
            session: Mutex::new(None),
            shell_url: Mutex::new(None),
            return_to_picker: AtomicBool::new(true),
            kiosk_locked: AtomicBool::new(false),
            exit_nonce: Mutex::new(None),
        }
    }
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join("shell-prefs.json"))
}

fn save_prefs(app: &AppHandle, prefs: &Prefs) -> Result<(), String> {
    let path = prefs_path(app)?;
    let body = serde_json::to_vec_pretty(prefs).map_err(|err| err.to_string())?;
    fs::write(path, body).map_err(|err| err.to_string())
}

fn fresh_nonce() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::getrandom(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn open_external(app: &AppHandle, url: &Url) {
    use tauri_plugin_opener::OpenerExt;
    let _ = app.opener().open_url(url.as_str(), None::<&str>);
}

fn allow_in_webview(app: &AppHandle, url: &Url) -> bool {
    match navigation::classify(url.as_str(), cfg!(debug_assertions)) {
        Decision::Allow => true,
        Decision::External => {
            open_external(app, url);
            false
        }
        Decision::Deny => false,
    }
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main").ok_or_else(|| "Ana pencere yok.".to_string())
}

fn go_shell(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    let stored = app.state::<ShellState>().shell_url.lock().map_err(|_| "kilit")?.clone();
    let target = stored.unwrap_or_else(|| "http://tauri.localhost/index.html".to_string());
    let url = Url::parse(&target).map_err(|err| err.to_string())?;
    window.navigate(url).map_err(|err| err.to_string())?;
    let _ = window.set_fullscreen(false);
    let _ = window.set_decorations(true);
    app.state::<ShellState>().kiosk_locked.store(false, Ordering::Relaxed);
    Ok(())
}

const KIOSK_EXIT_URL: &str = "https://app.tamkobi.com/api/desktop/kiosk-exit";

fn exit_pending(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<ShellState>();
    let slot = state.exit_nonce.lock().map_err(|_| "kilit".to_string())?;
    Ok(slot.as_deref().map(|nonce| !nonce.is_empty()).unwrap_or(false))
}

fn show_kiosk_exit(app: &AppHandle) -> Result<(), String> {
    let nonce = fresh_nonce();
    if nonce.is_empty() {
        return Err("Kiosk çıkışı doğrulanamadı.".into());
    }
    *app.state::<ShellState>().exit_nonce.lock().map_err(|_| "kilit")? = Some(nonce);
    let window = main_window(app)?;
    window
        .eval("window.__tamkobiShowKioskExit&&window.__tamkobiShowKioskExit()")
        .map_err(|err| err.to_string())
}

fn cookie_text_unsafe(text: &str) -> bool {
    text.chars().any(|ch| matches!(ch, '\r' | '\n' | ';' | ' '))
}

fn push_cookie(parts: &mut Vec<String>, token: &mut Option<String>, name: &str, value: &str) {
    if name.is_empty() || name.contains('=') || cookie_text_unsafe(name) || cookie_text_unsafe(value) {
        return;
    }
    if name == "access_token" && token.is_none() && !value.is_empty() {
        *token = Some(value.to_string());
    }
    parts.push(format!("{name}={value}"));
}

fn kiosk_response_allows(status: u16, body: &[u8]) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_slice(body).unwrap_or(serde_json::Value::Null);
    if (200..300).contains(&status) && parsed.get("allow").and_then(|value| value.as_bool()) == Some(true) {
        return Ok(());
    }
    let detail = parsed.get("detail").and_then(|value| value.as_str()).map(str::trim).filter(|text| !text.is_empty());
    Err(detail.unwrap_or("Kiosk çıkışı reddedildi.").to_string())
}

async fn read_session_credentials(window: WebviewWindow) -> Result<(String, Option<String>), String> {
    let url = Url::parse(KIOSK_EXIT_URL).map_err(|err| err.to_string())?;
    let cookies = tauri::async_runtime::spawn_blocking(move || window.cookies_for_url(url))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())?;
    let mut parts = Vec::new();
    let mut token = None;
    for item in cookies {
        push_cookie(&mut parts, &mut token, item.name(), item.value());
    }
    if parts.is_empty() && token.is_none() {
        return Err("Oturum çerezi bulunamadı.".into());
    }
    Ok((parts.join("; "), token))
}

fn ensure_tls_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

async fn post_kiosk_exit(cookie_header: String, token: Option<String>, body: serde_json::Value) -> Result<(), String> {
    ensure_tls_provider();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| "Kiosk çıkışı doğrulanamadı.".to_string())?;
    let bytes = serde_json::to_vec(&body).map_err(|err| err.to_string())?;
    let mut request = client
        .post(KIOSK_EXIT_URL)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .body(bytes);
    if !cookie_header.is_empty() {
        request = request.header("cookie", cookie_header);
    }
    if let Some(token) = token.filter(|value| !value.is_empty()) {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let response = request.send().await.map_err(|_| "Kiosk çıkışı doğrulanamadı.".to_string())?;
    let status = response.status().as_u16();
    let bytes = response.bytes().await.map_err(|_| "Kiosk çıkışı doğrulanamadı.".to_string())?;
    kiosk_response_allows(status, &bytes)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionUserIn {
    #[serde(default)]
    id: String,
    #[serde(default)]
    role: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    active_company_id: String,
    #[serde(default)]
    permissions: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct LicenseIn {
    #[serde(default)]
    modules: Option<HashMap<String, bool>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionReport {
    authenticated: bool,
    #[serde(default)]
    user: Option<SessionUserIn>,
    #[serde(default)]
    license: Option<LicenseIn>,
}

#[derive(Serialize)]
struct UserOut {
    name: String,
    role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModeOut {
    id: String,
    label: String,
    path: String,
    cashier: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellOut {
    user: Option<UserOut>,
    modes: Vec<ModeOut>,
    selected: Option<String>,
    kiosk: bool,
    printer: String,
}

#[derive(Serialize)]
struct UpdateOut {
    available: bool,
    version: String,
    notes: String,
}

fn session_modes(session: &DesktopSession) -> Vec<&'static str> {
    let access = AccessUser { role: &session.role, permissions: Some(&session.permissions) };
    navigation::visible_mode_ids(Some(&access), session.modules.as_ref())
}

#[tauri::command]
fn get_shell_state(state: tauri::State<'_, ShellState>) -> Result<ShellOut, String> {
    let prefs = state.prefs.lock().map_err(|_| "kilit")?;
    let session = state.session.lock().map_err(|_| "kilit")?;
    let (user, modes, selected) = if let Some(session) = session.as_ref() {
        let ids = session_modes(session);
        let selected = navigation::selected_mode(prefs.mode.as_deref(), &ids).map(|id| id.to_string());
        let modes = navigation::MODES
            .iter()
            .filter(|mode| ids.contains(&mode.id))
            .map(|mode| ModeOut {
                id: mode.id.to_string(),
                label: mode.label.to_string(),
                path: mode.path.to_string(),
                cashier: mode.cashier,
            })
            .collect();
        (
            Some(UserOut { name: session.name.clone(), role: session.role.clone() }),
            modes,
            selected,
        )
    } else {
        (None, Vec::new(), None)
    };
    Ok(ShellOut { user, modes, selected, kiosk: prefs.kiosk, printer: prefs.printer.clone() })
}

#[tauri::command]
fn shell_ready(window: WebviewWindow, state: tauri::State<'_, ShellState>) -> Result<(), String> {
    let url = window.url().map_err(|err| err.to_string())?;
    *state.shell_url.lock().map_err(|_| "kilit")? = Some(url.to_string());
    Ok(())
}

#[tauri::command]
fn set_prefs(app: AppHandle, state: tauri::State<'_, ShellState>, kiosk: Option<bool>, printer: Option<String>, mode: Option<String>) -> Result<(), String> {
    let mut prefs = state.prefs.lock().map_err(|_| "kilit")?;
    if let Some(kiosk) = kiosk {
        prefs.kiosk = kiosk;
    }
    if let Some(printer) = printer {
        prefs.printer = printer;
    }
    if let Some(mode) = mode {
        if navigation::mode_by_id(&mode).is_some() {
            prefs.mode = Some(mode);
        }
    }
    save_prefs(&app, &prefs)
}

#[tauri::command]
fn list_printers() -> printer::PrinterSnapshot {
    printer::list_printers()
}

#[tauri::command]
fn open_login(app: AppHandle, state: tauri::State<'_, ShellState>) -> Result<(), String> {
    state.return_to_picker.store(true, Ordering::Relaxed);
    state.kiosk_locked.store(false, Ordering::Relaxed);
    *state.session.lock().map_err(|_| "kilit")? = None;
    let window = main_window(&app)?;
    let _ = window.set_fullscreen(false);
    let _ = window.set_decorations(true);
    let url = Url::parse(navigation::LOGIN_URL).map_err(|err| err.to_string())?;
    window.navigate(url).map_err(|err| err.to_string())
}

#[tauri::command]
fn open_mode(app: AppHandle, state: tauri::State<'_, ShellState>, mode_id: String, kiosk: bool) -> Result<(), String> {
    let session = state.session.lock().map_err(|_| "kilit")?.clone().ok_or("Önce TamKobi'ye giriş yapın.")?;
    let visible = session_modes(&session);
    if !visible.iter().any(|id| *id == mode_id) {
        return Err("Bu mod için yetkiniz yok.".into());
    }
    let url = navigation::mode_url(&mode_id).ok_or("Mod bulunamadı.")?;
    {
        let mut prefs = state.prefs.lock().map_err(|_| "kilit")?;
        prefs.mode = Some(mode_id);
        prefs.kiosk = kiosk;
        save_prefs(&app, &prefs)?;
    }
    state.return_to_picker.store(false, Ordering::Relaxed);
    state.kiosk_locked.store(kiosk, Ordering::Relaxed);
    let window = main_window(&app)?;
    let _ = window.set_decorations(!kiosk);
    let _ = window.set_fullscreen(kiosk);
    window.navigate(Url::parse(&url).map_err(|err| err.to_string())?).map_err(|err| err.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
fn report_session(window: WebviewWindow, app: AppHandle, state: tauri::State<'_, ShellState>, payload: SessionReport) -> Result<(), String> {
    let current = window.url().map_err(|err| err.to_string())?;
    if !navigation::is_tamkobi_url(current.as_str()) {
        return Err("Oturum yalnız tamkobi sayfasından alınır.".into());
    }
    if !payload.authenticated {
        *state.session.lock().map_err(|_| "kilit")? = None;
        return Ok(());
    }
    let Some(user) = payload.user else {
        *state.session.lock().map_err(|_| "kilit")? = None;
        return Ok(());
    };
    if navigation::normalize_role(&user.role) != "admin" && user.permissions.is_empty() {
        *state.session.lock().map_err(|_| "kilit")? = None;
        return Ok(());
    }
    *state.session.lock().map_err(|_| "kilit")? = Some(DesktopSession {
        user_id: user.id,
        name: user.name,
        role: user.role,
        company_id: user.active_company_id,
        permissions: user.permissions,
        modules: payload.license.and_then(|license| license.modules),
    });
    if state.return_to_picker.swap(false, Ordering::Relaxed) {
        go_shell(&app)?;
    }
    Ok(())
}

#[tauri::command]
fn request_kiosk_exit(app: AppHandle, state: tauri::State<'_, ShellState>) -> Result<(), String> {
    if !state.kiosk_locked.load(Ordering::Relaxed) {
        state.return_to_picker.store(true, Ordering::Relaxed);
        return go_shell(&app);
    }
    show_kiosk_exit(&app)
}

#[tauri::command]
async fn complete_kiosk_exit(app: AppHandle, pin: String, approver_id: String, terminal_id: Option<String>) -> Result<(), String> {
    let pin = pin.trim().to_string();
    let approver_id = approver_id.trim().to_string();
    if pin.is_empty() || approver_id.is_empty() || !exit_pending(&app)? {
        return Err("Kiosk çıkışı doğrulanamadı.".into());
    }
    let company_id = {
        let state = app.state::<ShellState>();
        let session = state.session.lock().map_err(|_| "kilit")?;
        session.as_ref().map(|row| row.company_id.clone()).unwrap_or_default()
    };
    let mut payload = serde_json::Map::new();
    payload.insert("pin".into(), serde_json::Value::String(pin));
    payload.insert("user_id".into(), serde_json::Value::String(approver_id.clone()));
    payload.insert("approver_user_id".into(), serde_json::Value::String(approver_id));
    if !company_id.trim().is_empty() {
        payload.insert("company_id".into(), serde_json::Value::String(company_id));
    }
    if let Some(terminal_id) = terminal_id.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        payload.insert("terminal_id".into(), serde_json::Value::String(terminal_id));
    }
    let window = main_window(&app)?;
    let (cookie_header, token) = read_session_credentials(window).await?;
    if !exit_pending(&app)? {
        return Err("Kiosk çıkışı doğrulanamadı.".into());
    }
    post_kiosk_exit(cookie_header, token, serde_json::Value::Object(payload)).await?;
    if !exit_pending(&app)? {
        return Err("Kiosk çıkışı doğrulanamadı.".into());
    }
    {
        let state = app.state::<ShellState>();
        state.return_to_picker.store(true, Ordering::Relaxed);
    }
    go_shell(&app)?;
    {
        let state = app.state::<ShellState>();
        *state.exit_nonce.lock().map_err(|_| "kilit")? = None;
    }
    Ok(())
}

#[tauri::command]
fn silent_print(app: AppHandle, state: tauri::State<'_, ShellState>) -> Result<(), String> {
    let printer = state.prefs.lock().map_err(|_| "kilit")?.printer.clone();
    let window = main_window(&app)?;
    printer::print_webview(&window, printer::printer_name_for_job(&printer))
}

#[tauri::command]
async fn check_update(app: AppHandle) -> UpdateOut {
    use tauri_plugin_updater::UpdaterExt;
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => return UpdateOut { available: false, version: String::new(), notes: err.to_string() },
    };
    match updater.check().await {
        Ok(Some(update)) => UpdateOut {
            available: true,
            version: update.version.clone(),
            notes: update.body.clone().unwrap_or_default(),
        },
        Ok(None) => UpdateOut { available: false, version: String::new(), notes: String::new() },
        Err(err) => UpdateOut { available: false, version: String::new(), notes: err.to_string() },
    }
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|err| err.to_string())?;
    let Some(update) = updater.check().await.map_err(|err| err.to_string())? else {
        return Err("Güncelleme yok.".into());
    };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|err| err.to_string())?;
    app.restart()
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.handle().plugin(tauri_plugin_opener::init())?;
    app.handle().plugin(tauri_plugin_process::init())?;
    app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
    let state = ShellState::load(app.handle());
    app.manage(state);

    let handle = app.handle().clone();
    let window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("TamKobi")
        .inner_size(1180.0, 760.0)
        .min_inner_size(880.0, 600.0)
        .initialization_script(INIT_SCRIPT)
        .data_directory({
            let dir = handle.path().app_data_dir()?.join("webview");
            fs::create_dir_all(&dir)?;
            dir
        })
        .on_navigation({
            let handle = handle.clone();
            move |url| allow_in_webview(&handle, url)
        })
        .on_new_window({
            let handle = handle.clone();
            move |url, _features| {
                if allow_in_webview(&handle, &url) {
                    if let Some(main) = handle.get_webview_window("main") {
                        let _ = main.navigate(url);
                    }
                }
                tauri::webview::NewWindowResponse::Deny
            }
        })
        .build()?;

    if let Ok(url) = window.url() {
        if let Some(state) = handle.try_state::<ShellState>() {
            if let Ok(mut slot) = state.shell_url.lock() {
                *slot = Some(url.to_string());
            }
        }
    }

    let close_handle = handle.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            let locked = close_handle
                .try_state::<ShellState>()
                .map(|state| state.kiosk_locked.load(Ordering::Relaxed))
                .unwrap_or(false);
            if locked {
                api.prevent_close();
                let _ = show_kiosk_exit(&close_handle);
            }
        }
    });

    let login = Url::parse(navigation::LOGIN_URL)?;
    window.navigate(login)?;
    Ok(())
}

pub fn invoke_handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        get_shell_state,
        shell_ready,
        set_prefs,
        list_printers,
        open_login,
        open_mode,
        report_session,
        request_kiosk_exit,
        complete_kiosk_exit,
        silent_print,
        check_update,
        install_update,
    ]
}

#[cfg(test)]
mod tests {
    use super::{kiosk_response_allows, push_cookie};

    #[test]
    fn unlocks_only_when_allow_is_boolean_true() {
        assert!(kiosk_response_allows(200, br#"{"allow":true}"#).is_ok());
        assert!(kiosk_response_allows(200, br#"{"allow":true,"detail":""}"#).is_ok());
        assert!(kiosk_response_allows(200, "{\"allow\":false,\"detail\":\"Bu PIN yonetici onayi veremez.\"}".as_bytes()).is_err());
        assert!(kiosk_response_allows(200, br#"{"allow":"true"}"#).is_err());
        assert!(kiosk_response_allows(403, br#"{"allow":true}"#).is_err());
        assert_eq!(
            kiosk_response_allows(401, "{\"detail\":\"PIN hatali.\"}".as_bytes()).unwrap_err(),
            "PIN hatali."
        );
        assert_eq!(kiosk_response_allows(500, b"not-json").unwrap_err(), "Kiosk çıkışı reddedildi.");
    }

    #[test]
    fn session_header_uses_cookie_and_access_token() {
        let mut parts = Vec::new();
        let mut token = None;
        push_cookie(&mut parts, &mut token, "access_token", "abc.def");
        push_cookie(&mut parts, &mut token, "other", "1");
        push_cookie(&mut parts, &mut token, "bad name", "x");
        push_cookie(&mut parts, &mut token, "broken", "a\nb");
        assert_eq!(parts.join("; "), "access_token=abc.def; other=1");
        assert_eq!(token.as_deref(), Some("abc.def"));
    }
}

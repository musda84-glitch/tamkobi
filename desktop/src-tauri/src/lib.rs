mod navigation;
mod printer;
mod shell;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(shell::invoke_handler())
        .setup(|app| shell::setup(app))
        .run(tauri::generate_context!())
        .expect("TamKobi masaüstü kabuğu açılamadı");
}

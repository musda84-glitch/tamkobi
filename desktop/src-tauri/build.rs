fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "get_shell_state",
                "shell_ready",
                "set_prefs",
                "list_printers",
                "open_login",
                "open_mode",
                "report_session",
                "request_kiosk_exit",
                "complete_kiosk_exit",
                "silent_print",
                "check_update",
                "install_update",
            ]),
        ),
    )
    .expect("Tauri derlemesi başarısız");
}

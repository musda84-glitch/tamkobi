//! Windows yazıcı listesi ve WebView2 sessiz yazdırma.
//! Boş yazıcı adı işletim sisteminin varsayılan yazıcısı demektir.

use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrinterSnapshot {
    pub printers: Vec<String>,
    pub default_printer: Option<String>,
    pub supported: bool,
}

pub fn printer_name_for_job(selected: &str) -> Option<String> {
    let name = selected.trim();
    if name.is_empty() { None } else { Some(name.to_string()) }
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn parse_printer_payload(text: &str) -> PrinterSnapshot {
    #[derive(serde::Deserialize)]
    #[cfg_attr(not(any(windows, test)), allow(dead_code))]
    struct Raw {
        #[serde(default)]
        default: Option<String>,
        #[serde(default)]
        printers: Flexible,
    }
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum Flexible {
        Many(Vec<String>),
        One(String),
        Empty,
    }
    impl Default for Flexible {
        fn default() -> Self { Flexible::Empty }
    }
    let raw: Raw = serde_json::from_str(text).unwrap_or(Raw {
        default: None,
        printers: Flexible::Empty,
    });
    let mut printers = match raw.printers {
        Flexible::Many(items) => items,
        Flexible::One(item) => vec![item],
        Flexible::Empty => Vec::new(),
    };
    printers.retain(|name| !name.trim().is_empty());
    let default_printer = raw.default.and_then(|name| {
        let trimmed = name.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });
    PrinterSnapshot { printers, default_printer, supported: true }
}

pub fn list_printers() -> PrinterSnapshot {
    #[cfg(windows)]
    {
        match query_windows_printers() {
            Ok(mut snapshot) => {
                snapshot.supported = true;
                snapshot
            }
            Err(_) => PrinterSnapshot { printers: Vec::new(), default_printer: None, supported: true },
        }
    }
    #[cfg(not(windows))]
    {
        PrinterSnapshot { printers: Vec::new(), default_printer: None, supported: false }
    }
}

#[cfg(windows)]
fn query_windows_printers() -> Result<PrinterSnapshot, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let script = r#"
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$names = @(Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name)
$default = @(Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -ExpandProperty Name | Select-Object -First 1)
[pscustomobject]@{ default = $(if ($default.Count) { $default[0] } else { $null }); printers = $names } | ConvertTo-Json -Compress
"#;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| err.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(parse_printer_payload(&String::from_utf8_lossy(&output.stdout)))
}

pub fn print_webview(window: &tauri::WebviewWindow, printer: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .with_webview(move |webview| {
                let controller = webview.controller();
                let result = unsafe { print_silent(&controller, printer.as_deref()) };
                let _ = tx.send(result);
            })
            .map_err(|err| err.to_string())?;
        return rx
            .recv_timeout(std::time::Duration::from_secs(20))
            .map_err(|_| "Yazdırma zaman aşımı.".to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (window, printer);
        Err("Sessiz yazdırma yalnızca Windows kurulumunda kullanılabilir.".into())
    }
}

#[cfg(windows)]
unsafe fn print_silent(
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    printer: Option<&str>,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2PrintSettings2, ICoreWebView2_16, ICoreWebView2_2,
    };
    use webview2_com::PrintCompletedHandler;
    use windows_core::{Interface, HSTRING};

    let core = controller.CoreWebView2().map_err(|err| err.to_string())?;
    let core2: ICoreWebView2_2 = core.cast().map_err(|err| err.to_string())?;
    let environment = core2.Environment().map_err(|err| err.to_string())?;
    let environment6: ICoreWebView2Environment6 = environment.cast().map_err(|err| err.to_string())?;
    let settings = environment6.CreatePrintSettings().map_err(|err| err.to_string())?;
    let settings2: ICoreWebView2PrintSettings2 = settings.cast().map_err(|err| err.to_string())?;
    if let Some(name) = printer.map(str::trim).filter(|name| !name.is_empty()) {
        settings2.SetPrinterName(&HSTRING::from(name)).map_err(|err| err.to_string())?;
    }
    let core16: ICoreWebView2_16 = core.cast().map_err(|err| err.to_string())?;
    let handler = PrintCompletedHandler::create(Box::new(|_error, _status| Ok(())));
    core16.Print(&settings, &handler).map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_printer_uses_windows_default() {
        assert_eq!(printer_name_for_job(""), None);
        assert_eq!(printer_name_for_job("  "), None);
        assert_eq!(printer_name_for_job("XP-80").as_deref(), Some("XP-80"));
    }

    #[test]
    fn parses_printer_json() {
        let snapshot = parse_printer_payload(r#"{"default":"XP-80","printers":["XP-80","PDF"]}"#);
        assert_eq!(snapshot.default_printer.as_deref(), Some("XP-80"));
        assert_eq!(snapshot.printers, vec!["XP-80".to_string(), "PDF".to_string()]);
        let one = parse_printer_payload(r#"{"default":null,"printers":"PDF"}"#);
        assert_eq!(one.printers, vec!["PDF".to_string()]);
        assert!(one.default_printer.is_none());
    }
}

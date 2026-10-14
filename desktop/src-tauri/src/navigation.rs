//! Alan adı kısıtı ve mod görünürlüğü. Kabuk menüsü `ui/policy.js` ile aynı kuralları kullanır.

use std::collections::HashMap;

use url::Url;

pub const APP_ORIGIN: &str = "https://app.tamkobi.com";
pub const LOGIN_URL: &str = "https://app.tamkobi.com/login";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mode {
    pub id: &'static str,
    pub label: &'static str,
    pub path: &'static str,
    pub permission: &'static str,
    pub cashier: bool,
}

pub const MODES: &[Mode] = &[
    Mode { id: "atolye", label: "Atölye", path: "/atolye", permission: "/atolye", cashier: false },
    Mode { id: "sevk", label: "Depo Sevkiyatı", path: "/sevk", permission: "/sevk", cashier: false },
    Mode { id: "sayim", label: "Stok Sayımı", path: "/sayim", permission: "/sayim", cashier: false },
    Mode { id: "hizli-satis", label: "Hızlı Satış", path: "/hizli-satis", permission: "/hizli-satis", cashier: true },
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    External,
    Deny,
}

pub fn normalize_role(role: &str) -> String {
    let raw = role.trim().to_lowercase();
    match raw.as_str() {
        "owner" | "yönetici" | "yonetici" => "admin".to_string(),
        "müdür" | "mudur" => "manager".to_string(),
        other => other.to_string(),
    }
}

pub fn mode_by_id(mode_id: &str) -> Option<&'static Mode> {
    MODES.iter().find(|mode| mode.id == mode_id)
}

pub fn mode_url(mode_id: &str) -> Option<String> {
    mode_by_id(mode_id).map(|mode| format!("{APP_ORIGIN}{}", mode.path))
}

pub fn can_view(role: &str, permissions: Option<&HashMap<String, String>>, path: &str) -> bool {
    if normalize_role(role) == "admin" {
        return true;
    }
    let Some(perms) = permissions else {
        return false;
    };
    perms.get(path).map(|level| level.as_str()) != Some("none")
}

pub fn module_on(modules: Option<&HashMap<String, bool>>, path: &str) -> bool {
    match modules {
        None => true,
        Some(map) => map.get(path).copied().unwrap_or(true),
    }
}

pub struct AccessUser<'a> {
    pub role: &'a str,
    pub permissions: Option<&'a HashMap<String, String>>,
}

pub fn visible_mode_ids(user: Option<&AccessUser<'_>>, modules: Option<&HashMap<String, bool>>) -> Vec<&'static str> {
    let Some(user) = user else {
        return Vec::new();
    };
    MODES
        .iter()
        .filter(|mode| can_view(user.role, user.permissions, mode.permission) && module_on(modules, mode.permission))
        .map(|mode| mode.id)
        .collect()
}

pub fn selected_mode<'a>(saved: Option<&'a str>, visible: &[&'a str]) -> Option<&'a str> {
    saved.filter(|mode_id| visible.iter().any(|id| *id == *mode_id))
}

fn is_tamkobi_host(hostname: &str) -> bool {
    let host = hostname.trim().trim_end_matches('.').to_lowercase();
    host == "tamkobi.com" || host.ends_with(".tamkobi.com")
}

fn is_shell(url: &Url) -> bool {
    let scheme = url.scheme();
    let host = url.host_str().unwrap_or("").to_lowercase();
    scheme == "tauri" || scheme == "asset" || scheme == "ipc" || host == "tauri.localhost" || host == "ipc.localhost"
}

pub fn classify(input: &str, dev: bool) -> Decision {
    let Ok(url) = Url::parse(input) else {
        return Decision::Deny;
    };
    if is_shell(&url) {
        return Decision::Allow;
    }
    if url.scheme() == "http" {
        if let Some(host) = url.host_str() {
            if host == "localhost" || host == "127.0.0.1" {
                return if dev { Decision::Allow } else { Decision::Deny };
            }
        }
    }
    match url.scheme() {
        "blob" | "data" | "about" => Decision::Allow,
        "https" if is_tamkobi_host(url.host_str().unwrap_or("")) => Decision::Allow,
        "http" | "https" => Decision::External,
        _ => Decision::Deny,
    }
}

pub fn is_tamkobi_url(input: &str) -> bool {
    let Ok(url) = Url::parse(input) else {
        return false;
    };
    url.scheme() == "https" && is_tamkobi_host(url.host_str().unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perms(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| ((*k).to_string(), (*v).to_string())).collect()
    }

    #[test]
    fn mode_routes_and_hidden_permissions() {
        assert_eq!(mode_url("atolye").as_deref(), Some("https://app.tamkobi.com/atolye"));
        assert_eq!(mode_url("sevk").as_deref(), Some("https://app.tamkobi.com/sevk"));
        assert_eq!(mode_url("sayim").as_deref(), Some("https://app.tamkobi.com/sayim"));
        assert_eq!(mode_url("hizli-satis").as_deref(), Some("https://app.tamkobi.com/hizli-satis"));
        assert!(mode_url("ayarlar").is_none());
        assert!(mode_by_id("hizli-satis").unwrap().cashier);

        let sales_map = perms(&[
            ("/atolye", "none"),
            ("/sevk", "view"),
            ("/sayim", "none"),
            ("/hizli-satis", "edit"),
        ]);
        let sales = AccessUser { role: "sales", permissions: Some(&sales_map) };
        assert_eq!(visible_mode_ids(Some(&sales), None), vec!["sevk", "hizli-satis"]);

        let hidden = HashMap::from([("/sayim".to_string(), false)]);
        let admin = AccessUser { role: "owner", permissions: None };
        assert_eq!(
            visible_mode_ids(Some(&admin), Some(&hidden)),
            vec!["atolye", "sevk", "hizli-satis"]
        );
        assert!(visible_mode_ids(None, None).is_empty());
        let naked = AccessUser { role: "sales", permissions: None };
        assert!(visible_mode_ids(Some(&naked), None).is_empty());

        let visible = visible_mode_ids(Some(&sales), None);
        assert_eq!(selected_mode(Some("sevk"), &visible), Some("sevk"));
        assert_eq!(selected_mode(Some("atolye"), &visible), None);
    }

    #[test]
    fn domain_allowlist() {
        let allow = [
            "https://app.tamkobi.com/atolye",
            "https://b2b.tamkobi.com/siparis",
            "https://ik.tamkobi.com/",
            "https://tamkobi.com/",
            "http://tauri.localhost/index.html",
            "tauri://localhost/index.html",
            "http://ipc.localhost/command",
            "blob:https://app.tamkobi.com/00000000-0000-0000-0000-000000000000",
            "about:blank",
        ];
        for url in allow {
            assert_eq!(classify(url, false), Decision::Allow, "{url}");
        }
        assert_eq!(classify("https://app.tamkobi.com.evil.com/", false), Decision::External);
        assert_eq!(classify("https://example.com/", false), Decision::External);
        assert_eq!(classify("http://app.tamkobi.com/login", false), Decision::External);
        assert_eq!(classify("http://127.0.0.1:1420/", false), Decision::Deny);
        assert_eq!(classify("http://127.0.0.1:1420/", true), Decision::Allow);
        assert_eq!(classify("javascript:alert(1)", false), Decision::Deny);
        assert_eq!(classify("file:///etc/passwd", false), Decision::Deny);
        assert!(is_tamkobi_url("https://app.tamkobi.com/sevk"));
        assert!(!is_tamkobi_url("http://tauri.localhost/"));
    }
}

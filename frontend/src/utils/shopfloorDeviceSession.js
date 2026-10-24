/**
 * Atölye kiosk cihaz oturumu.
 * Eşleştirme kodu ve cihaz token'ı adres çubuğuna yazılmaz, loglanmaz.
 * Token yalnız bu tarayıcının localStorage kaydında durur.
 */
import { isPublicPath } from "./publicPath";

export const SHOPFLOOR_DEVICE_TOKEN_KEY = "tamkobi.shopfloorDeviceToken";
export const SHOPFLOOR_PAIR_PATH = "/atolye-eslestir";
export const SHOPFLOOR_HOME_PATH = "/atolye";
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CODE_RE = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{6}$`);

function browserStorage(storage) {
  if (storage) return storage;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readShopfloorDeviceToken(storage) {
  const box = browserStorage(storage);
  if (!box) return "";
  try {
    return String(box.getItem(SHOPFLOOR_DEVICE_TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function saveShopfloorDeviceToken(token, storage) {
  const value = String(token || "").trim();
  if (!value) return;
  const box = browserStorage(storage);
  if (!box) return;
  try {
    box.setItem(SHOPFLOOR_DEVICE_TOKEN_KEY, value);
  } catch {
    /* depolama kapalı */
  }
}

export function clearShopfloorDeviceToken(storage) {
  const box = browserStorage(storage);
  if (!box) return;
  try {
    box.removeItem(SHOPFLOOR_DEVICE_TOKEN_KEY);
  } catch {
    /* depolama kapalı */
  }
}

export function isShopfloorDevice(user) {
  if (!user || typeof user !== "object") return false;
  const kind = String(user.account_type || "").trim().toLowerCase();
  const role = String(user.role || "").trim().toLowerCase();
  return kind === "atolye_device" || role === "atolye_device";
}

/** Şirket yöneticisi. Backend tenant_access.is_company_admin ile aynı roller. */
export function canManageShopfloorDevices(user) {
  if (!user || typeof user !== "object") return false;
  if (user.is_super_admin) return true;
  const role = String(user.role || "").trim().toLowerCase();
  return role === "admin" || role === "owner";
}

export function shopfloorDeviceMayOpen(pathname) {
  const path = String(pathname || "/").split("?")[0].replace(/\/+$/, "") || "/";
  return path === SHOPFLOOR_HOME_PATH;
}

/** Geçersiz cihaz oturumu panelde kalmasın. Herkese açık sayfada adres değişmez. */
export function failedDeviceSessionTarget(pathname) {
  const path = String(pathname || "/").split("?")[0] || "/";
  if (path === SHOPFLOOR_PAIR_PATH || path.startsWith(`${SHOPFLOOR_PAIR_PATH}/`)) return "";
  if (isPublicPath(path)) return "";
  return SHOPFLOOR_PAIR_PATH;
}

export function normalizePairingCode(raw) {
  const text = String(raw ?? "").trim().toUpperCase();
  return CODE_RE.test(text) ? text : "";
}

export function scrubPairingCode(raw) {
  return String(raw ?? "")
    .toUpperCase()
    .replace(new RegExp(`[^${PAIRING_CODE_ALPHABET}]`, "g"), "")
    .slice(0, 6);
}

/** QR gövdesi düz koddur. Bağlantı adresi üretilmez. */
export function pairingQrValue(code) {
  return normalizePairingCode(code);
}

export function deviceStatusLabel(status) {
  if (status === "active") return "Aktif";
  if (status === "revoked") return "İptal";
  return "Bilinmiyor";
}

export function formatDeviceSeen(value) {
  if (!value) return "Henüz görülmedi";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Henüz görülmedi";
  return date.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

export function stationModeLabel(mode, stations) {
  const names = (Array.isArray(stations) ? stations : []).map((item) => String(item || "").trim()).filter(Boolean);
  if (mode === "one") return names[0] || "Tek istasyon";
  if (mode === "many") return names.join(", ") || "Seçili istasyonlar";
  return "Tüm istasyonlar";
}

export function formatCodeExpiry(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

/** İsteklere cihaz token'ını Bearer olarak ekler. Token değeri yazılmaz. */
export function attachShopfloorDeviceAuth(client) {
  const request = client?.interceptors?.request;
  if (!request || typeof request.use !== "function") return;
  if (client.__shopfloorDeviceAuth) return;
  client.__shopfloorDeviceAuth = true;
  request.use((config) => {
    const token = readShopfloorDeviceToken();
    if (!token) return config;
    const headers = config.headers;
    const current = headers?.Authorization
      || headers?.authorization
      || (typeof headers?.get === "function" ? headers.get("Authorization") : "");
    if (current) return config;
    const value = `Bearer ${token}`;
    if (headers && typeof headers.set === "function") {
      headers.set("Authorization", value);
      return config;
    }
    config.headers = { ...(headers || {}), Authorization: value };
    return config;
  });
}

const DEVICE_KEY = "tamkobi.deviceId";
const TOKEN_KEY = "tamkobi.deviceToken";
const LEGACY_PIN_KEY = "tamkobi.punchPin";

function newDeviceId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function browserDeviceId() {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing && existing !== "web-device") return existing;
    const id = newDeviceId();
    window.localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return "";
  }
}

export function readWebDeviceToken() {
  try { return window.localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

export function saveWebDeviceToken(token) {
  const value = String(token || "").trim();
  if (!value) return;
  try { window.localStorage.setItem(TOKEN_KEY, value); } catch { /* yoksay */ }
}

export function promptWebPunchPin(mode) {
  try { window.localStorage.removeItem(LEGACY_PIN_KEY); } catch { /* yoksay */ }
  const auth = String(mode || "off");
  if (!auth || auth === "off") return { ok: true, punch_pin: "" };
  const typed = window.prompt("Mesai PIN (4-6 rakam)");
  const pin = String(typed || "").trim();
  if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: "PIN 4-6 rakam olmalı.", punch_pin: "" };
  return { ok: true, punch_pin: pin };
}

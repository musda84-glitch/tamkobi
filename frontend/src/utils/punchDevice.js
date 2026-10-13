const DEVICE_KEY = "tamkobi.deviceId";
const PIN_KEY = "tamkobi.punchPin";

export function browserDeviceId() {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return "web-device";
  }
}

export function ensureWebPunchAuth(mode) {
  const auth = String(mode || "off");
  if (!auth || auth === "off") return { ok: true, punch_auth: false };
  let stored = "";
  try { stored = window.localStorage.getItem(PIN_KEY) || ""; } catch { stored = ""; }
  const typed = window.prompt(stored ? "Mesai PIN" : "Mesai PIN belirleyin (4-6 rakam)");
  if (!typed || !/^\d{4,6}$/.test(typed)) return { ok: false, error: "PIN 4-6 rakam olmalı." };
  if (!stored) {
    try { window.localStorage.setItem(PIN_KEY, typed); } catch { /* yoksay */ }
    return { ok: true, punch_auth: true };
  }
  if (stored !== typed) return { ok: false, error: "PIN hatalı." };
  return { ok: true, punch_auth: true };
}

/**
 * Tartı köprüsü: Web Serial (USB/Bluetooth seri tartı) + manuel kg girişi.
 * Desteklenmeyen tarayıcılarda yalnızca manuel mod çalışır.
 */

const STORAGE_KEY = "tamkobi_scale_settings";

export const loadScaleSettings = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
};

export const saveScaleSettings = (s) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s || {}));
};

export const scaleSupported = () => typeof navigator !== "undefined" && !!navigator.serial;

/** Basit tartı satırı ayrıştırıcı — "1.234 kg", "W:1.234", "ST,GS,+  1.234kg" vb. */
export function parseScaleWeight(raw) {
  const text = String(raw || "").replace(",", ".");
  const m = text.match(/([+-]?\d+(?:\.\d+)?)\s*(kg|g)?/i);
  if (!m) return null;
  let w = Number(m[1]);
  if (!Number.isFinite(w)) return null;
  if (String(m[2] || "").toLowerCase() === "g") w = w / 1000;
  return Math.round(w * 1000) / 1000;
}

/**
 * Web Serial ile tartıdan bir okuma dener; başarısız olursa null.
 * Bağlantı kullanıcı jestiyle (buton) açılmalıdır.
 */
export async function readScaleOnce({ baudRate } = {}) {
  if (!scaleSupported()) {
    throw new Error("Bu tarayıcı Web Serial desteklemiyor. Manuel kg girin veya Chrome kullanın.");
  }
  const settings = loadScaleSettings();
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: Number(baudRate || settings.baudRate || 9600) });
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 4000;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const weight = parseScaleWeight(buffer);
      if (weight != null && weight > 0) {
        saveScaleSettings({ ...settings, baudRate: baudRate || settings.baudRate || 9600 });
        return weight;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
    try { await port.close(); } catch { /* ignore */ }
  }
  throw new Error("Tartıdan ağırlık okunamadı. Bağlantı/baud hızını kontrol edin veya manuel girin.");
}

/** Kg birimli ürün mü? */
export const isWeighableUnit = (unit) => /^(kg|kilo|kilogram|gr|g|gram|lt|l|litre|liter)$/i.test(String(unit || "").trim());

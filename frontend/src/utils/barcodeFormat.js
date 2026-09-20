/** EAN-13 check digit validation (GS1). */
export function isEan13(code) {
  const c = String(code || "");
  if (!/^\d{13}$/.test(c)) return false;
  const sum = c.slice(0, 12).split("").reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(c[12]);
}

/** Prefer EAN-13 for valid 13-digit retail codes; otherwise CODE128. */
export function barcodeFormatFor(code) {
  return isEan13(code) ? "EAN13" : "CODE128";
}

/** Yanlışlıkla basmayı önlemek için onay metni. */
export function generateBarcodeConfirm(existing) {
  const current = String(existing || "").trim();
  if (current) return `Mevcut barkod (${current}) yeni bir barkodla değişecek. Üretmek istiyor musunuz?`;
  return "Yeni bir barkod üretilsin mi?";
}

export function confirmGenerateBarcode(existing) {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return window.confirm(generateBarcodeConfirm(existing));
}

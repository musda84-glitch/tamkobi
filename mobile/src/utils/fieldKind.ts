/** YYYY-AA / ay dönemi alanı → ay seçici. */
export function fieldUsesMonthPicker(
  testID?: string | null,
  label?: string | null,
  placeholder?: string | null,
): boolean {
  if (fieldUsesDatePicker(testID, placeholder)) return false;
  const id = String(testID || "");
  const lab = String(label || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
  const ph = String(placeholder || "").trim();
  if (/(month-input|-month$|bonus-period|pay-moves-month)$/.test(id)) return true;
  if (ph === "YYYY-AA" || /^\d{4}-\d{2}$/.test(ph)) return true;
  if (lab === "ay" || lab === "dönem" || lab.startsWith("dönem ")) return true;
  return false;
}

/** YYYY-MM-DD placeholder veya tarih test id → takvim. */
export function fieldUsesDatePicker(testID?: string | null, placeholder?: string | null): boolean {
  const ph = String(placeholder || "");
  const id = String(testID || "");
  return ph.includes("YYYY-MM-DD") || /date-input$/.test(id) || /(^|-)date$/.test(id);
}

/** Mesai / saat test id, “Saat” etiketi veya Örn: 2 kutusu → saat seçici. */
export function fieldUsesTimePicker(
  testID?: string | null,
  label?: string | null,
  placeholder?: string | null,
): boolean {
  const id = String(testID || "");
  const lab = String(label || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
  const ph = String(placeholder || "");
  if (/(hours-input|time-input)$/.test(id)) return true;
  if (/dispute-(note|in|out)/.test(id)) return true;
  if (lab === "saat" || lab === "toplam saat" || lab === "başlangıç saati" || lab === "bitiş saati") return true;
  if (lab === "doğru giriş" || lab === "doğru çıkış" || lab === "düzeltme açıklaması") return true;
  if (/^örn:\s*2([.,]\d+)?(\s*(sa|saat)?)?$/i.test(ph.trim())) return true;
  if (/\b\d{1,2}:\d{2}\b/.test(ph) && /olmalı|çıkış|giriş/i.test(ph)) return true;
  return false;
}

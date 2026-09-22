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
  if (lab === "saat" || lab === "toplam saat" || lab === "başlangıç saati" || lab === "bitiş saati") return true;
  if (/^örn:\s*2([.,]\d+)?(\s*(sa|saat)?)?$/i.test(ph.trim())) return true;
  return false;
}

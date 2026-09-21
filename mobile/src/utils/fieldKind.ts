/** YYYY-MM-DD placeholder veya tarih test id → takvim. */
export function fieldUsesDatePicker(testID?: string | null, placeholder?: string | null): boolean {
  const ph = String(placeholder || "");
  const id = String(testID || "");
  return ph.includes("YYYY-MM-DD") || /date-input$/.test(id) || /(^|-)date$/.test(id);
}

/** Mesai / saat test id → saat seçici. */
export function fieldUsesTimePicker(testID?: string | null): boolean {
  return /(hours-input|time-input)$/.test(String(testID || ""));
}

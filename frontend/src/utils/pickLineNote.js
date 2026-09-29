/** B2B "Sipariş stok notu" on a warehouse pick line (session or order field aliases). */
export function pickLineNote(it) {
  return String(it?.note || it?.line_note || it?.stock_note || it?.notes || "").trim();
}

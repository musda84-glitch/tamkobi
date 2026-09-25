export function parseScanQtyInput(raw) {
  return Math.max(1, parseInt(String(raw ?? "").replace(/\D/g, ""), 10) || 1);
}

export function scanQtyShown(raw) {
  return raw == null ? "1" : String(raw);
}

export function scanQtyOnFocus() {
  return "";
}

export function scanQtyOnBlur(raw) {
  return String(parseScanQtyInput(raw));
}

/**
 * Seri okutma: `5*8690…`, `5xSKU`, `3×barkod` → çarpan + kod.
 * Ayrıştırıcı yoksa fallbackQty (adet çarpan alanı) kullanılır.
 */
export function parseBarcodeWithQty(raw, fallbackQty = 1) {
  const s = String(raw || "").trim();
  const fallback = parseScanQtyInput(fallbackQty);
  if (!s) return { barcode: "", quantity: fallback };
  const m = s.match(/^(\d{1,6})\s*[x×*]\s*(.+)$/i);
  if (m && String(m[2] || "").trim()) {
    return {
      barcode: String(m[2]).trim(),
      quantity: Math.max(1, parseInt(m[1], 10) || 1),
    };
  }
  return { barcode: s, quantity: fallback };
}

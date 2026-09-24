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

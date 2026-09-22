export function addressToggleLabel(expanded) {
  return expanded ? "Gizle" : "Göster";
}

export function shouldCollapseAddress(address, min = 36) {
  return String(address || "").trim().length > min;
}

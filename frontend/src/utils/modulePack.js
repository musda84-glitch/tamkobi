export function parseModuleKeys(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("/") ? s : `/${s}`));
}

export function serializeModuleKeys(keys) {
  return (keys || []).map((k) => String(k).replace(/^\//, "")).join(",");
}

export function packQuote(catalog, keys, yearly = false) {
  const set = new Set(keys || []);
  const monthly = (catalog || [])
    .filter((m) => !m.is_core && set.has(m.key))
    .reduce((s, m) => s + (Number(m.price_monthly) || 0), 0);
  return yearly ? monthly * 10 : monthly;
}

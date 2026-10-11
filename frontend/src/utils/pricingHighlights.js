/** Paket kartında öne çıkan modüller (tam liste karşılaştırma tablosunda). */
export const FEATURED_MODULE_PRIORITY = [
  "/invoices",
  "/edoc-inbox",
  "/contacts",
  "/stock",
  "/banking",
  "/ecommerce",
  "/orders",
  "/production",
  "/personnel",
  "/cargo",
  "/reports",
  "/communication",
];

export function highlightModules(planModules, catalog, limit = 6) {
  const included = new Set(planModules || []);
  const nonCore = (catalog || []).filter((m) => !m.is_core && included.has(m.key));
  const ordered = [];
  for (const key of FEATURED_MODULE_PRIORITY) {
    const hit = nonCore.find((m) => m.key === key);
    if (hit) ordered.push(hit);
  }
  for (const m of nonCore) {
    if (!ordered.some((x) => x.key === m.key)) ordered.push(m);
  }
  return ordered.slice(0, limit);
}

export function billableCatalog(catalog) {
  return (catalog || []).filter((m) => !m.is_core);
}

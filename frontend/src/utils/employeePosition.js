/** Personel pozisyon seçenekleri — şirket rollerinden (name saklanır). */
export function positionOptionsFromRoles(roles = [], current = "") {
  const seen = new Set();
  const opts = [];
  for (const r of roles || []) {
    const name = String(r?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    opts.push({ value: name, label: name, code: r.code || "" });
  }
  const cur = String(current || "").trim();
  if (cur && !seen.has(cur)) {
    opts.unshift({ value: cur, label: `${cur} (kayıtlı)`, code: "" });
  }
  return opts;
}

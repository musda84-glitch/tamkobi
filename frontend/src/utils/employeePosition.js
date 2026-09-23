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

/** Pozisyon adına göre rol kodu (Sistem Kullanıcısı davet/oluşturma için). */
export function roleCodeFromPosition(roles = [], position = "", fallback = "sales") {
  const pos = String(position || "").trim().toLocaleLowerCase("tr");
  if (!pos) return fallback;
  for (const r of roles || []) {
    const name = String(r?.name || "").trim().toLocaleLowerCase("tr");
    const code = String(r?.code || "").trim();
    if (name && name === pos && code) return code;
  }
  for (const r of roles || []) {
    const code = String(r?.code || "").trim();
    if (code && code.toLocaleLowerCase("tr") === pos) return code;
  }
  return fallback;
}

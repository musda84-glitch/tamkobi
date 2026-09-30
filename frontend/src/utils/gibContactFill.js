/** GİB /gib/lookup yanıtını cari form alanlarına uygular. */
export function gibLookupToContactPatch(res, current = {}) {
  if (!res || !res.tax_id) return {};
  const name = String(res.name || "").trim();
  const patch = {
    tax_number_or_id: String(res.tax_id),
    is_e_invoice_user: !!res.is_e_invoice_user,
  };
  if (res.alias) patch.e_invoice_alias = String(res.alias);
  if (name) {
    if (!String(current.name || "").trim()) patch.name = name;
    if (!String(current.company_title || "").trim()) patch.company_title = name;
  }
  if (res.tax_office && !String(current.tax_office || "").trim()) {
    patch.tax_office = String(res.tax_office);
  }
  return patch;
}

export function gibLookupSummary(res) {
  if (!res) return "";
  const kind = res.is_e_invoice_user ? "E-Fatura mükellefi" : "E-Arşiv";
  const src = res.source === "simulated" ? " (simüle)" : "";
  return `${kind}${src}: ${res.tax_id}${res.name ? ` — ${res.name}` : ""}`;
}

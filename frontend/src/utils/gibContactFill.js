/** GİB /gib/lookup yanıtını cari form alanlarına uygular. */
export function digitsTaxId(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}

export function isCompleteTaxId(value) {
  const tid = digitsTaxId(value);
  return tid.length === 10 || tid.length === 11;
}

export function gibLookupToContactPatch(res, current = {}, opts = {}) {
  if (!res || !res.tax_id) return {};
  const name = String(res.name || "").trim();
  const overwriteName = !!opts.overwriteName;
  const patch = {
    tax_number_or_id: String(res.tax_id),
    // Mükellefiyet her zaman GİB sonucundan gelir (manuel checkbox yerine).
    is_e_invoice_user: !!res.is_e_invoice_user,
  };
  if (res.alias) patch.e_invoice_alias = String(res.alias);
  if (name && (overwriteName || !String(current.name || "").trim())) patch.name = name;
  if (name && (overwriteName || !String(current.company_title || "").trim())) patch.company_title = name;
  if (res.tax_office && (overwriteName || !String(current.tax_office || "").trim())) {
    patch.tax_office = String(res.tax_office);
  }
  return patch;
}

export function gibMukellefLabel(isEInvoiceUser) {
  return isEInvoiceUser
    ? { title: "E-Fatura mükellefi", hint: "Faturalar e-Fatura olarak kesilir.", tone: "emerald" }
    : { title: "E-Arşiv (GİB e-Fatura listesinde değil)", hint: "Faturalar e-Arşiv olarak kesilir.", tone: "blue" };
}

export function gibLookupSummary(res) {
  if (!res) return "";
  const kind = res.is_e_invoice_user ? "E-Fatura mükellefi" : "E-Arşiv";
  const src = res.source === "simulated" ? " (simüle)" : "";
  return `${kind}${src}: ${res.tax_id}${res.name ? ` — ${res.name}` : ""}`;
}

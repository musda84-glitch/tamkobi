/** GİB TaxExemptionReasonCode — KDV %0 satırlarda zorunlu (İşNet Schematron). */
export const TAX_EXEMPTION_OPTIONS = [
  ["351", "351 – İstisna olmayan diğer"],
  ["350", "350 – Diğer istisnalar"],
  ["301", "301 – 11/1-a Mal ihracatı"],
  ["302", "302 – 11/1-a Hizmet ihracatı"],
  ["308", "308 – 13/ı Külçe altın / kıymetli maden"],
  ["309", "309 – 13/e Konut teslimi"],
  ["318", "318 – 17/1 Kültür / eğitim"],
  ["337", "337 – 17/4-g Serbest bölgeler"],
];

export const TAX_EXEMPTION_LABELS = Object.fromEntries(TAX_EXEMPTION_OPTIONS);

/** KDV %0 satır var ve muafiyet kodu henüz yoksa e-fatura onayında sor. */
export function invoiceNeedsExemptionPrompt(inv) {
  if (!inv) return false;
  if (String(inv.tax_exemption_code || inv.vat_exemption_code || "").trim()) {
    return false;
  }
  const items = Array.isArray(inv.items) ? inv.items : [];
  return items.some((it) => {
    if (Number(it?.vat_rate ?? 20) !== 0) return false;
    return !String(it?.vat_exemption_code || it?.tax_exemption_code || "").trim();
  });
}

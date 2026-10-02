/** GİB KDV tevkifat kodları — fatura formu + e-fatura onay modalı. */
export const WITHHOLDING_OPTIONS = [
  ["", "Tevkifat yok"],
  ["0.2|601", "2/10 – Yapım işleri (601)"],
  ["0.3|619", "3/10 – Makine/teçhizat bakım (619)"],
  ["0.5|602", "5/10 – Etüt, plan-proje, danışmanlık (602)"],
  ["0.5|603", "5/10 – Makine/teçhizat bakım (603)"],
  ["0.5|604", "5/10 – Yemek servisi (604)"],
  ["0.7|606", "7/10 – Temizlik, bahçe, çevre (606)"],
  ["0.7|608", "7/10 – Servis taşımacılığı (608)"],
  ["0.9|609", "9/10 – İşgücü temini (609)"],
  ["0.9|610", "9/10 – Yapı denetim (610)"],
  ["1|611", "10/10 – Fason tekstil (611)"],
  ["0.5|615", "5/10 – Reklam hizmetleri (615)"],
];

export function parseWithholdingValue(value) {
  if (!value) return { withholding_rate: 0, withholding_code: "" };
  const [r, c] = String(value).split("|");
  return { withholding_rate: Number(r || 0), withholding_code: c || "" };
}

/** İhracat / e-ihracat dışı, satırda KDV %0 ve tevkifat henüz seçilmemişse e-fatura kesiminde sor. */
export function invoiceNeedsWithholdingPrompt(inv) {
  if (!inv) return false;
  const trade = String(inv.trade_kind || "").toLowerCase();
  const eType = String(inv.e_type || "").toLowerCase();
  if (trade === "export" || eType === "e_export") return false;
  if (Number(inv.withholding_rate || 0) > 0 || String(inv.withholding_code || "").trim()) {
    return false;
  }
  const items = Array.isArray(inv.items) ? inv.items : [];
  return items.some((it) => Number(it?.vat_rate ?? 20) === 0);
}

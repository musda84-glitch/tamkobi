/** Banka hareketi eşleşme türleri (Cari + Fatura kaldırıldı). */
export const BANK_MATCH_MODES = [
  ["contact", "Cari"],
  ["transfer", "Kasa / Hesap (Virman)"],
  ["category", "Sadece Kategori"],
  ["expense", "Masraf"],
  ["pos_settlement", "POS bloke çözümü"],
];

/** Varsayılan personel masraf kategorisi (API değeri; UI etiketi "Personel"). */
export const PERSONNEL_EXPENSE_CATEGORY = "Personel Masrafı";

/** Personel seçilince ödeme türleri. Varsayılan: masraf iadesi. */
export const PERSONNEL_PAY_KINDS = [
  ["reimburse", "Masraf iadesi"],
  ["advance", "Avans"],
  ["salary", "Maaş"],
  ["overtime", "Mesai"],
  ["expense", "Şirket masrafı (personel adına)"],
];

export const DEFAULT_PERSONNEL_PAY_KIND = "reimburse";

/** Masraf kategorisi personel ödemesi mi? (Personel / Personel Masrafı). */
export function isPersonnelExpenseCategory(category) {
  return /^personel(\s+masraf[ıi])?$/i.test(String(category || "").trim())
    || /personel/i.test(String(category || "").trim());
}

/** Kategori select etiketi — Personel Masrafı → Personel. */
export function expenseCategoryOptionLabel(name) {
  const n = String(name || "").trim();
  if (/^personel(\s+masraf[ıi])?$/i.test(n)) return "Personel";
  return n;
}

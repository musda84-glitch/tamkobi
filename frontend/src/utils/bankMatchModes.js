/** Banka hareketi eşleşme türleri (Cari + Fatura kaldırıldı). */
export const BANK_MATCH_MODES = [
  ["contact", "Cari"],
  ["transfer", "Kasa / Hesap (Virman)"],
  ["category", "Sadece Kategori"],
  ["expense", "Masraf"],
];

/** Varsayılan personel masraf kategorisi (API değeri; UI etiketi "Personel"). */
export const PERSONNEL_EXPENSE_CATEGORY = "Personel Masrafı";

/** Personel seçilince ödeme türleri. */
export const PERSONNEL_PAY_KINDS = [
  ["expense", "Masraf"],
  ["advance", "Avans"],
  ["overtime", "Mesai"],
  ["salary", "Maaş"],
];

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

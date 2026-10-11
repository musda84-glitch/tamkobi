/** Banka hareketi eşleşme türleri (Cari + Fatura kaldırıldı). */
export const BANK_MATCH_MODES = [
  ["contact", "Cari"],
  ["transfer", "Kasa / Hesap (Virman)"],
  ["category", "Sadece Kategori"],
  ["expense", "Masraf"],
];

/** Masraf kategorisi personel ödemesi mi? (Personel Masrafı vb.) */
export function isPersonnelExpenseCategory(category) {
  return /personel/i.test(String(category || "").trim());
}

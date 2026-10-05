export const CARD_STMT_ACCEPT = "application/pdf,text/plain";
export const BANK_STMT_ACCEPT = "application/pdf,text/plain,.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function isCardAccount(acc) {
  return (acc?.type || "") === "credit_card";
}

/** Entegre olmayan vadesiz / kasa / POS hesapları — AI hareket yükleme. */
export function canUploadBankStatement(acc) {
  if (!acc) return false;
  if (isCardAccount(acc)) return false;
  if (acc.is_integrated) return false;
  return true;
}

export function defaultStatementKind(row, isCard) {
  const amount = Number(row?.amount) || 0;
  if (isCard && amount < 0) return "islem";
  if (row?.suggested_contact_id || row?.contact_id) return "cari_odeme";
  return isCard ? "masraf" : "islem";
}

/** Kart: harcama kırmızı, iade yeşil. Banka: giriş yeşil, çıkış kırmızı. */
export function statementAmountPositive(amount, isCard) {
  const n = Number(amount) || 0;
  return isCard ? n < 0 : n > 0;
}

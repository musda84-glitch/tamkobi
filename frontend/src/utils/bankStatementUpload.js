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

export function isStatementFile(value) {
  return typeof File !== "undefined" && value instanceof File;
}

/** onClick handler'ı File sanılmasın — tıklama olayı FormData'ya konunca analiz çöker. */
export function resolveStatementFile(picked, current) {
  if (isStatementFile(picked)) return picked;
  if (isStatementFile(current)) return current;
  return null;
}

export function asContactList(value) {
  return Array.isArray(value) ? value : [];
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** AI / proxy 200 gövdesi statement veya transactions eksik olsa da çizim patlamasın. */
export function statementRowsFromPayload(data, isCard) {
  const payload = asPlainObject(data);
  const statement = asPlainObject(payload.statement);
  const raw = Array.isArray(payload.transactions) ? payload.transactions : [];
  const rows = raw.map((t) => {
    const row = asPlainObject(t);
    return {
      ...row,
      included: row.included !== false && !row.duplicate && Number(row.amount) !== 0,
      kind: row.kind || defaultStatementKind(row, isCard),
      contact_id: row.contact_id || row.suggested_contact_id || "",
      contact_name: row.contact_name || row.suggested_contact_name || "",
      category: row.category || "Diğer",
    };
  });
  return { statement, rows, filename: payload.filename || "", mode: payload.mode || "" };
}

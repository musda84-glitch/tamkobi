/** Aynı IBAN / hesap no birden fazla hesaba bağlıysa uyarı. İsim tek başına uyarı değildir. */

import { duplicateRefMessage, isIban, maskedRef, normRef } from "./accountLabel";

export { isIban, normRef };

export function connectionRefs(conn, account) {
  const ibans = new Set();
  const numbers = new Set();
  const add = (raw) => {
    const token = normRef(raw);
    if (!token || token === "-") return;
    if (isIban(token)) ibans.add(token);
    else numbers.add(token);
  };
  if (account) {
    add(account.iban);
    add(account.account_number);
  }
  add(conn && conn.bank_account_number);
  return { ibans, numbers };
}

function refWarning(tur, noun, key, ids, byId) {
  const ordered = [...ids].sort((a, b) => {
    const bankA = String(byId.get(a)?.bank_name || "");
    const bankB = String(byId.get(b)?.bank_name || "");
    return bankA.localeCompare(bankB, "tr") || a.localeCompare(b);
  });
  const accounts = ordered.map((id) => byId.get(id) || {});
  const mask = maskedRef(key);
  return {
    tur,
    anahtar: `${mask}:${[...ids].sort().join(",")}`,
    adet: ids.size,
    mesaj: duplicateRefMessage(noun, accounts, mask),
  };
}

export function bankLinkWarnings(connections, accounts) {
  const byId = new Map();
  (accounts || []).forEach((account) => {
    const id = String(account.id || account._id || "");
    if (id) byId.set(id, account);
  });
  const ibanGroups = new Map();
  const numberGroups = new Map();
  (connections || []).forEach((conn) => {
    const accountId = String((conn && conn.linked_account_id) || "");
    if (!accountId) return;
    const refs = connectionRefs(conn, byId.get(accountId));
    refs.ibans.forEach((key) => {
      if (!ibanGroups.has(key)) ibanGroups.set(key, new Set());
      ibanGroups.get(key).add(accountId);
    });
    refs.numbers.forEach((key) => {
      if (!numberGroups.has(key)) numberGroups.set(key, new Set());
      numberGroups.get(key).add(accountId);
    });
  });
  const warnings = [];
  ibanGroups.forEach((ids, key) => {
    if (ids.size > 1) warnings.push(refWarning("cift_iban", "IBAN", key, ids, byId));
  });
  numberGroups.forEach((ids, key) => {
    if (ids.size > 1) warnings.push(refWarning("cift_hesap_no", "hesap no", key, ids, byId));
  });
  return warnings;
}

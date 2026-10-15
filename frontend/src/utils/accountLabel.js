/** Hesap türü ve görünen etiket. Tam IBAN/hesap no yazılmaz. */

export const ACCOUNT_TYPE_LABELS = {
  bank: "Banka hesabı",
  cash_box: "Kasa",
  pos: "POS",
  okc_pos: "ÖKC",
  credit_card: "Kredi kartı",
};

const TYPE_ALIAS = {
  cash: "cash_box",
  kasa: "cash_box",
  cashbox: "cash_box",
  nakit: "cash_box",
  banka: "bank",
  okc: "okc_pos",
  kart: "credit_card",
  card: "credit_card",
};

export function normRef(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

export function isIban(value) {
  const token = normRef(value);
  return token.startsWith("TR") && token.length >= 15 && /^[A-Z0-9]+$/.test(token);
}

export function accountTypeLabel(type) {
  const raw = String(type || "").trim().toLowerCase();
  if (!raw) return "";
  const key = TYPE_ALIAS[raw] || raw;
  return ACCOUNT_TYPE_LABELS[key] || type || "";
}

/** Son 4 hane. Tam değer dönmez. */
export function maskedRef(value) {
  const token = normRef(value);
  if (!token || token === "-") return "";
  return `…${token.slice(-4)}`;
}

export function accountMaskedRef(account) {
  if (!account) return "";
  const preset = String(account.masked_ref || "").trim();
  if (preset) return preset;
  if (isIban(account.iban)) return maskedRef(account.iban);
  const number = normRef(account.account_number);
  if (number && number !== "-") return maskedRef(number);
  return "";
}

/** Ör. Kuveyt Türk · Vadesiz TL Hesabı · …1234 · entegre */
export function accountDisplayLabel(account, opts = {}) {
  if (!account) return "Hesap";
  const bank = String(account.bank_name || "").trim();
  const name = String(account.account_name || account.name || account.ad || "").trim();
  const ref = accountMaskedRef(account);
  const integrated = opts.integrated != null
    ? !!opts.integrated
    : !!(account.is_integrated || account.entegre_mi);
  const parts = [];
  if (bank) parts.push(bank);
  if (name && name !== bank) parts.push(name);
  else if (!bank && name) parts.push(name);
  if (ref) parts.push(ref);
  if (integrated) parts.push("entegre");
  return parts.join(" · ") || name || bank || "Hesap";
}

export function duplicateRefMessage(noun, accounts, masked) {
  const bits = [];
  (accounts || []).forEach((account) => {
    const bank = String(account?.bank_name || "").trim() || "Hesap";
    const bit = masked ? `${bank} · ${masked}` : bank;
    if (!bits.includes(bit)) bits.push(bit);
  });
  const count = (accounts || []).length;
  if (bits.length) return `Aynı ${noun} ${count} hesaba bağlı: ${bits.join(", ")}.`;
  return `Aynı ${noun} ${count} hesaba bağlı.`;
}

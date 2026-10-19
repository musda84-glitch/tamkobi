/** Hesap türü ve görünen etiket. Tam IBAN/hesap no yazılmaz. */

import { bankShortName } from "./bankLogo";

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

function foldTr(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Baştaki banka adı / kısa ad ve onu izleyen " · " ayracı. */
function stripLeadingBank(value, prefix) {
  const src = String(value || "").trim();
  const pre = String(prefix || "").trim();
  if (!src || !pre) return src;
  const head = src.slice(0, pre.length);
  if (foldTr(head) !== foldTr(pre)) return src;
  const rest = src.slice(pre.length);
  if (rest && !/^[\s·]/.test(rest)) return src;
  return rest.replace(/^(?:\s*·\s*)+/u, "").trim();
}

/**
 * Kartın üç satırı. accountDisplayLabel değişmez.
 * bank: kısa ad ya da bank_name. name: önek temizlenmiş hesap adı.
 */
export function accountCardLabels(account) {
  if (!account) return { bank: "", name: "", ref: "" };
  const short = bankShortName(account) || "";
  const bankName = String(account.bank_name || "").trim();
  const bank = short || bankName;
  const prefixes = [...new Set([bankName, short, bank].map((item) => String(item || "").trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  let name = String(account.account_name || "").trim();
  prefixes.forEach((prefix) => {
    name = stripLeadingBank(name, prefix);
  });
  name = name.replace(/^(?:\s*·\s*)+/u, "").trim();
  if (!name) name = accountTypeLabel(account.type);
  return { bank, name, ref: accountMaskedRef(account) };
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

import { BANK_STMT_ACCEPT } from "./bankStatementUpload";

/** Mali müşavir panelinde AI ile yüklenebilir evrak türleri. */
export const ACCOUNTANT_AI_KINDS = [
  {
    id: "purchase",
    label: "Alış faturası",
    accept: "application/pdf,.pdf",
    hint: "Tedarikçi e-Fatura / e-Arşiv PDF",
  },
  {
    id: "sales",
    label: "Satış faturası",
    accept: "application/pdf,application/xml,text/xml,.xml,.pdf",
    hint: "Giden e-Fatura PDF veya UBL XML",
  },
  {
    id: "expense",
    label: "Masraf fişi",
    accept: "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf",
    hint: "Fiş fotoğrafı veya PDF",
  },
  {
    id: "cheque",
    label: "Çek / senet",
    accept: "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf",
    hint: "Çek veya senet görseli",
  },
  {
    id: "bank",
    label: "Banka ekstresi",
    accept: BANK_STMT_ACCEPT,
    hint: "Hesap hareketi PDF / CSV / Excel",
  },
];

export function accountantAiKindById(id) {
  return ACCOUNTANT_AI_KINDS.find((k) => k.id === id) || ACCOUNTANT_AI_KINDS[0];
}

export function guessAccountantDocKind(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  if (name.endsWith(".xml") || type.includes("xml")) return "sales";
  if (/cek|çek|senet|cheque|promissory/.test(name)) return "cheque";
  if (/\.(csv|xlsx)$/.test(name) || type.includes("csv") || type.includes("spreadsheet")) return "bank";
  if (/ekstre|extre|statement|hareket/.test(name)) return "bank";
  if (/fis|fiş|masraf|receipt|expense/.test(name)) return "expense";
  if (type.startsWith("image/")) return "expense";
  if (/satis|satış|earsiv|e-arsiv|earchive|giden/.test(name)) return "sales";
  return "purchase";
}

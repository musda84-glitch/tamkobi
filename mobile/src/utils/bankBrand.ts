/** Türk banka / POS marka renkleri + monogram. Resmi logolar kopyalanmaz. */

export type BankBrand = {
  key: string;
  label: string;
  initials: string;
  solid: string;
  bg: string;
  border: string;
  text: string;
};

const BRANDS: Record<string, BankBrand> = {
  kuveyt: { key: "kuveyt", label: "Kuveyt Türk", initials: "KT", solid: "#009640", bg: "#ECFDF3", border: "#86EFAC", text: "#14532D" },
  vakif: { key: "vakif", label: "VakıfBank", initials: "VB", solid: "#C9972E", bg: "#FFFBEB", border: "#FCD34D", text: "#78350F" },
  ziraat: { key: "ziraat", label: "Ziraat", initials: "ZB", solid: "#E30613", bg: "#FEF2F2", border: "#FECACA", text: "#991B1B" },
  halk: { key: "halk", label: "Halkbank", initials: "HB", solid: "#00529B", bg: "#EFF6FF", border: "#93C5FD", text: "#1E3A8A" },
  garanti: { key: "garanti", label: "Garanti BBVA", initials: "GA", solid: "#0066A1", bg: "#F0F9FF", border: "#7DD3FC", text: "#0C4A6E" },
  isbank: { key: "isbank", label: "İş Bankası", initials: "İŞ", solid: "#0033A0", bg: "#EEF2FF", border: "#A5B4FC", text: "#1E3A8A" },
  yapikredi: { key: "yapikredi", label: "Yapı Kredi", initials: "YK", solid: "#004F9F", bg: "#EFF6FF", border: "#93C5FD", text: "#1E3A8A" },
  akbank: { key: "akbank", label: "Akbank", initials: "AK", solid: "#E30613", bg: "#FFF1F2", border: "#FECDD3", text: "#9F1239" },
  qnb: { key: "qnb", label: "QNB", initials: "QNB", solid: "#5C2D91", bg: "#F5F3FF", border: "#C4B5FD", text: "#5B21B6" },
  enpara: { key: "enpara", label: "Enpara", initials: "EN", solid: "#7C3AED", bg: "#F5F3FF", border: "#C4B5FD", text: "#5B21B6" },
  deniz: { key: "deniz", label: "Denizbank", initials: "DZ", solid: "#00205B", bg: "#EFF6FF", border: "#93C5FD", text: "#1E3A8A" },
  teb: { key: "teb", label: "TEB", initials: "TEB", solid: "#00A651", bg: "#ECFDF5", border: "#6EE7B7", text: "#065F46" },
  albaraka: { key: "albaraka", label: "Albaraka", initials: "AB", solid: "#A31F34", bg: "#FFF1F2", border: "#FECDD3", text: "#9F1239" },
  tfsk: { key: "tfsk", label: "Türkiye Finans", initials: "TF", solid: "#00843D", bg: "#ECFDF5", border: "#6EE7B7", text: "#14532D" },
  ing: { key: "ing", label: "ING", initials: "ING", solid: "#FF6200", bg: "#FFF7ED", border: "#FDBA74", text: "#9A3412" },
  hsbc: { key: "hsbc", label: "HSBC", initials: "HS", solid: "#DB0011", bg: "#FEF2F2", border: "#FECACA", text: "#991B1B" },
  seker: { key: "seker", label: "Şekerbank", initials: "ŞB", solid: "#007A3D", bg: "#ECFDF5", border: "#6EE7B7", text: "#14532D" },
  fiba: { key: "fiba", label: "Fibabanka", initials: "FB", solid: "#E31C23", bg: "#FEF2F2", border: "#FECACA", text: "#991B1B" },
  odea: { key: "odea", label: "Odeabank", initials: "OD", solid: "#6B2D7B", bg: "#FAF5FF", border: "#D8B4FE", text: "#6B21A8" },
  paytr: { key: "paytr", label: "PayTR", initials: "PT", solid: "#1A73E8", bg: "#EFF6FF", border: "#93C5FD", text: "#1E3A8A" },
  trendyol: { key: "trendyol", label: "Trendyol", initials: "TY", solid: "#F27A1A", bg: "#FFF7ED", border: "#FDBA74", text: "#9A3412" },
  other: { key: "other", label: "Banka", initials: "B", solid: "#475569", bg: "#F8FAFC", border: "#E2E8F0", text: "#334155" },
};

/** Daha özgül adlar önce. */
const ALIASES: [string, string][] = [
  ["kuveytturk", "kuveyt"],
  ["kuveyt turk", "kuveyt"],
  ["kuveyt", "kuveyt"],
  ["enpara", "enpara"],
  ["vakifbank", "vakif"],
  ["vakiflar", "vakif"],
  ["vakif", "vakif"],
  ["ziraat", "ziraat"],
  ["halkbank", "halk"],
  ["halk bank", "halk"],
  ["garanti bbva", "garanti"],
  ["garanti", "garanti"],
  ["isbank", "isbank"],
  ["is bank", "isbank"],
  ["turkiye is", "isbank"],
  ["yapikredi", "yapikredi"],
  ["yapi kredi", "yapikredi"],
  ["akbank", "akbank"],
  ["finansbank", "qnb"],
  ["qnb", "qnb"],
  ["denizbank", "deniz"],
  ["deniz", "deniz"],
  ["turk ekonomi", "teb"],
  [" teb", "teb"],
  ["albaraka", "albaraka"],
  ["turkiye finans", "tfsk"],
  ["ing bank", "ing"],
  ["ing", "ing"],
  ["hsbc", "hsbc"],
  ["sekerbank", "seker"],
  ["seker", "seker"],
  ["fibabanka", "fiba"],
  ["fiba", "fiba"],
  ["odeabank", "odea"],
  ["odea", "odea"],
  ["paytr", "paytr"],
  ["trendyol", "trendyol"],
];

const IBAN_CODES: Record<string, string> = {
  "00010": "ziraat",
  "00012": "halk",
  "00015": "vakif",
  "00032": "teb",
  "00046": "akbank",
  "00059": "seker",
  "00062": "garanti",
  "00064": "isbank",
  "00067": "yapikredi",
  "00099": "ing",
  "00111": "qnb",
  "00123": "hsbc",
  "00134": "deniz",
  "00203": "albaraka",
  "00205": "kuveyt",
  "00206": "tfsk",
};

function fold(value?: string | null): string {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a");
}

export function ibanBankCode(iban?: string | null): string {
  const compact = String(iban || "").replace(/\s+/g, "").toUpperCase();
  if (compact.length < 9 || !compact.startsWith("TR")) return "";
  return compact.slice(4, 9);
}

function matchAlias(haystack: string): string | null {
  const h = ` ${fold(haystack)} `;
  for (const [alias, key] of ALIASES) {
    if (h.includes(alias)) return key;
  }
  return null;
}

function fallbackInitials(name?: string | null): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toLocaleUpperCase("tr-TR");
  const one = (parts[0] || "B").replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, "");
  return (one.slice(0, 2) || "B").toLocaleUpperCase("tr-TR");
}

export function resolveBankBrand(input: {
  bank_name?: string | null;
  account_name?: string | null;
  iban?: string | null;
  integration_provider?: string | null;
} | null | undefined): BankBrand {
  const textKey = matchAlias([input?.bank_name, input?.account_name, input?.integration_provider].filter(Boolean).join(" "));
  if (textKey && BRANDS[textKey]) return BRANDS[textKey];
  const code = IBAN_CODES[ibanBankCode(input?.iban)];
  if (code && BRANDS[code]) return BRANDS[code];
  const other = BRANDS.other;
  return { ...other, initials: fallbackInitials(input?.bank_name || input?.account_name) };
}

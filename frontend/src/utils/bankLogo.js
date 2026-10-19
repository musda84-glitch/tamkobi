/** TR IBAN banka kodu → kısa ad ve monogram rengi. Logo dosyası /bank-logos/{kod}.svg. */

export const TR_BANKS = {
  "0010": { short: "Ziraat", color: "#C8102E" },
  "0012": { short: "Halkbank", color: "#0C4DA2" },
  "0015": { short: "VakıfBank", color: "#8A6D00" },
  "0032": { short: "TEB", color: "#5C1A6B" },
  "0046": { short: "Akbank", color: "#E10600" },
  "0062": { short: "Garanti BBVA", color: "#007A33" },
  "0064": { short: "İş Bankası", color: "#0033A0" },
  "0067": { short: "Yapı Kredi", color: "#003D7A" },
  "0111": { short: "QNB", color: "#6B1236" },
  "0134": { short: "DenizBank", color: "#0077C8" },
  "0203": { short: "Albaraka", color: "#E87722" },
  "0205": { short: "Kuveyt Türk", color: "#007A3D" },
  "0206": { short: "Türkiye Finans", color: "#00838F" },
  "0209": { short: "Ziraat Katılım", color: "#1B6B3A" },
  "0210": { short: "Vakıf Katılım", color: "#0E6B3C" },
};

const MONOGRAM_FALLBACK = "#64748b";

/** Daha uzun / daha özel adlar önce. Katılım bankaları ana markadan önce gelir. */
const NAME_RULES = [
  ["ziraat katilim", "0209"],
  ["vakif katilim", "0210"],
  ["turkiye finans", "0206"],
  ["finansbank", "0111"],
  ["kuveyt", "0205"],
  ["garanti", "0062"],
  ["akbank", "0046"],
  ["yapi kredi", "0067"],
  ["yapikredi", "0067"],
  ["is bank", "0064"],
  ["isbank", "0064"],
  ["halk bank", "0012"],
  ["halkbank", "0012"],
  ["deniz bank", "0134"],
  ["denizbank", "0134"],
  ["albaraka", "0203"],
  ["qnb", "0111"],
  ["vakif bank", "0015"],
  ["vakifbank", "0015"],
  ["ziraat", "0010"],
];

export function foldBankName(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesKeyword(folded, keyword) {
  if (!folded || !keyword) return false;
  if (keyword.includes(" ")) return folded.includes(keyword);
  if (keyword.length <= 3) return new RegExp(`(?:^|\\s)${keyword}(?:\\s|$)`).test(folded);
  if (new RegExp(`(?:^|\\s)${keyword}(?:\\s|$)`).test(folded)) return true;
  return folded.replace(/\s+/g, "").includes(keyword);
}

/** IBAN 5-9. karakterler (5 hane). Listede son 4 hane döner; geçersizse null. */
export function bankCodeFromIban(iban) {
  const token = String(iban || "").replace(/\s+/g, "").toUpperCase();
  if (!/^TR\d{24}$/.test(token)) return null;
  return token.slice(4, 9).slice(-4);
}

export function bankFromName(name) {
  const folded = foldBankName(name);
  if (!folded) return null;
  for (let i = 0; i < NAME_RULES.length; i += 1) {
    const [keyword, code] = NAME_RULES[i];
    if (matchesKeyword(folded, keyword)) return code;
  }
  if (/(?:^|\s)teb(?:\s|$)/.test(folded)) return "0032";
  return null;
}

/** `/api/files` yollarını aynı kökten çözer. Statik `/bank-logos` olduğu gibi kalır. */
export function displayBankLogoSrc(src) {
  const raw = String(src || "").trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  if (raw.startsWith("/bank-logos/") || raw.startsWith("bank-logos/")) {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
  const path = raw.startsWith("/") ? raw : (raw.startsWith("api/") ? `/${raw}` : raw);
  if (!path.startsWith("/api/")) return path;
  const base = String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
  if (!base) return path;
  if (typeof window !== "undefined" && window.location?.hostname) {
    try {
      const backend = new URL(base, window.location.origin);
      const pageHost = window.location.hostname;
      const backendLoopback = backend.hostname === "127.0.0.1" || backend.hostname === "localhost";
      const pageLoopback = pageHost === "127.0.0.1" || pageHost === "localhost";
      if (backendLoopback && !pageLoopback) return path;
      if (backend.origin === window.location.origin) return path;
    } catch {
      /* geçersiz taban adres */
    }
  }
  return `${base}${path}`;
}

function pushLogoSource(list, src) {
  const value = String(src || "").trim();
  if (!value || list.includes(value)) return;
  list.push(value);
}

/** src sırası: hesap logo_url → şirket bank_logos[kod] → /bank-logos/{kod}.svg. fallbackSrc kalanlar. */
export function bankLogoInfo(acc, company) {
  if (!acc) return null;
  const ibanCode = bankCodeFromIban(acc.iban);
  const nameCode = bankFromName(acc.bank_name);
  const known = (ibanCode && TR_BANKS[ibanCode] ? ibanCode : null) || (nameCode && TR_BANKS[nameCode] ? nameCode : null);
  const code = known || ibanCode || null;
  const logos = company && company.bank_logos && typeof company.bank_logos === "object" ? company.bank_logos : null;
  const sources = [];
  pushLogoSource(sources, acc.logo_url);
  if (logos) {
    if (ibanCode) pushLogoSource(sources, logos[ibanCode]);
    if (known) pushLogoSource(sources, logos[known]);
  }
  if (known) pushLogoSource(sources, `/bank-logos/${known}.svg`);
  if (!sources.length) return null;
  const meta = known ? TR_BANKS[known] : null;
  return {
    code: known || code,
    short: meta?.short || "",
    color: meta?.color || MONOGRAM_FALLBACK,
    src: sources[0],
    fallbackSrc: sources.slice(1),
  };
}

export function bankShortName(acc) {
  return bankLogoInfo(acc)?.short;
}

export { MONOGRAM_FALLBACK };

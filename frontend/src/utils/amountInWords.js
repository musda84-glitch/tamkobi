/** Tutarı Türkçe, boşluklu okunur biçime çevirir.
 * "bir bin" değil "bin"; "bir milyon" kalır. 0 kuruş yazılmaz.
 * TRY: Türk Lirası / Kuruş. Diğer para birimlerinde birim adı kodun kendisidir.
 */

const ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
const SCALES = ["", "bin", "milyon", "milyar", "trilyon", "katrilyon"];

function titleTr(sentence) {
  return String(sentence || "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase("tr-TR") + word.slice(1))
    .join(" ");
}

function tripletWords(n) {
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  const parts = [];
  if (hundreds === 1) parts.push("yüz");
  else if (hundreds > 1) parts.push(ONES[hundreds], "yüz");
  if (tens) parts.push(TENS[tens]);
  if (ones) parts.push(ONES[ones]);
  return parts.join(" ");
}

function integerWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (!n) return "sıfır";
  const groups = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i];
    if (!group) continue;
    const scale = SCALES[i] || "";
    if (i === 1 && group === 1) {
      parts.push("bin");
      continue;
    }
    const words = tripletWords(group);
    if (scale) parts.push(words, scale);
    else parts.push(words);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function currencyUnit(currency) {
  const code = String(currency || "TRY").trim().toUpperCase();
  if (!code || code === "TRY" || code === "TL" || code === "₺") {
    return { major: "Türk Lirası", minor: "Kuruş" };
  }
  return { major: code, minor: "Kuruş" };
}

function splitLiraKurus(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const [liraStr, kurusStr] = Math.abs(n).toFixed(2).split(".");
  return { lira: Number(liraStr), kurus: Number(kurusStr) };
}

/** "Yalnız: Bir Milyon İki Yüz Bin Türk Lirası Elli Kuruş" */
export function amountInWords(amount, currency = "TRY") {
  const parts = splitLiraKurus(amount);
  const { major, minor } = currencyUnit(currency);
  if (!parts) return `Yalnız: Sıfır ${major}`;
  const chunks = [];
  if (parts.lira > 0 || parts.kurus === 0) {
    chunks.push(integerWords(parts.lira), major);
  }
  if (parts.kurus > 0) chunks.push(integerWords(parts.kurus), minor);
  return `Yalnız: ${titleTr(chunks.join(" "))}`;
}

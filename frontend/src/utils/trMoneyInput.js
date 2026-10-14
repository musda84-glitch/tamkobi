/**
 * Türkçe tutar/miktar girişi: binlik nokta, ondalık virgül.
 * Hesap ve API sayı taşır; bu modül yalnız metin ↔ sayı çevirir.
 */

const DIGIT = /[0-9]/;

export function groupThousands(intDigits) {
  const digits = String(intDigits ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const body = digits || "0";
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function partsToNumber(parts) {
  if (!parts || parts.empty) return null;
  const intDigits = parts.intDigits || "0";
  const fracDigits = parts.fracDigits || "";
  if (!intDigits && !fracDigits) return null;
  const s = `${parts.neg ? "-" : ""}${intDigits || "0"}${fracDigits ? `.${fracDigits}` : ""}`;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Object.is(n, -0) ? 0 : n;
}

function formatFromParts(parts) {
  if (!parts || parts.empty) return { text: "", value: null };
  const intDigits = parts.intDigits || "0";
  const text = `${parts.neg ? "-" : ""}${groupThousands(intDigits)}${parts.fracOpen ? `,${parts.fracDigits}` : ""}`;
  return { text, value: partsToNumber(parts) };
}

/**
 * Serbest metin (yapıştırma, "20000.5", "20.000,50", "1,250.50").
 * Virgül ondalık, nokta binlik. Tek nokta ve 3'ten farklı hane ondalıktır
 * ("20000.5", "2.10"). "20.000" binliktir.
 */
export function parseTrParts(raw, { maxFractionDigits = 8, allowNegative = true } = {}) {
  let s = String(raw ?? "").trim();
  if (!s) return { empty: true, neg: false, intDigits: "", fracDigits: "", fracOpen: false };
  s = s.replace(/[\s\u00A0\u202F]/g, "").replace(/[₺$€£]/g, "");
  let neg = false;
  if (s.startsWith("-")) {
    neg = allowNegative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return { empty: true, neg: false, intDigits: "", fracDigits: "", fracOpen: false };

  let intRaw = "";
  let fracRaw = "";
  let fracOpen = false;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      intRaw = s.slice(0, lastComma).replace(/[.,]/g, "");
      fracRaw = s.slice(lastComma + 1).replace(/[.,]/g, "");
    } else {
      intRaw = s.slice(0, lastDot).replace(/[.,]/g, "");
      fracRaw = s.slice(lastDot + 1).replace(/[.,]/g, "");
    }
    fracOpen = true;
  } else if (hasComma) {
    const parts = s.split(",");
    if (parts.length > 2 && parts.slice(1).every((p) => p.length === 3)) {
      intRaw = parts.join("");
    } else {
      intRaw = parts[0];
      fracRaw = parts.slice(1).join("");
      fracOpen = true;
    }
  } else if (hasDot) {
    const parts = s.split(".");
    if (s.endsWith(".")) {
      intRaw = parts.slice(0, -1).join("");
      fracOpen = true;
    } else if (parts.length > 2) {
      const last = parts[parts.length - 1];
      const heads = parts.slice(0, -1);
      const grouped = parts.slice(1).every((p) => p.length === 3) && parts[0].length > 0 && parts[0].length <= 3;
      const headsGrouped = heads.slice(1).every((p) => p.length === 3) && heads[0].length > 0 && heads[0].length <= 3;
      if (grouped) intRaw = parts.join("");
      else if (headsGrouped && last.length !== 3) {
        intRaw = heads.join("");
        fracRaw = last;
        fracOpen = true;
      } else {
        intRaw = heads.join("");
        fracRaw = last;
        fracOpen = true;
      }
    } else {
      const [a, b] = parts;
      if (b.length === 3 && a.length > 0 && a.length <= 3) intRaw = a + b;
      else {
        intRaw = a;
        fracRaw = b;
        fracOpen = true;
      }
    }
  } else {
    intRaw = s;
  }

  intRaw = String(intRaw || "").replace(/\D/g, "");
  fracRaw = String(fracRaw || "").replace(/\D/g, "").slice(0, maxFractionDigits);
  if (!intRaw && !fracOpen) return { empty: true, neg: false, intDigits: "", fracDigits: "", fracOpen: false };
  if (!intRaw) intRaw = "0";
  else intRaw = intRaw.replace(/^0+(?=\d)/, "") || "0";
  const signed = Boolean(neg && (intRaw !== "0" || fracRaw || fracOpen));
  return { empty: false, neg: signed, intDigits: intRaw, fracDigits: fracRaw, fracOpen };
}

export function parseTrNumber(raw, options = {}) {
  return partsToNumber(parseTrParts(raw, options));
}

/** Yazarken: noktalar binliktir (yeni yazılan tek nokta çağıran tarafta virgüle çevrilir). */
export function formatTypingRaw(raw, { maxFractionDigits = 4, allowNegative = false } = {}) {
  const src = String(raw ?? "");
  if (allowNegative && src.trim() === "-") return { text: "-", value: null };
  let neg = false;
  if (allowNegative && /^\s*-/.test(src)) neg = true;
  const body = src.replace(/-/g, "").replace(/[^\d,]/g, "");
  const commaAt = body.indexOf(",");
  let intDigits = "";
  let fracDigits = "";
  let fracOpen = false;
  if (commaAt >= 0) {
    intDigits = body.slice(0, commaAt).replace(/\D/g, "");
    fracDigits = body.slice(commaAt + 1).replace(/\D/g, "").slice(0, maxFractionDigits);
    fracOpen = true;
  } else {
    intDigits = body.replace(/\D/g, "");
  }
  if (!intDigits && !fracOpen && !neg) return { text: "", value: null };
  if (!intDigits) intDigits = "0";
  else intDigits = intDigits.replace(/^0+(?=\d)/, "") || "0";
  return formatFromParts({
    empty: false,
    neg: Boolean(neg && (intDigits !== "0" || fracDigits || fracOpen)),
    intDigits,
    fracDigits,
    fracOpen,
  });
}

export function significantCount(text, caret) {
  const src = String(text ?? "");
  const end = Math.max(0, Math.min(Number.isFinite(caret) ? caret : src.length, src.length));
  let n = 0;
  for (let i = 0; i < end; i += 1) {
    const c = src[i];
    if (DIGIT.test(c) || c === ",") n += 1;
  }
  return n;
}

export function caretFromSignificant(text, count) {
  const src = String(text ?? "");
  if (!src) return 0;
  if (!count || count <= 0) return src.startsWith("-") ? 1 : 0;
  let n = 0;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (DIGIT.test(c) || c === ",") {
      n += 1;
      if (n >= count) return i + 1;
    }
  }
  return src.length;
}

function removedCharIndex(prev, next, caret) {
  if (next.length !== prev.length - 1) return -1;
  if (caret >= 0 && caret < prev.length && prev.slice(0, caret) + prev.slice(caret + 1) === next) return caret;
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    if (prev.slice(0, i) + prev.slice(i + 1) === next) return i;
  }
  return -1;
}

/**
 * Bir tuş vuruşu veya yapıştırma sonrası gösterim, sayı ve imleç.
 * `caret` yeni metindeki imleçtir.
 */
export function applyMoneyEdit(prevText, nextRaw, caret, options = {}) {
  const maxFractionDigits = options.maxFractionDigits ?? 4;
  const allowNegative = !!options.allowNegative;
  const inputType = options.inputType || "";
  const prev = String(prevText ?? "");
  const next = String(nextRaw ?? "");
  const caretPos = caret == null || Number.isNaN(Number(caret)) ? next.length : Number(caret);
  const opts = { maxFractionDigits, allowNegative };

  if (next.trim() === "") return { text: "", value: null, caret: 0 };

  const delta = next.length - prev.length;
  const pasted = inputType === "insertFromPaste" || inputType === "insertFromDrop" || delta > 1;

  if (!pasted && delta === -1) {
    const removed = removedCharIndex(prev, next, caretPos);
    if (removed >= 0 && prev[removed] === ".") {
      let digitPos = removed - 1;
      while (digitPos >= 0 && !DIGIT.test(prev[digitPos])) digitPos -= 1;
      if (digitPos >= 0) {
        const logical = prev.slice(0, digitPos) + prev.slice(digitPos + 1);
        const sig = significantCount(logical, digitPos);
        const formatted = formatTypingRaw(logical, opts);
        return { ...formatted, caret: caretFromSignificant(formatted.text, sig) };
      }
    }
  }

  let raw = next;
  let sigCaret = caretPos;
  if (!pasted && delta === 1 && caretPos > 0 && next[caretPos - 1] === ".") {
    const without = next.slice(0, caretPos - 1) + next.slice(caretPos);
    if (without === prev) {
      raw = `${next.slice(0, caretPos - 1)},${next.slice(caretPos)}`;
      sigCaret = caretPos;
    }
  }

  if (pasted) {
    const parts = parseTrParts(raw, opts);
    const formatted = formatFromParts(parts);
    return { ...formatted, caret: formatted.text.length };
  }

  const formatted = formatTypingRaw(raw, opts);
  const sig = significantCount(raw, sigCaret);
  return { ...formatted, caret: caretFromSignificant(formatted.text, sig) };
}

/** Odaktan çıkınca sabit hane. Fazla kuruş (ör. 236,3636) yuvarlanmaz, yalnız gösterilir. */
export function formatMoneyBlur(value, decimals = 2, { maxFractionDigits = 4 } = {}) {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : parseTrNumber(value, { maxFractionDigits: Math.max(maxFractionDigits, 8), allowNegative: true });
  if (n == null || !Number.isFinite(n)) return "";
  const minFrac = Math.max(0, decimals | 0);
  const maxFrac = Math.max(minFrac, maxFractionDigits | 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(maxFrac);
  const [intRaw, fracRaw = ""] = fixed.split(".");
  let frac = fracRaw.replace(/0+$/, "");
  if (frac.length < minFrac) frac = fracRaw.slice(0, minFrac).padEnd(minFrac, "0");
  else if (frac.length > maxFrac) frac = frac.slice(0, maxFrac);
  const text = `${groupThousands(intRaw)}${frac ? `,${frac}` : ""}`;
  return neg && n !== 0 ? `-${text}` : text;
}

/** Odaktayken tam sayı "20.000", ondalık varsa virgülden sonra (sondaki sıfır yok). */
export function formatMoneyFocus(value, maxFractionDigits = 4) {
  return formatMoneyBlur(value, 0, { maxFractionDigits });
}

export function sameMoney(a, b) {
  if (a == null || a === "") return b == null || b === "";
  if (b == null || b === "") return false;
  const na = typeof a === "number" ? a : parseTrNumber(a);
  const nb = typeof b === "number" ? b : parseTrNumber(b);
  if (na == null || nb == null) return false;
  return na === nb;
}

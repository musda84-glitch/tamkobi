/**
 * EAN-13 bar patterns (ISO/IEC 15420) — matches JsBarcode EAN13 used on web labels.
 * L = left odd, G = left even, R = right.
 */
const L = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
const G = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
const R = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];
/** First digit → parity for left 6 digits (0=L, 1=G). */
const PARITY: number[][] = [
  [0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 1, 1],
  [0, 0, 1, 1, 0, 1],
  [0, 0, 1, 1, 1, 0],
  [0, 1, 0, 0, 1, 1],
  [0, 1, 1, 0, 0, 1],
  [0, 1, 1, 1, 0, 0],
  [0, 1, 0, 1, 0, 1],
  [0, 1, 0, 1, 1, 0],
  [0, 1, 1, 0, 1, 0],
];

export function ean13Bits(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 13) return "";
  const d = digits.split("").map((c) => Number(c));
  const parity = PARITY[d[0]] || PARITY[0];
  let bits = "101";
  for (let i = 0; i < 6; i += 1) {
    const set = parity[i] === 0 ? L : G;
    bits += set[d[i + 1]] || L[0];
  }
  bits += "01010";
  for (let i = 7; i < 13; i += 1) {
    bits += R[d[i]] || R[0];
  }
  bits += "101";
  return bits;
}

export type Ean13SvgOpts = {
  height?: number;
  moduleWidth?: number;
  margin?: number;
  displayValue?: boolean;
  fontSize?: number;
};

export function ean13Svg(value: unknown, opts: Ean13SvgOpts = {}): string {
  const text = String(value ?? "").trim();
  if (!/^\d{13}$/.test(text)) return "";
  const bits = ean13Bits(text);
  if (!bits) return "";
  const height = opts.height ?? 46;
  const moduleWidth = opts.moduleWidth ?? 1.6;
  const margin = opts.margin ?? 10;
  const displayValue = opts.displayValue !== false;
  const fontSize = opts.fontSize ?? 11;
  const barH = height;
  const textH = displayValue ? fontSize + 4 : 0;
  const w = bits.length * moduleWidth + margin * 2;
  const h = barH + textH + margin * 2;
  const bars: string[] = [];
  let x = margin;
  let run = 0;
  let color = bits[0];
  const flush = () => {
    if (run && color === "1") {
      bars.push(`<rect x="${x.toFixed(2)}" y="${margin}" width="${(run * moduleWidth).toFixed(2)}" height="${barH}" fill="#000"/>`);
    }
    x += run * moduleWidth;
    run = 0;
  };
  for (const bit of bits) {
    if (bit === color) run += 1;
    else {
      flush();
      color = bit;
      run = 1;
    }
  }
  flush();
  const label = displayValue
    ? `<text x="${(w / 2).toFixed(2)}" y="${(margin + barH + fontSize).toFixed(2)}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="#000">${escapeXml(text)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(text)}" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" style="max-width:100%;height:auto;background:#fff">${bars.join("")}${label}</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

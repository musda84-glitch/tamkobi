/** CODE128-B patterns (values 0–106). Stop is 11 modules + terminal bar. */
const PATTERNS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "11000111010",
];

const START_B = 104;
const STOP = 106;

export function code128Bits(value: string): string {
  const chars = Array.from(String(value || ""));
  const values: number[] = [START_B];
  for (const ch of chars) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 127) continue;
    values.push(code - 32);
  }
  const checksum = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  values.push(checksum, STOP);
  return values.map((v, i) => (i === values.length - 1 ? `${PATTERNS[v]}11` : PATTERNS[v])).join("");
}

export type Code128SvgOpts = {
  height?: number;
  moduleWidth?: number;
  margin?: number;
  displayValue?: boolean;
  fontSize?: number;
};

export function code128Svg(value: unknown, opts: Code128SvgOpts = {}): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const height = opts.height ?? 46;
  const moduleWidth = opts.moduleWidth ?? 1.6;
  const margin = opts.margin ?? 10;
  const displayValue = opts.displayValue !== false;
  const fontSize = opts.fontSize ?? 11;
  const bits = code128Bits(text);
  const barH = displayValue ? height : height;
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

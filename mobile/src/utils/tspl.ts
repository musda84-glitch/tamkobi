/**
 * Xprinter XP-490B (TSPL) etiket üretimi — saf fonksiyonlar.
 * Türkçe: CODEPAGE 1254 (Windows-1254 baytları) veya metin BITMAP.
 */

export type LabelSize = {
  widthMm: number;
  heightMm: number;
  gapMm: number;
  dpi?: number;
};

export type TextMode = "codepage" | "bitmap";

export type TsplJob = {
  /** Okunabilir TSPL (Unicode). */
  source: string;
  /** Porta yazılacak baytlar. */
  bytes: Uint8Array;
};

export type ProductLabelInput = {
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: number | null;
  includePrice?: boolean;
  copies?: number;
  size: LabelSize;
  textMode?: TextMode;
};

export type WorkOrderLabelInput = {
  workOrderNo?: string | null;
  customer?: string | null;
  partName?: string | null;
  measure?: string | null;
  qr?: string | null;
  copies?: number;
  size: LabelSize;
  textMode?: TextMode;
};

export type ShipmentLabelInput = {
  orderNo?: string | null;
  customer?: string | null;
  address?: string | null;
  packageIndex: number;
  packageTotal: number;
  qr?: string | null;
  copies?: number;
  size: LabelSize;
  textMode?: TextMode;
};

const SERIAL_BAUD = new Set([9600, 19200, 38400, 57600, 115200]);

/** Windows-1254'te Latin-1'den ayrılan Türkçe harfler. */
const CP1254_SPECIAL: Record<number, number> = {
  0x011e: 0xd0, // Ğ
  0x011f: 0xf0, // ğ
  0x0130: 0xdd, // İ
  0x0131: 0xfd, // ı
  0x015e: 0xde, // Ş
  0x015f: 0xfe, // ş
  0x20ac: 0x80, // €
};

const CP1254_TAKEN = new Set([0xd0, 0xdd, 0xde, 0xf0, 0xfd, 0xfe]);

export function mmToDots(mm: number, dpi = 203): number {
  const d = Number(dpi) === 300 ? 300 : 203;
  return Math.max(0, Math.round(Number(mm) * (d / 25.4)));
}

export function clampCopies(copies: number | undefined, max = 200): number {
  const n = Math.round(Number(copies));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(max, n);
}

export function clampMm(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}

export function formatMm(value: number): string {
  const n = Math.round(value * 10) / 10;
  return Number.isInteger(n) ? String(n) : String(n);
}

export function isSerialBaudPort(port: number | string | undefined): boolean {
  return SERIAL_BAUD.has(Number(port));
}

export function escapeTsplText(value: unknown, max = 80): string {
  return String(value ?? "")
    .replace(/"/g, "'")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** EAN-13 kontrol hanesi (ilk 12 hane). */
export function ean13CheckDigit(d12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const n = Number(d12[i]) || 0;
    sum += i % 2 === 0 ? n : n * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === code[12];
}

/** 13 haneli geçerli EAN-13 veya 12 haneli gövde → EAN13; aksi CODE128. */
export function barcodeSymbology(raw: unknown): { kind: "EAN13" | "128"; data: string } | null {
  const compact = String(raw ?? "").replace(/\s+/g, "");
  if (!compact) return null;
  if (/^\d{12}$/.test(compact)) {
    return { kind: "EAN13", data: compact + ean13CheckDigit(compact) };
  }
  if (isValidEan13(compact)) return { kind: "EAN13", data: compact };
  const code128 = compact.replace(/[^0-9A-Za-z\-_.]/g, "").slice(0, 48);
  if (!code128) return null;
  return { kind: "128", data: code128 };
}

export function priceLabel(price: number | null | undefined, include = true): string | null {
  if (!include || price == null) return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(2)} TL`;
}

/** Unicode → Windows-1254. Sığmayan karakter null. */
export function encodeWindows1254Char(cp: number): number | null {
  if (CP1254_SPECIAL[cp] != null) return CP1254_SPECIAL[cp];
  if (cp >= 0 && cp < 0x80) return cp;
  if (cp >= 0xa0 && cp <= 0xff && !CP1254_TAKEN.has(cp)) return cp;
  return null;
}

export function encodeWindows1254(text: string): Uint8Array | null {
  const out: number[] = [];
  for (const ch of text) {
    const b = encodeWindows1254Char(ch.codePointAt(0) || 0);
    if (b == null) return null;
    out.push(b);
  }
  return Uint8Array.from(out);
}

export function encodeWindows1254Lossy(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const b = encodeWindows1254Char(ch.codePointAt(0) || 0);
    out.push(b == null ? 0x3f : b);
  }
  return Uint8Array.from(out);
}

/** 5×7 glifler, satır başına düşük 5 bit. */
const FONT5: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31],
  "3": [14, 17, 1, 6, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  "A": [14, 17, 17, 31, 17, 17, 17],
  "B": [30, 17, 17, 30, 17, 17, 30],
  "C": [14, 17, 16, 16, 16, 17, 14],
  "D": [30, 17, 17, 17, 17, 17, 30],
  "E": [31, 16, 16, 30, 16, 16, 31],
  "F": [31, 16, 16, 30, 16, 16, 16],
  "G": [14, 17, 16, 23, 17, 17, 14],
  "H": [17, 17, 17, 31, 17, 17, 17],
  "I": [14, 4, 4, 4, 4, 4, 14],
  "J": [7, 2, 2, 2, 2, 18, 12],
  "K": [17, 18, 20, 24, 20, 18, 17],
  "L": [16, 16, 16, 16, 16, 16, 31],
  "M": [17, 27, 21, 21, 17, 17, 17],
  "N": [17, 25, 21, 19, 17, 17, 17],
  "O": [14, 17, 17, 17, 17, 17, 14],
  "P": [30, 17, 17, 30, 16, 16, 16],
  "Q": [14, 17, 17, 17, 21, 18, 13],
  "R": [30, 17, 17, 30, 20, 18, 17],
  "S": [14, 17, 16, 14, 1, 17, 14],
  "T": [31, 4, 4, 4, 4, 4, 4],
  "U": [17, 17, 17, 17, 17, 17, 14],
  "V": [17, 17, 17, 17, 17, 10, 4],
  "W": [17, 17, 17, 21, 21, 21, 10],
  "X": [17, 17, 10, 4, 10, 17, 17],
  "Y": [17, 17, 10, 4, 4, 4, 4],
  "Z": [31, 1, 2, 4, 8, 16, 31],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 6, 6, 4],
  "-": [0, 0, 0, 31, 0, 0, 0],
  "/": [1, 2, 4, 4, 4, 8, 16],
  ":": [0, 12, 12, 0, 12, 12, 0],
  "x": [0, 0, 17, 10, 4, 10, 17],
  "Ç": [14, 17, 16, 16, 16, 17, 14],
  "Ğ": [14, 17, 16, 23, 17, 17, 14],
  "İ": [4, 0, 14, 4, 4, 4, 14],
  "Ö": [10, 0, 14, 17, 17, 17, 14],
  "Ş": [14, 17, 16, 14, 1, 17, 14],
  "Ü": [10, 0, 17, 17, 17, 17, 14],
  "ç": [0, 0, 14, 16, 14, 0, 6],
  "ğ": [0, 0, 15, 17, 15, 0, 6],
  "ı": [0, 0, 4, 4, 4, 4, 4],
  "ö": [0, 10, 14, 17, 17, 14, 0],
  "ş": [0, 0, 14, 16, 14, 1, 14],
  "ü": [0, 10, 17, 17, 17, 14, 0],
};

function glyphRows(ch: string): number[] {
  if (FONT5[ch]) return FONT5[ch];
  const upper = ch.toLocaleUpperCase("tr-TR");
  if (FONT5[upper]) return FONT5[upper];
  return [31, 17, 17, 17, 17, 17, 31];
}

export type TextBitmap = { widthBytes: number; height: number; data: Uint8Array };

/** Soldan sağa 8px glif (5px çizim + 3px boşluk), 8 satır. */
export function renderTextBitmap(text: string): TextBitmap {
  const chars = [...String(text || " ")].slice(0, 48);
  const used = chars.length ? chars : [" "];
  const height = 8;
  const widthBytes = used.length;
  const data = new Uint8Array(widthBytes * height);
  used.forEach((ch, i) => {
    const rows = glyphRows(ch);
    for (let y = 0; y < 7; y += 1) {
      data[y * widthBytes + i] = (rows[y] & 31) << 3;
    }
  });
  return { widthBytes, height, data };
}

type Piece =
  | { t: "line"; s: string }
  | { t: "text"; x: number; y: number; font: string; mul: number; text: string }
  | { t: "barcode"; x: number; y: number; kind: "128" | "EAN13"; h: number; data: string; readable: boolean }
  | { t: "qr"; x: number; y: number; data: string };

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const CRLF = Uint8Array.from([13, 10]);

function compile(pieces: Piece[], textMode: TextMode): TsplJob {
  const source: string[] = [];
  const chunks: Uint8Array[] = [];
  const pushLine = (line: string) => {
    source.push(line);
    chunks.push(encodeWindows1254Lossy(line), CRLF);
  };
  for (const piece of pieces) {
    if (piece.t === "line") {
      pushLine(piece.s);
      continue;
    }
    if (piece.t === "barcode") {
      const readable = piece.readable ? 1 : 0;
      pushLine(
        `BARCODE ${piece.x},${piece.y},"${piece.kind}",${piece.h},${readable},0,2,2,"${piece.data}"`,
      );
      continue;
    }
    if (piece.t === "qr") {
      const data = escapeTsplText(piece.data, 120);
      if (!data) continue;
      pushLine(`QRCODE ${piece.x},${piece.y},M,4,A,0,"${data}"`);
      continue;
    }
    const text = escapeTsplText(piece.text);
    if (!text) continue;
    const encoded = encodeWindows1254(text);
    const useBitmap = textMode === "bitmap" || !encoded;
    if (!useBitmap) {
      pushLine(`TEXT ${piece.x},${piece.y},"${piece.font}",0,${piece.mul},${piece.mul},"${text}"`);
      continue;
    }
    const bmp = renderTextBitmap(text);
    const header = `BITMAP ${piece.x},${piece.y},${bmp.widthBytes},${bmp.height},0,`;
    source.push(`${header}<${bmp.data.length} bytes>`);
    chunks.push(encodeWindows1254Lossy(header), bmp.data, CRLF);
  }
  return { source: `${source.join("\r\n")}\r\n`, bytes: concatBytes(chunks) };
}

function sizeHeader(size: LabelSize): Piece[] {
  const width = clampMm(size.widthMm, 100, 20, 120);
  const height = clampMm(size.heightMm, 50, 10, 300);
  const gap = clampMm(size.gapMm, 2, 0, 25);
  return [
    { t: "line", s: `SIZE ${formatMm(width)} mm,${formatMm(height)} mm` },
    { t: "line", s: `GAP ${formatMm(gap)} mm,0 mm` },
    { t: "line", s: "DIRECTION 1" },
    { t: "line", s: "REFERENCE 0,0" },
    { t: "line", s: "CODEPAGE 1254" },
    { t: "line", s: "CLS" },
  ];
}

function dots(mm: number, dpi: number): number {
  return mmToDots(mm, dpi);
}

function footer(copies: number | undefined): Piece[] {
  return [{ t: "line", s: `PRINT ${clampCopies(copies)},1` }];
}

export type TemplateLabelProduct = {
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  sale_price?: number | null;
  price?: number | null;
  vat_rate?: number | null;
  currency?: string | null;
  price_includes_vat?: boolean | null;
  category?: string | null;
  variant_name?: string | null;
  tags?: Array<string | null> | null;
};

export type TemplateLabelTpl = {
  width_mm?: number;
  height_mm?: number;
  page?: { gap_mm?: number } | null;
  elements?: Array<Record<string, unknown>> | null;
};

function elNum(el: Record<string, unknown>, key: string, fallback: number): number {
  const n = Number(el[key]);
  return Number.isFinite(n) ? n : fallback;
}

/** Etiket tasarımı punto → TSPL font (2/3/4), ethernet buildTsplLabel ile aynı eşik. */
function tsplFont(font: unknown): string {
  const n = Number(font);
  if (!Number.isFinite(n)) return "2";
  if (n >= 14) return "4";
  if (n >= 10) return "3";
  return "2";
}

function templatePriceText(el: Record<string, unknown>, product: TemplateLabelProduct): string {
  const raw = product.sale_price != null ? product.sale_price : product.price;
  if (raw == null || !Number.isFinite(Number(raw))) return "";
  const vatRate = Number(product.vat_rate ?? 20);
  const vat = Number.isFinite(vatRate) ? vatRate : 20;
  const base = Number(raw);
  const includes = Boolean(product.price_includes_vat);
  const amount = el.vat === "excl"
    ? (includes ? base / (1 + vat / 100) : base)
    : (includes ? base : base * (1 + vat / 100));
  if (!Number.isFinite(amount)) return "";
  const custom = String(el.currency || "").trim();
  const code = String(product.currency || "").trim();
  let suffix = custom || (!code || code === "TRY" || code === "₺" ? "TL" : code);
  if (suffix === "₺") suffix = "TL";
  const prefix = String(el.prefix || "");
  const kdv = el.vat === "excl" ? " +KDV" : "";
  return `${prefix}${amount.toFixed(2)} ${suffix}${kdv}`;
}

function templateFieldText(
  el: Record<string, unknown>,
  product: TemplateLabelProduct,
  companyName?: string | null,
): string {
  const field = String(el.field || "");
  const tags = Array.isArray(product.tags) ? product.tags : [];
  const map: Record<string, string> = {
    name: String(product.name || ""),
    sku: String(product.sku || ""),
    barcode_text: String(product.barcode || ""),
    price: templatePriceText(el, product),
    company: String(companyName || ""),
    text: String(el.text || ""),
    category: String(product.category || ""),
    variant: String(product.variant_name || ""),
    label_1: String(tags[0] || ""),
    label_2: String(tags[1] || ""),
    label_3: String(tags[2] || ""),
  };
  return map[field] ?? String(el.text || "");
}

/**
 * Stok kartı etiket şablonunu TSPL'e çevirir.
 * Boyut ve öğe yerleşimi şablondan; CODEPAGE 1254 / BITMAP, buildProductLabel ile aynı derleyiciden.
 * Öğesiz şablonda sabit ürün yerleşimi, şablonun eni ve boyuyla basılır.
 */
export function buildTemplateLabel(input: {
  product: TemplateLabelProduct;
  companyName?: string | null;
  tpl?: TemplateLabelTpl | null;
  copies?: number;
  size: LabelSize;
  textMode?: TextMode;
}): TsplJob {
  const dpi = input.size.dpi === 300 ? 300 : 203;
  const mode = input.textMode === "bitmap" ? "bitmap" : "codepage";
  const width = clampMm(input.tpl?.width_mm ?? input.size.widthMm, input.size.widthMm || 50, 20, 120);
  const height = clampMm(input.tpl?.height_mm ?? input.size.heightMm, input.size.heightMm || 30, 10, 300);
  const pageGap = input.tpl?.page?.gap_mm;
  const size: LabelSize = {
    widthMm: width,
    heightMm: height,
    gapMm: pageGap == null ? input.size.gapMm : pageGap,
    dpi,
  };
  const elements = Array.isArray(input.tpl?.elements) ? input.tpl!.elements! : [];
  if (!elements.length) {
    const priceRaw = input.product.sale_price != null ? input.product.sale_price : input.product.price;
    return buildProductLabel({
      name: input.product.name,
      sku: input.product.sku,
      barcode: input.product.barcode || input.product.sku,
      price: priceRaw == null ? null : Number(priceRaw),
      copies: input.copies,
      size,
      textMode: mode,
    });
  }
  const pieces: Piece[] = [...sizeHeader(size)];
  for (const el of elements) {
    const type = String(el.type || "");
    const x = dots(elNum(el, "x", 2), dpi);
    const y = dots(elNum(el, "y", 2), dpi);
    if (type === "barcode") {
      const code = barcodeSymbology(input.product.barcode || input.product.sku);
      if (!code) continue;
      pieces.push({
        t: "barcode",
        x,
        y,
        kind: code.kind,
        h: Math.max(40, dots(elNum(el, "h", 12), dpi)),
        data: code.data,
        readable: el.showText !== false,
      });
      continue;
    }
    if (type === "qr") {
      const data = String(input.product.barcode || input.product.sku || input.product.name || "");
      if (!data.trim()) continue;
      pieces.push({ t: "qr", x, y, data });
      continue;
    }
    if (type === "line") {
      const w = Math.max(1, dots(elNum(el, "w", 10), dpi));
      const h = Math.max(1, dots(elNum(el, "h", 0.3), dpi));
      pieces.push({ t: "line", s: `BAR ${x},${y},${w},${h}` });
      continue;
    }
    if (type === "box") {
      const x2 = dots(elNum(el, "x", 2) + elNum(el, "w", 10), dpi);
      const y2 = dots(elNum(el, "y", 2) + elNum(el, "h", 10), dpi);
      pieces.push({ t: "line", s: `BOX ${x},${y},${x2},${y2},2` });
      continue;
    }
    if (type !== "field" && type !== "text") continue;
    const text = templateFieldText(el, input.product, input.companyName);
    if (!text.trim()) continue;
    pieces.push({
      t: "text",
      x,
      y,
      font: tsplFont(el.font),
      mul: el.bold ? 2 : 1,
      text,
    });
  }
  pieces.push(...footer(input.copies));
  return compile(pieces, mode);
}

export function buildProductLabel(input: ProductLabelInput): TsplJob {
  const dpi = input.size.dpi === 300 ? 300 : 203;
  const mode = input.textMode === "bitmap" ? "bitmap" : "codepage";
  const width = clampMm(input.size.widthMm, 100, 20, 120);
  const height = clampMm(input.size.heightMm, 50, 10, 300);
  const pieces: Piece[] = [...sizeHeader(input.size)];
  const name = escapeTsplText(input.name, 42);
  const sku = escapeTsplText(input.sku, 24);
  if (name) {
    pieces.push({ t: "text", x: dots(2, dpi), y: dots(2, dpi), font: "3", mul: 1, text: name });
  }
  if (sku) {
    pieces.push({ t: "text", x: dots(2, dpi), y: dots(8, dpi), font: "2", mul: 1, text: sku });
  }
  const code = barcodeSymbology(input.barcode || input.sku);
  if (code) {
    const barH = Math.max(40, dots(Math.max(8, Math.min(18, height - 22)), dpi));
    pieces.push({
      t: "barcode",
      x: dots(2, dpi),
      y: dots(Math.min(14, Math.max(10, height - 18)), dpi),
      kind: code.kind,
      h: barH,
      data: code.data,
      readable: true,
    });
  }
  const price = priceLabel(input.price, input.includePrice !== false);
  if (price) {
    pieces.push({
      t: "text",
      x: dots(Math.max(2, width - 32), dpi),
      y: dots(Math.max(2, height - 8), dpi),
      font: "3",
      mul: 1,
      text: price,
    });
  }
  pieces.push(...footer(input.copies));
  return compile(pieces, mode);
}

export function buildWorkOrderLabel(input: WorkOrderLabelInput): TsplJob {
  const dpi = input.size.dpi === 300 ? 300 : 203;
  const mode = input.textMode === "bitmap" ? "bitmap" : "codepage";
  const width = clampMm(input.size.widthMm, 100, 20, 120);
  const pieces: Piece[] = [...sizeHeader(input.size)];
  const no = escapeTsplText(input.workOrderNo, 32);
  const customer = escapeTsplText(input.customer, 36);
  const part = escapeTsplText(input.partName, 42);
  const measure = escapeTsplText(input.measure, 42);
  let y = 2;
  if (no) {
    pieces.push({ t: "text", x: dots(2, dpi), y: dots(y, dpi), font: "3", mul: 1, text: no });
    y += 6;
  }
  if (customer) {
    pieces.push({ t: "text", x: dots(2, dpi), y: dots(y, dpi), font: "2", mul: 1, text: customer });
    y += 5;
  }
  if (part) {
    pieces.push({ t: "text", x: dots(2, dpi), y: dots(y, dpi), font: "2", mul: 1, text: part });
    y += 5;
  }
  if (measure) {
    pieces.push({ t: "text", x: dots(2, dpi), y: dots(y, dpi), font: "2", mul: 1, text: measure });
  }
  const qr = escapeTsplText(input.qr || input.workOrderNo || input.partName, 80);
  if (qr) {
    pieces.push({ t: "qr", x: dots(Math.max(8, width - 28), dpi), y: dots(2, dpi), data: qr });
  }
  pieces.push(...footer(input.copies));
  return compile(pieces, mode);
}

export function buildShipmentLabel(input: ShipmentLabelInput): TsplJob {
  const dpi = input.size.dpi === 300 ? 300 : 203;
  const mode = input.textMode === "bitmap" ? "bitmap" : "codepage";
  const width = clampMm(input.size.widthMm, 100, 20, 120);
  const index = Math.max(1, Math.round(Number(input.packageIndex) || 1));
  const total = Math.max(index, Math.round(Number(input.packageTotal) || index));
  const pieces: Piece[] = [...sizeHeader(input.size)];
  const orderNo = escapeTsplText(input.orderNo, 32);
  const customer = escapeTsplText(input.customer, 40);
  const address = escapeTsplText(input.address, 70);
  let y = 2;
  if (orderNo) {
    pieces.push({ t: "text", x: dots(2, dpi), y: dots(y, dpi), font: "3", mul: 1, text: orderNo });
    y += 6;
  }
  if (customer) {
    pieces.push({ t: "text", x: dots(2, dpi), y: dots(y, dpi), font: "2", mul: 1, text: customer });
    y += 5;
  }
  if (address) {
    pieces.push({ t: "text", x: dots(2, dpi), y: dots(y, dpi), font: "2", mul: 1, text: address });
    y += 6;
  }
  pieces.push({
    t: "text",
    x: dots(2, dpi),
    y: dots(y, dpi),
    font: "3",
    mul: 1,
    text: `Koli ${index}/${total}`,
  });
  const qr = escapeTsplText(input.qr || `${orderNo || "SEVK"}:${index}/${total}`, 80);
  if (qr) {
    pieces.push({ t: "qr", x: dots(Math.max(8, width - 28), dpi), y: dots(2, dpi), data: qr });
  }
  pieces.push(...footer(input.copies));
  return compile(pieces, mode);
}

/** Adet kadar ayrı koli etiketi (1/n … n/n). */
export function buildShipmentBatch(
  input: Omit<ShipmentLabelInput, "packageIndex" | "packageTotal" | "copies"> & { packageTotal?: number },
): TsplJob {
  const total = clampCopies(input.packageTotal, 50);
  const jobs: TsplJob[] = [];
  for (let i = 1; i <= total; i += 1) {
    const qr = input.qr || `SEVK:${escapeTsplText(input.orderNo, 40) || "SIP"}:${i}/${total}`;
    jobs.push(buildShipmentLabel({
      ...input,
      packageIndex: i,
      packageTotal: total,
      copies: 1,
      qr,
    }));
  }
  return {
    source: jobs.map((j) => j.source.trimEnd()).join("\r\n") + "\r\n",
    bytes: concatBytes(jobs.map((j) => j.bytes)),
  };
}

export function buildTestLabel(input: {
  name?: string | null;
  host: string;
  port: number;
  size: LabelSize;
  textMode?: TextMode;
}): TsplJob {
  const dpi = input.size.dpi === 300 ? 300 : 203;
  const mode = input.textMode === "bitmap" ? "bitmap" : "codepage";
  const pieces: Piece[] = [
    ...sizeHeader(input.size),
    { t: "text", x: dots(2, dpi), y: dots(2, dpi), font: "4", mul: 1, text: "TEST" },
    {
      t: "text",
      x: dots(2, dpi),
      y: dots(10, dpi),
      font: "2",
      mul: 1,
      text: escapeTsplText(input.name || "Xprinter XP-490B", 40),
    },
    {
      t: "text",
      x: dots(2, dpi),
      y: dots(16, dpi),
      font: "2",
      mul: 1,
      text: `${String(input.host).trim()}:${input.port}`,
    },
    {
      t: "text",
      x: dots(2, dpi),
      y: dots(22, dpi),
      font: "2",
      mul: 1,
      text: "ÇĞİÖŞÜ çğıöşü",
    },
    ...footer(1),
  ];
  return compile(pieces, mode);
}

export function formatMeasure(input: {
  dimensions?: string | null;
  measure?: string | null;
  size?: string | null;
  olcu?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  step_note?: string | null;
  notes?: string | null;
} | null | undefined): string {
  if (!input) return "";
  const explicit = [input.dimensions, input.measure, input.size, input.olcu]
    .map((v) => String(v || "").trim())
    .find(Boolean);
  if (explicit) return explicit.slice(0, 80);
  const nums = [input.length, input.width, input.height]
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length) return nums.map((n) => String(n)).join(" × ");
  const note = String(input.step_note || input.notes || "").trim();
  if (/\d+\s*[x×]\s*\d+|\d+\s*(mm|cm)\b/i.test(note)) return note.slice(0, 80);
  return "";
}

export function workOrderQr(workOrderNo?: string | null, id?: string | null): string {
  const no = String(workOrderNo || "").trim();
  const key = String(id || "").trim();
  if (no && key) return `WO:${no}:${key}`;
  return `WO:${no || key || "IS"}`;
}

export function concatJobs(jobs: TsplJob[]): TsplJob {
  if (!jobs.length) return { source: "", bytes: new Uint8Array() };
  return {
    source: jobs.map((j) => j.source.trimEnd()).join("\r\n") + "\r\n",
    bytes: concatBytes(jobs.map((j) => j.bytes)),
  };
}

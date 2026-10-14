/** e-Fatura / e-Arşiv görsel tasarım düzeni → canlı önizleme + XSLT. */

import { GIB_SEAL_JPEG_DATA_URL, gibSealAlt, gibSealCaption, gibSealKindForBlock } from "./einvoiceGibSeal";
import { STAMP_MAX_BYTES, stampPayloadBytes } from "./einvoiceStampImage";

export { GIB_SEAL_JPEG_DATA_URL, gibSealAlt, gibSealCaption, gibSealKindForBlock };

export const BLOCK_IDS = [
  "header", "supplier", "customer", "meta", "ettn", "lines", "totals",
  "notes", "iban", "balance", "stamp", "qr", "gib_seal_invoice", "gib_seal_archive", "spacer",
];

export const BLOCK_LABELS = {
  header: "Logo",
  gib_seal_invoice: "GİB e-Fatura",
  gib_seal_archive: "GİB e-Arşiv",
  supplier: "Satıcı",
  customer: "Alıcı",
  meta: "Fatura bilgileri",
  ettn: "ETTN",
  lines: "Kalemler",
  totals: "Toplamlar",
  notes: "Notlar",
  iban: "IBAN / ödeme",
  balance: "Güncel bakiye",
  stamp: "Kaşe / İmza",
  qr: "GİB karekod",
  spacer: "Boş alan",
};

export const SPAN_OPTIONS = [
  { span: 12, label: "Tam" },
  { span: 6, label: "1/2" },
  { span: 4, label: "1/3" },
];

export const SPAN_CLASS = { 12: "col-span-12", 6: "col-span-6", 4: "col-span-4" };

const BLOCK_HIDDEN_BY_DEFAULT = {
  ettn: false, gib_seal_invoice: true, gib_seal_archive: true, balance: true, stamp: true, qr: true, spacer: true,
};
const BLOCK_SPAN_BY_DEFAULT = {
  ettn: 12,
  gib_seal_invoice: 4,
  gib_seal_archive: 4,
  spacer: 4,
  supplier: 6,
  customer: 6,
  iban: 6,
  balance: 6,
  stamp: 6,
  qr: 6,
};

export const QR_SIZE_OPTIONS = [
  { size: 64, label: "64" },
  { size: 96, label: "96" },
  { size: 128, label: "128" },
  { size: 160, label: "160" },
];

export function asQrSize(value, fallback = 96) {
  const n = Number(value);
  return QR_SIZE_OPTIONS.some((o) => o.size === n) ? n : fallback;
}

/** ETTN / blok punto seçenekleri (varsayılan ETTN 18 ≈ eski fs+6). */
export const ETTN_FONT_SIZE_OPTIONS = [
  { size: 8, label: "8" },
  { size: 9, label: "9" },
  { size: 10, label: "10" },
  { size: 11, label: "11" },
  { size: 12, label: "12" },
  { size: 13, label: "13" },
  { size: 14, label: "14" },
  { size: 16, label: "16" },
  { size: 18, label: "18" },
  { size: 20, label: "20" },
  { size: 24, label: "24" },
];

export function asEttnFontSize(value, fallback = 18) {
  const n = Number(value);
  return ETTN_FONT_SIZE_OPTIONS.some((o) => o.size === n) ? n : fallback;
}

export const LOGO_SIZE_OPTIONS = [
  { size: 48, label: "48" },
  { size: 72, label: "72" },
  { size: 96, label: "96" },
  { size: 120, label: "120" },
];

export function asLogoSize(value, fallback = 72) {
  const n = Number(value);
  return LOGO_SIZE_OPTIONS.some((o) => o.size === n) ? n : fallback;
}

/** Kaşe / imza görünen genişliği (px). Kaynak dosya ayrıca 400 px'e sıkıştırılır. */
export const STAMP_SIZE_OPTIONS = [
  { size: 96, label: "96" },
  { size: 128, label: "128" },
  { size: 160, label: "160" },
  { size: 200, label: "200" },
];

export const STAMP_ALIGN_OPTIONS = [
  { id: "left", label: "Sol" },
  { id: "center", label: "Orta" },
  { id: "right", label: "Sağ" },
];

export function asStampSize(value, fallback = 128) {
  const n = Number(value);
  return STAMP_SIZE_OPTIONS.some((o) => o.size === n) ? n : fallback;
}

export function asStampAlign(value, fallback = "right") {
  const s = String(value || "");
  return STAMP_ALIGN_OPTIONS.some((o) => o.id === s) ? s : fallback;
}

export function asSpan(value, fallback = 12) {
  const n = Number(value);
  return n === 4 || n === 6 || n === 12 ? n : fallback;
}

/** Fatura bilgileri GİB kağıdı gibi her genişlikte dikey Liste: Etiket: Değer. */
export function metaGridColsClass(_span, _fieldCount) {
  return "grid-cols-1";
}

export const LINE_COL_IDS = ["no", "sku", "name", "desc", "barcode", "qty", "unit", "net_price", "price", "discount", "vat", "vat_amount", "total"];

export const LINE_COL_LABELS = {
  no: "Sıra",
  sku: "Stok Kodu",
  name: "Mal / Hizmet",
  desc: "Açıklama",
  barcode: "Barkod",
  qty: "Miktar",
  unit: "Birim",
  net_price: "KDV'siz fiyat",
  price: "Birim fiyat",
  discount: "İskonto",
  vat: "KDV",
  vat_amount: "KDV Tutarı",
  total: "Tutar",
};

/** UBL `unitCode` (UNECE Rec. 20) → ekranda görünen Türkçe birim. TamKobi Adet'i C62 yazar. */
export const UNIT_CODE_LABELS = {
  C62: "Adet",
  NIU: "Adet",
  EA: "Adet",
  Unit: "Adet",
  UNIT: "Adet",
  Adet: "Adet",
  KGM: "Kg",
  KG: "Kg",
  GRM: "Gr",
  MGM: "Mg",
  LTR: "Lt",
  L: "Lt",
  MLT: "Ml",
  CLT: "Cl",
  MTR: "Mt",
  M: "Mt",
  MMT: "Mm",
  CMT: "Cm",
  KTM: "Km",
  MTK: "M2",
  MTQ: "M3",
  CMK: "cm²",
  CMQ: "cm³",
  MMQ: "mm³",
  TNE: "Ton",
  PK: "Paket",
  PA: "Paket",
  CT: "Koli",
  BX: "Kutu",
  BG: "Torba",
  SA: "Çuval",
  RO: "Rulo",
  SET: "Takım",
  PR: "Çift",
  DZN: "Düzine",
  HUR: "Saat",
  DAY: "Gün",
  MON: "Ay",
  ANN: "Yıl",
  KWH: "kWh",
};

export function unitLabel(code) {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  return UNIT_CODE_LABELS[raw] || UNIT_CODE_LABELS[raw.toUpperCase()] || raw;
}

const LINE_COL_HIDDEN_BY_DEFAULT = {
  sku: true,
  desc: true,
  barcode: true,
  unit: true,
  net_price: true,
  discount: true,
  vat: true,
  vat_amount: true,
};

export const META_FIELD_IDS = [
  "customization", "profile", "invoice_type", "number", "invoice_date", "date",
  "issue_time", "despatch_no", "despatch_date", "due_date", "order_no",
];

export const META_FIELD_LABELS = {
  customization: "Özelleştirme No",
  profile: "Senaryo",
  invoice_type: "Fatura Tipi",
  number: "Fatura No",
  invoice_date: "Fatura Tarihi",
  date: "Düzenleme tarihi",
  issue_time: "Fatura Saati",
  despatch_no: "İrsaliye No",
  despatch_date: "İrsaliye Tarihi",
  due_date: "Son Ödeme Tarihi",
  order_no: "Sipariş No",
};

const META_FIELD_HIDDEN_BY_DEFAULT = { date: true, order_no: true };

export const HEADER_FIELD_IDS = ["supplier_name", "supplier_address", "supplier_vkn"];

export const HEADER_FIELD_LABELS = {
  supplier_name: "Satıcı unvanı",
  supplier_address: "Adres",
  supplier_vkn: "VKN / TCKN",
};

const HEADER_FIELD_HIDDEN_BY_DEFAULT = {
  supplier_name: true,
  supplier_address: true,
  supplier_vkn: true,
};

export const TOTAL_ROW_IDS = [
  "subtotal", "allowance", "matrah", "kdv", "tevkifat", "inclusive", "grand", "exemption",
];

export const TOTAL_ROW_LABELS = {
  subtotal: "Mal Hizmet Toplam Tutarı",
  allowance: "Toplam İskonto",
  matrah: "KDV Matrahı",
  kdv: "Hesaplanan (%20)",
  tevkifat: "Hesaplanan KDV Tevkifat",
  inclusive: "Vergiler Dahil Toplam Tutar",
  grand: "Ödenecek Tutar",
  exemption: "İstisna",
};

const TOTAL_ROW_HIDDEN_BY_DEFAULT = { tevkifat: true, exemption: true };

export const TOTAL_ROW_SAMPLE_KEY = {
  subtotal: "subtotal",
  allowance: "discount",
  matrah: "matrah",
  kdv: "vat",
  tevkifat: "withholding",
  inclusive: "inclusive",
  grand: "grand",
  exemption: "exemption",
};

export const FONT_OPTIONS = [
  { id: "Tahoma", label: "Tahoma" },
  { id: "Arial", label: "Arial" },
  { id: "Calibri", label: "Calibri" },
  { id: "DejaVu Sans", label: "DejaVu Sans" },
  { id: "Times New Roman", label: "Times New Roman" },
];

export const FONT_SIZE_OPTIONS = [
  { size: 8, label: "8" },
  { size: 9, label: "9" },
  { size: 10, label: "10" },
  { size: 11, label: "11" },
  { size: 12, label: "12" },
  { size: 13, label: "13" },
  { size: 14, label: "14" },
];

/** Blok punto: global 8–14 + ETTN geniş aralık. */
export const BLOCK_FONT_SIZE_OPTIONS = ETTN_FONT_SIZE_OPTIONS;

export function asFontSize(value, fallback = 12) {
  const n = Number(value);
  return FONT_SIZE_OPTIONS.some((o) => o.size === n) ? n : fallback;
}

export function asBlockFontSize(value, fallback = 12) {
  const n = Number(value);
  return BLOCK_FONT_SIZE_OPTIONS.some((o) => o.size === n) ? n : fallback;
}

export function asBlockFont(value, fallback = "Tahoma") {
  const s = String(value || "").trim();
  if (!s) return fallback;
  if (FONT_OPTIONS.some((f) => f.id === s)) return s;
  return s.slice(0, 80) || fallback;
}

/** Yazı tipi / punto uygulanabilir metin blokları (QR / mühür / spacer hariç). */
export const BLOCKS_WITH_FONT = new Set([
  "header", "supplier", "customer", "meta", "ettn", "lines", "totals", "notes", "iban", "balance",
]);

export function blockHasFont(id) {
  return BLOCKS_WITH_FONT.has(id);
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_LOGO = 420_000;

function idList(ids, hiddenByDefault) {
  return ids.map((id) => ({ id, hidden: !!hiddenByDefault[id] }));
}

function normalizeIdList(raw, ids, hiddenByDefault) {
  const seen = new Set();
  const out = [];
  for (const b of Array.isArray(raw) ? raw : []) {
    const id = String(b?.id || "");
    if (!ids.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, hidden: !!b.hidden });
  }
  for (const id of ids) {
    if (!seen.has(id)) out.push({ id, hidden: !!hiddenByDefault[id] });
  }
  return out;
}

function expandLegacyBlocks(raw, kind) {
  const out = [];
  for (const b of Array.isArray(raw) ? raw : []) {
    if (b?.id === "parties") {
      out.push({ id: "supplier", hidden: !!b.hidden, span: 6 });
      out.push({ id: "customer", hidden: !!b.hidden, span: 6 });
    } else if (b?.id === "invoice_no" || b?.id === "order_no") {
      continue;
    } else if (b?.id === "gib_seal") {
      const archive = kind === "e_archive";
      out.push({ id: "gib_seal_invoice", hidden: archive ? true : !!b.hidden, span: b.span ?? 4 });
      out.push({ id: "gib_seal_archive", hidden: archive ? !!b.hidden : true, span: b.span ?? 4 });
    } else {
      out.push(b);
    }
  }
  return out;
}

function deriveMetaFields(raw) {
  const listed = normalizeIdList(raw?.metaFields, META_FIELD_IDS, META_FIELD_HIDDEN_BY_DEFAULT);
  if (Array.isArray(raw?.metaFields) && raw.metaFields.length) return listed;
  const blocks = Array.isArray(raw?.blocks) ? raw.blocks : [];
  const orderBlk = blocks.find((b) => b?.id === "order_no");
  const invBlk = blocks.find((b) => b?.id === "invoice_no");
  return listed.map((f) => {
    if (f.id === "order_no" && orderBlk) return { ...f, hidden: !!orderBlk.hidden };
    if (f.id === "number" && invBlk) return { ...f, hidden: !!invBlk.hidden };
    return f;
  });
}

function normalizeBlockFontFields(b, id) {
  const out = {};
  if (b && b.fontSize != null && b.fontSize !== "") {
    out.fontSize = asBlockFontSize(b.fontSize, null);
    if (out.fontSize == null) delete out.fontSize;
  }
  if (b && typeof b.font === "string" && b.font.trim()) {
    out.font = asBlockFont(b.font, "");
    if (!out.font) delete out.font;
  }
  return out;
}

function normalizeBlocks(raw, kind, layoutFontHints = {}) {
  const seen = new Set();
  const out = [];
  for (const b of expandLegacyBlocks(raw, kind)) {
    const id = String(b?.id || "");
    if (!BLOCK_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    const fonts = normalizeBlockFontFields(b, id);
    // Eski layout.ettnFontSize → ettn bloğu fontSize
    if (id === "ettn" && fonts.fontSize == null && layoutFontHints.ettnFontSize != null) {
      const legacy = asEttnFontSize(layoutFontHints.ettnFontSize, null);
      if (legacy != null) fonts.fontSize = legacy;
    }
    out.push({
      id,
      hidden: !!b.hidden,
      span: asSpan(b.span, BLOCK_SPAN_BY_DEFAULT[id] || 12),
      ...fonts,
    });
  }
  for (const id of BLOCK_IDS) {
    if (seen.has(id)) continue;
    const fonts = {};
    if (id === "ettn" && layoutFontHints.ettnFontSize != null) {
      const legacy = asEttnFontSize(layoutFontHints.ettnFontSize, null);
      if (legacy != null) fonts.fontSize = legacy;
    }
    out.push({
      id,
      hidden: !!BLOCK_HIDDEN_BY_DEFAULT[id],
      span: BLOCK_SPAN_BY_DEFAULT[id] || 12,
      ...fonts,
    });
  }
  return out;
}

function defaultBlocks() {
  return BLOCK_IDS.map((id) => ({
    id,
    hidden: !!BLOCK_HIDDEN_BY_DEFAULT[id],
    span: BLOCK_SPAN_BY_DEFAULT[id] || 12,
  }));
}

export function asDocKind(kind, fallback = "e_invoice") {
  const raw = String(kind || "");
  if (raw === "e_invoice" || raw === "e_archive" || raw === "e_dispatch") return raw;
  if (fallback === "e_archive" || fallback === "e_dispatch") return fallback;
  return "e_invoice";
}

export const CLASSIC_ISNET_NAME = "Klasik (İşNet örneği)";

export function defaultLayout(kind = "e_invoice") {
  return {
    version: 1,
    kind: asDocKind(kind),
    preset: "",
    notesTitle: "",
    ibanTitle: "",
    font: "Tahoma",
    fontSize: 12,
    paper: "#ffffff",
    primary: "#0f172a",
    accent: "#059669",
    text: "#334155",
    muted: "#64748b",
    logo: "",
    companyTitle: "",
    logoSize: 72,
    stampImage: "",
    stampSize: 128,
    stampAlign: "right",
    stampKnockoutWhite: false,
    qrSize: 96,
    ettnFontSize: 18,
    noteText: "",
    ibanText: "",
    ibanName: "",
    blocks: defaultBlocks(),
    lineCols: idList(LINE_COL_IDS, LINE_COL_HIDDEN_BY_DEFAULT),
    metaFields: idList(META_FIELD_IDS, META_FIELD_HIDDEN_BY_DEFAULT),
    headerFields: idList(HEADER_FIELD_IDS, HEADER_FIELD_HIDDEN_BY_DEFAULT),
    totalRows: idList(TOTAL_ROW_IDS, TOTAL_ROW_HIDDEN_BY_DEFAULT),
  };
}

function asColor(value, fallback) {
  const s = String(value || "").trim();
  return HEX.test(s) ? s : fallback;
}

function asLogo(value) {
  const s = String(value || "");
  if (!s || s.length > MAX_LOGO) return "";
  if (s.startsWith("data:image/") || /^https?:\/\//i.test(s)) return s;
  return "";
}

/** GİB harici URL okumaz; data URI gömülür (WebP gönderimde JPEG'e çevrilir). */
export function gibSafeLogoSrc(value) {
  const s = String(value || "").trim().replace(/\s+/g, "");
  if (!s.startsWith("data:image/")) return "";
  if (/^data:image\/(jpeg|jpg|png|gif|webp);base64,[A-Za-z0-9+/=]+/i.test(s)) return s;
  return "";
}

/** Kaşe görseli: yalnız data URI, gövde en fazla ~150 KB. Aşan veya http değer düşer. */
export function asStampImage(value) {
  const safe = gibSafeLogoSrc(value);
  if (!safe) return "";
  if (stampPayloadBytes(safe) > STAMP_MAX_BYTES) return "";
  return safe;
}

export function normalizeLayout(raw, kind) {
  const base = defaultLayout(kind);
  if (!raw || typeof raw !== "object") return base;
  const out = { ...base };
  out.kind = asDocKind(raw.kind, kind);
  out.preset = raw.preset === "classic_isnet" ? "classic_isnet" : "";
  out.notesTitle = String(raw.notesTitle || "").trim().slice(0, 80);
  out.ibanTitle = String(raw.ibanTitle || "").trim().slice(0, 80);
  if (typeof raw.font === "string" && raw.font.trim()) out.font = raw.font.trim().slice(0, 80);
  out.fontSize = asFontSize(raw.fontSize, base.fontSize);
  out.paper = asColor(raw.paper, base.paper);
  out.primary = asColor(raw.primary, base.primary);
  out.accent = asColor(raw.accent, base.accent);
  out.text = asColor(raw.text, base.text);
  out.muted = asColor(raw.muted, base.muted);
  out.logo = asLogo(raw.logo);
  out.logoSize = asLogoSize(raw.logoSize, base.logoSize);
  out.stampImage = asStampImage(raw.stampImage);
  out.stampSize = asStampSize(raw.stampSize, base.stampSize);
  out.stampAlign = asStampAlign(raw.stampAlign, base.stampAlign);
  out.stampKnockoutWhite = !!raw.stampKnockoutWhite;
  out.qrSize = asQrSize(raw.qrSize, base.qrSize);
  out.ettnFontSize = asEttnFontSize(raw.ettnFontSize, base.ettnFontSize);
  if (typeof raw.companyTitle === "string") out.companyTitle = raw.companyTitle.slice(0, 120);
  out.noteText = asNoteText(raw.noteText);
  out.ibanText = asIbanText(raw.ibanText);
  out.ibanName = asIbanName(raw.ibanName);
  out.blocks = normalizeBlocks(raw.blocks, out.kind, { ettnFontSize: raw.ettnFontSize });
  // ETTN punto artık blokta; layout.ettnFontSize senkron tut (eski okuyucular).
  const ettnBlk = out.blocks.find((b) => b.id === "ettn");
  if (ettnBlk?.fontSize != null) out.ettnFontSize = asEttnFontSize(ettnBlk.fontSize, out.ettnFontSize);
  const hasEttnBlock = Array.isArray(raw?.blocks) && raw.blocks.some((b) => b?.id === "ettn");
  if (!hasEttnBlock) {
    const ettnMeta = (Array.isArray(raw?.metaFields) ? raw.metaFields : []).find((f) => f?.id === "ettn");
    if (ettnMeta && !ettnMeta.hidden) {
      out.blocks = setBlockHidden(out.blocks, "ettn", false);
    }
  }
  out.lineCols = normalizeIdList(raw.lineCols, LINE_COL_IDS, LINE_COL_HIDDEN_BY_DEFAULT);
  out.metaFields = deriveMetaFields(raw);
  out.headerFields = normalizeIdList(raw.headerFields, HEADER_FIELD_IDS, HEADER_FIELD_HIDDEN_BY_DEFAULT);
  out.totalRows = normalizeIdList(raw.totalRows, TOTAL_ROW_IDS, TOTAL_ROW_HIDDEN_BY_DEFAULT);
  out.version = 1;
  return out;
}

export function moveBlock(blocks, fromId, toId) {
  const list = (blocks || []).map((b) => ({ ...b }));
  const from = list.findIndex((b) => b.id === fromId);
  const to = list.findIndex((b) => b.id === toId);
  if (from < 0 || to < 0 || from === to) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list;
}

export function setBlockHidden(blocks, id, hidden) {
  return (blocks || []).map((b) => (b.id === id ? { ...b, hidden: !!hidden } : { ...b }));
}

export function setBlockSpan(blocks, id, span) {
  const s = asSpan(span, 12);
  return (blocks || []).map((b) => (b.id === id ? { ...b, span: s } : { ...b }));
}

export function setBlockFontSize(blocks, id, size) {
  const n = asBlockFontSize(size, null);
  return (blocks || []).map((b) => {
    if (b.id !== id) return { ...b };
    if (n == null) {
      const { fontSize: _drop, ...rest } = b;
      return rest;
    }
    return { ...b, fontSize: n };
  });
}

export function setBlockFont(blocks, id, font) {
  const f = String(font || "").trim();
  return (blocks || []).map((b) => {
    if (b.id !== id) return { ...b };
    if (!f) {
      const { font: _drop, ...rest } = b;
      return rest;
    }
    return { ...b, font: asBlockFont(f, f) };
  });
}

/** Blok punto — yoksa layout varsayılanı; ETTN için eski ettnFontSize yedek. */
export function blockFontSize(layout, blockId) {
  const L = layout || {};
  const blk = (L.blocks || []).find((b) => b.id === blockId);
  if (blk?.fontSize != null) return asBlockFontSize(blk.fontSize, asFontSize(L.fontSize));
  if (blockId === "ettn" && L.ettnFontSize != null) return asEttnFontSize(L.ettnFontSize, 18);
  return asFontSize(L.fontSize);
}

export function blockFontFamily(layout, blockId) {
  const L = layout || {};
  const blk = (L.blocks || []).find((b) => b.id === blockId);
  if (blk?.font) return asBlockFont(blk.font, L.font || "Tahoma");
  return asBlockFont(L.font, "Tahoma");
}

export function packBlockRows(blocks) {
  const vis = (blocks || []).filter((b) => !b.hidden);
  const rows = [];
  let row = [];
  let used = 0;
  const spanOf = (b) => asSpan(b.span, BLOCK_SPAN_BY_DEFAULT[b.id] || 12);
  for (let i = 0; i < vis.length; i += 1) {
    const b = vis[i];
    const span = spanOf(b);
    const next = vis[i + 1];
    // IBAN ve güncel bakiye aynı satırda kalsın; önceki yarım blok onları ayırmasın.
    const keepWithBalance = b.id === "iban" && next?.id === "balance" && span + spanOf(next) <= 12;
    if (row.length && (used + span > 12 || (keepWithBalance && used + span + spanOf(next) > 12))) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push({ ...b, span });
    used += span;
    if (used >= 12) {
      rows.push(row);
      row = [];
      used = 0;
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

export function moveVisible(blocks, id, dir) {
  const vis = (blocks || []).filter((b) => !b.hidden).map((b) => b.id);
  const i = vis.indexOf(id);
  const j = i + Number(dir);
  if (i < 0 || j < 0 || j >= vis.length) return blocks || [];
  return moveBlock(blocks, id, vis[j]);
}

export const isLineCol = (id) => LINE_COL_IDS.includes(id);
export const isMetaField = (id) => META_FIELD_IDS.includes(id);
export const isHeaderField = (id) => HEADER_FIELD_IDS.includes(id);
export const isTotalRow = (id) => TOTAL_ROW_IDS.includes(id);
export const visibleLineCols = (layout) => (layout?.lineCols || []).filter((c) => !c.hidden);
export const hiddenLineCols = (layout) => (layout?.lineCols || []).filter((c) => c.hidden);
export const visibleMetaFields = (layout) => (layout?.metaFields || []).filter((c) => !c.hidden);
export const hiddenMetaFields = (layout) => (layout?.metaFields || []).filter((c) => c.hidden);
export const visibleHeaderFields = (layout) => (layout?.headerFields || []).filter((c) => !c.hidden);
export const hiddenHeaderFields = (layout) => (layout?.headerFields || []).filter((c) => c.hidden);
export const visibleTotalRows = (layout) => (layout?.totalRows || []).filter((c) => !c.hidden);
export const hiddenTotalRows = (layout) => (layout?.totalRows || []).filter((c) => c.hidden);

export const SAMPLE_INVOICE = {
  number: "ABC2026000000001",
  orderNo: "SIP-2026-0142",
  date: "06 - 10 - 2026",
  issueTime: "14:32:05",
  ettn: "550e8400-e29b-41d4-a716-446655440000",
  profile: "TICARIFATURA",
  customization: "TR1.2",
  invoiceType: "SATIS",
  despatchNo: "SF-414808",
  despatchDate: "06 - 10 - 2026",
  dueDate: "06 - 10 - 2026",
  currency: "TL",
  supplier: {
    name: "Örnek Yazılım A.Ş.",
    vkn: "1234567890",
    address: "Atatürk Cad. No:1 Kadıköy / İstanbul",
    taxOffice: "Kadıköy",
  },
  customer: {
    name: "Alıcı Ticaret Ltd. Şti.",
    vkn: "9876543210",
    address: "İnönü Bulvarı No:2 Çankaya / Ankara",
    taxOffice: "Çankaya",
  },
  lines: [
    { no: 1, sku: "YZL-001", barcode: "8680000000001", name: "Yazılım lisans bedeli", qty: "1", unit: "C62", net_price: "10.000,00", price: "10.000,00", discount: "%0", vat: "%20", vat_amount: "2.000,00", total: "12.000,00" },
    { no: 2, sku: "KUR-110", barcode: "8680000000002", name: "Kurulum ve eğitim", qty: "2", unit: "C62", net_price: "3.000,00", price: "1.500,00", discount: "%10", vat: "%20", vat_amount: "540,00", total: "3.240,00" },
  ],
  subtotal: "13.000,00",
  discount: "300,00",
  matrah: "13.000,00",
  exemption: "0,00",
  vat: "2.600,00",
  withholding: "1.300,00",
  inclusive: "15.600,00",
  grand: "15.600,00",
  balance: "18.450,00 TL Borç",
  notes: ["İşbu belge elektronik olarak düzenlenmiştir."],
  iban: "TR12 ACCT-000009 0000 01",
};

const NOTE_TEXT_MAX = 500;
const IBAN_TEXT_MAX = 42;
const IBAN_NAME_MAX = 80;

function asNoteText(value) {
  return String(value ?? "").slice(0, NOTE_TEXT_MAX);
}

function asIbanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, IBAN_TEXT_MAX);
}

function asIbanName(value) {
  return String(value ?? "").trim().slice(0, IBAN_NAME_MAX);
}

/** Önizleme notu: tasarıma yazılan dipnot, yoksa örnek metin. */
export function previewNotes(layout, sample = SAMPLE_INVOICE) {
  const t = String(layout?.noteText || "").trim();
  return t ? [t] : (sample.notes || []);
}

/** Önizleme IBAN: tasarıma yazılan şablon, yoksa örnek IBAN. */
export function previewIban(layout, sample = SAMPLE_INVOICE) {
  const iban = String(layout?.ibanText || "").trim();
  const name = String(layout?.ibanName || "").trim();
  return { iban: iban || sample.iban || "", name };
}

/** Önizleme / örnek: meta alanının gösterilecek değeri. */
export function sampleMetaValue(fid, sample = SAMPLE_INVOICE) {
  const s = sample || SAMPLE_INVOICE;
  if (fid === "number") return s.number;
  if (fid === "invoice_date" || fid === "date") return s.date;
  if (fid === "issue_time") return s.issueTime;
  if (fid === "profile") return s.profile;
  if (fid === "order_no") return s.orderNo;
  if (fid === "customization") return s.customization;
  if (fid === "invoice_type") return s.invoiceType;
  if (fid === "despatch_no") return s.despatchNo;
  if (fid === "despatch_date") return s.despatchDate;
  if (fid === "due_date") return s.dueDate;
  return "";
}

/** Değeri dolu meta satırları — boşlar düşer, chip sırası korunur (kayarak yeniden dizilir). */
export function filledMetaFields(layout, sample = SAMPLE_INVOICE) {
  return visibleMetaFields(layout).filter((f) => String(sampleMetaValue(f.id, sample) || "").trim());
}

export function sampleQrPayload(sample = SAMPLE_INVOICE) {
  return `ETTN:${sample.ettn};VKN:${sample.supplier.vkn};NO:${sample.number};TARIH:${sample.date};TUTAR:${sample.grand}`;
}

export function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function xsltRoots(kind) {
  const dispatch = kind === "e_dispatch";
  const doc = dispatch ? "DespatchAdvice" : "Invoice";
  const root = `/n1:${doc}`;
  return {
    dispatch,
    doc,
    root,
    ns: dispatch
      ? "urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"
      : "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    supplierParty: `${root}/cac:${dispatch ? "DespatchSupplierParty" : "AccountingSupplierParty"}/cac:Party`,
    customerParty: `${root}/cac:${dispatch ? "DeliveryCustomerParty" : "AccountingCustomerParty"}/cac:Party`,
    lines: `${root}/cac:${dispatch ? "DespatchLine" : "InvoiceLine"}`,
    qty: dispatch ? "cbc:DeliveredQuantity" : "cbc:InvoicedQuantity",
    lineAmount: dispatch ? "cac:Shipment/cac:GoodsItem/cbc:ValueAmount" : "cbc:LineExtensionAmount",
  };
}

function xsltCurrencySuffix(path, root = "/n1:Invoice") {
  return `<xsl:choose><xsl:when test="${path}/@currencyID='TRY' or ${path}/@currencyID='TRL'"><xsl:text> TL</xsl:text></xsl:when><xsl:when test="${path}/@currencyID!=''"><xsl:text> </xsl:text><xsl:value-of select="${path}/@currencyID"/></xsl:when><xsl:when test="${root}/cbc:DocumentCurrencyCode='TRY' or ${root}/cbc:DocumentCurrencyCode='TRL'"><xsl:text> TL</xsl:text></xsl:when><xsl:when test="${root}/cbc:DocumentCurrencyCode!=''"><xsl:text> </xsl:text><xsl:value-of select="${root}/cbc:DocumentCurrencyCode"/></xsl:when></xsl:choose>`;
}

function xsltMoney(path) {
  return `<xsl:if test="${path}!=''"><xsl:value-of select="format-number(number(${path}), '#.##0,00', 'tr')"/></xsl:if>`;
}

function xsltQty(path) {
  return `<xsl:if test="${path}!=''"><xsl:value-of select="format-number(number(${path}), '#.##0,##', 'tr')"/></xsl:if>`;
}

/** Başlık ve logo: e-Arşiv yalnızca ProfileID=EARSIVFATURA iken. */
function xsltDocTitleInner(R) {
  if (R.dispatch) return `<xsl:text>e-İrsaliye</xsl:text>`;
  return `<xsl:choose><xsl:when test="${R.root}/cbc:ProfileID='EARSIVFATURA'"><xsl:text>e-Arşiv Fatura</xsl:text></xsl:when><xsl:otherwise><xsl:text>e-Fatura</xsl:text></xsl:otherwise></xsl:choose>`;
}

function xsltDocTitle(R) {
  return `<div class="inv-doc-title">${xsltDocTitleInner(R)}</div>`;
}

function xsltMoneyWithCurrency(path, root = "/n1:Invoice") {
  return `<xsl:if test="${path}!=''"><xsl:value-of select="format-number(number(${path}), '#.##0,00', 'tr')"/>${xsltCurrencySuffix(path, root)}</xsl:if>`;
}

function xsltYmdDash(path) {
  return `<xsl:value-of select="concat(substring(${path},9,2),' - ',substring(${path},6,2),' - ',substring(${path},1,4))"/>`;
}

function xsltUnitLabel(attrPath = "cbc:InvoicedQuantity/@unitCode") {
  const when = Object.entries(UNIT_CODE_LABELS)
    .map(([code, label]) => `<xsl:when test="${attrPath}='${xmlEscape(code)}'"><xsl:text>${xmlEscape(label)}</xsl:text></xsl:when>`)
    .join("");
  // "Adet(Unit)" gibi parantezli kodlarda yalnız Türkçe ad kalır; ham kod yanına eklenmez.
  const paren = `<xsl:when test="contains(${attrPath},'Adet')"><xsl:text>Adet</xsl:text></xsl:when><xsl:when test="contains(${attrPath},'(')"><xsl:value-of select="substring-before(${attrPath},'(')"/></xsl:when>`;
  return `<xsl:choose>${when}${paren}<xsl:otherwise><xsl:value-of select="${attrPath}"/></xsl:otherwise></xsl:choose>`;
}

function blockTitle(value, fallback) {
  const t = String(value || "").trim();
  return xmlEscape(t || fallback);
}

function xsltNotesBlock(L, R) {
  const extra = String(L.noteText || "").trim();
  const staticNote = extra ? `<div>${xmlEscape(extra)}</div>` : "";
  return `
      <div class="inv-notes">
        <div class="inv-k">${blockTitle(L.notesTitle, "Notlar")}</div>
        ${staticNote}
        <xsl:for-each select="${R.root}/cbc:Note">
          <div><xsl:value-of select="."/></div>
        </xsl:for-each>
      </div>`;
}

function payeeAccountId(R) {
  return `${R.root}/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID`;
}

function balanceRefId(R) {
  return `${R.root}/cac:AdditionalDocumentReference[cbc:DocumentType='BAKIYE' or cbc:DocumentType='CARI_BAKIYE' or cbc:DocumentTypeCode='BAKIYE']/cbc:ID`;
}

/** Boş IBAN / bakiye hücresi basılmaz. Sabit IBAN metni her zaman görünür. */
function blockPresenceTest(id, L, R) {
  if (id === "balance") return `normalize-space(${balanceRefId(R)})!=''`;
  if (id === "iban" && !String(L.ibanText || "").trim()) return `normalize-space(${payeeAccountId(R)})!=''`;
  return "";
}

function xsltIbanBlock(L, R) {
  const iban = String(L.ibanText || "").trim();
  const name = String(L.ibanName || "").trim();
  const title = blockTitle(L.ibanTitle, "IBAN / ödeme");
  const payeeName = `${R.root}/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:Name`;
  const body = iban
    ? `<div>${xmlEscape(iban)}</div>${name ? `<div>${xmlEscape(name)}</div>` : ""}`
    : `<div><xsl:value-of select="${payeeAccountId(R)}"/></div><div><xsl:value-of select="${payeeName}"/></div>`;
  return `
      <div class="inv-iban">
        <div class="inv-k">${title}</div>
        ${body}
      </div>`;
}

function lineColXslt(R) {
  const q = R.qty;
  const unit = () => xsltUnitLabel(`${q}/@unitCode`);
  return {
    no: { align: "left", td: `<td><xsl:value-of select="cbc:ID"/></td>` },
    sku: { align: "left", td: `<td><xsl:value-of select="cac:Item/cac:SellersItemIdentification/cbc:ID"/></td>` },
    name: { align: "left", td: `<td><xsl:value-of select="cac:Item/cbc:Name"/></td>` },
    desc: { align: "left", td: "" },
    barcode: {
      align: "left",
      td: `<td><xsl:value-of select="cac:Item/cac:StandardItemIdentification/cbc:ID"/><xsl:if test="not(cac:Item/cac:StandardItemIdentification/cbc:ID)"><xsl:value-of select="cac:Item/cac:AdditionalItemIdentification/cbc:ID"/></xsl:if></td>`,
    },
    qty: { align: "right", td: `<td align="right">${xsltQty(q)}</td>` },
    unit: { align: "left", nowrap: true, td: `<td class="inv-nowrap" style="white-space:nowrap">${unit()}</td>` },
    net_price: {
      align: "right",
      td: `<td align="right"><xsl:choose><xsl:when test="cac:Price/cbc:PriceAmount">${xsltMoney("cac:Price/cbc:PriceAmount")}</xsl:when><xsl:when test="${q}!=0"><xsl:value-of select="format-number(${R.lineAmount} div ${q}, '#.##0,00', 'tr')"/></xsl:when><xsl:otherwise>${xsltMoney(R.lineAmount)}</xsl:otherwise></xsl:choose></td>`,
    },
    price: { align: "right", td: `<td align="right">${xsltMoney("cac:Price/cbc:PriceAmount")}</td>` },
    discount: {
      align: "right",
      td: `<td align="right"><xsl:choose><xsl:when test="cac:AllowanceCharge/cbc:MultiplierFactorNumeric">%<xsl:value-of select="format-number(cac:AllowanceCharge/cbc:MultiplierFactorNumeric * 100, '#.##0,##', 'tr')"/></xsl:when><xsl:otherwise>${xsltMoney("cac:AllowanceCharge[cbc:ChargeIndicator='false']/cbc:Amount")}</xsl:otherwise></xsl:choose></td>`,
    },
    vat: { align: "right", td: `<td align="right">%<xsl:value-of select="cac:TaxTotal/cac:TaxSubtotal/cbc:Percent"/></td>` },
    vat_amount: {
      align: "right",
      nowrap: true,
      td: `<td class="inv-nowrap" align="right" style="white-space:nowrap">${xsltMoney("cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode='0015']/cbc:TaxAmount")}</td>`,
    },
    total: { align: "right", td: `<td align="right">${xsltMoney(R.lineAmount)}</td>` },
  };
}

function xsltLineTable(L, R) {
  const cols = visibleLineCols(L);
  if (!cols.length) return "";
  const cells = lineColXslt(R);
  const unitOn = cols.some((c) => c.id === "unit");
  const descTest = `${R.lines}/cbc:Note[normalize-space(.)!=''] or ${R.lines}/cac:Item/cbc:Description[normalize-space(.)!='']`;
  const th = cols.map((c) => {
    const spec = cells[c.id] || {};
    const label = xmlEscape(LINE_COL_LABELS[c.id] || c.id);
    const style = spec.nowrap ? ` style="white-space:nowrap"` : "";
    const cell = `<th align="${spec.align || "left"}"${style}>${label}</th>`;
    if (c.id === "desc") return `<xsl:if test="${descTest}">${cell}</xsl:if>`;
    return cell;
  }).join("");
  const td = cols.map((c) => {
    if (c.id === "desc") {
      return `<xsl:if test="${descTest}"><td><xsl:value-of select="cbc:Note"/><xsl:if test="not(normalize-space(cbc:Note))"><xsl:value-of select="cac:Item/cbc:Description"/></xsl:if></td></xsl:if>`;
    }
    if (c.id === "qty" && !unitOn) {
      return `<td align="right" style="white-space:nowrap">${xsltQty(R.qty)}<xsl:if test="${R.qty}/@unitCode!=''"><xsl:text> </xsl:text>${xsltUnitLabel(`${R.qty}/@unitCode`)}</xsl:if></td>`;
    }
    return cells[c.id]?.td || `<td/>`;
  }).join("");
  return `
      <table class="inv-lines" width="100%" cellpadding="6" cellspacing="0">
        <thead><tr>${th}</tr></thead>
        <tbody>
          <xsl:for-each select="${R.lines}">
            <tr>${td}</tr>
          </xsl:for-each>
        </tbody>
      </table>`;
}

function xsltMetaRow(label, inner, testExpr) {
  const row = `<tr><td class="inv-meta-k">${xmlEscape(label)}:</td><td class="inv-meta-v">${inner}</td></tr>`;
  if (!testExpr) return row;
  return `<xsl:if test="${testExpr}">${row}</xsl:if>`;
}

/** Fatura bilgisi satırı: veri yoksa satır basılmaz; kalanlar sırayı koruyarak kayar. */
function xsltMetaTable(L, R) {
  const fields = visibleMetaFields(L);
  if (!fields.length) return "";
  const root = R.root;
  const dueTest = `(${root}/cbc:DueDate[normalize-space(.)!=''] or ${root}/cac:PaymentMeans/cbc:PaymentDueDate[normalize-space(.)!=''])`;
  const dueInner = `<xsl:choose><xsl:when test="${root}/cbc:DueDate[normalize-space(.)!='']">${xsltYmdDash(`${root}/cbc:DueDate`)}</xsl:when><xsl:otherwise>${xsltYmdDash(`${root}/cac:PaymentMeans/cbc:PaymentDueDate`)}</xsl:otherwise></xsl:choose>`;
  const numberLabel = R.dispatch ? "İrsaliye No" : META_FIELD_LABELS.number;
  const map = {
    customization: xsltMetaRow(META_FIELD_LABELS.customization, `<xsl:value-of select="${root}/cbc:CustomizationID"/>`, `${root}/cbc:CustomizationID[normalize-space(.)!='']`),
    profile: xsltMetaRow(META_FIELD_LABELS.profile, `<xsl:value-of select="${root}/cbc:ProfileID"/>`, `${root}/cbc:ProfileID[normalize-space(.)!='']`),
    invoice_type: xsltMetaRow(META_FIELD_LABELS.invoice_type, `<xsl:value-of select="${root}/cbc:InvoiceTypeCode"/>`, `${root}/cbc:InvoiceTypeCode[normalize-space(.)!='']`),
    number: xsltMetaRow(numberLabel, `<xsl:value-of select="${root}/cbc:ID"/>`, `${root}/cbc:ID[normalize-space(.)!='']`),
    invoice_date: xsltMetaRow(META_FIELD_LABELS.invoice_date, xsltYmdDash(`${root}/cbc:IssueDate`), `${root}/cbc:IssueDate[normalize-space(.)!='']`),
    date: xsltMetaRow(META_FIELD_LABELS.date, xsltYmdDash(`${root}/cbc:IssueDate`), `${root}/cbc:IssueDate[normalize-space(.)!='']`),
    issue_time: xsltMetaRow(META_FIELD_LABELS.issue_time, `<xsl:value-of select="${root}/cbc:IssueTime"/>`, `${root}/cbc:IssueTime[normalize-space(.)!='']`),
    despatch_no: xsltMetaRow(META_FIELD_LABELS.despatch_no, `<xsl:value-of select="${root}/cac:DespatchDocumentReference/cbc:ID"/>`, `${root}/cac:DespatchDocumentReference/cbc:ID[normalize-space(.)!='']`),
    despatch_date: xsltMetaRow(META_FIELD_LABELS.despatch_date, xsltYmdDash(`${root}/cac:DespatchDocumentReference/cbc:IssueDate`), `${root}/cac:DespatchDocumentReference/cbc:IssueDate[normalize-space(.)!='']`),
    due_date: xsltMetaRow(META_FIELD_LABELS.due_date, dueInner, dueTest),
    order_no: xsltMetaRow(META_FIELD_LABELS.order_no, `<xsl:value-of select="${root}/cac:OrderReference/cbc:ID"/>`, `${root}/cac:OrderReference/cbc:ID[normalize-space(.)!='']`),
  };
  return `
      <table class="inv-meta" width="100%" cellpadding="0" cellspacing="0">
        ${fields.map((f) => map[f.id] || "").join("")}
      </table>`;
}

function xsltTotalsTable(L, R) {
  const rows = visibleTotalRows(L);
  if (!rows.length) return "";
  const root = R.root;
  const money = (path) => xsltMoneyWithCurrency(path, root);
  const map = {
    subtotal: `<tr><td class="inv-tot">${xmlEscape(TOTAL_ROW_LABELS.subtotal)}</td><td align="right">${money(`${root}/cac:LegalMonetaryTotal/cbc:LineExtensionAmount`)}</td></tr>`,
    allowance: `<tr><td class="inv-tot">${xmlEscape(TOTAL_ROW_LABELS.allowance)}</td><td align="right">${money(`${root}/cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount`)}</td></tr>`,
    matrah: `<tr><td class="inv-tot">${xmlEscape(TOTAL_ROW_LABELS.matrah)}</td><td align="right"><xsl:choose><xsl:when test="${root}/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode='0015']/cbc:TaxableAmount">${money(`${root}/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode='0015']/cbc:TaxableAmount`)}</xsl:when><xsl:otherwise>${money(`${root}/cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount`)}</xsl:otherwise></xsl:choose></td></tr>`,
    exemption: `<tr><td class="inv-tot">${xmlEscape(TOTAL_ROW_LABELS.exemption)}</td><td align="right">${money(`${root}/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cbc:TaxExemptionReason or cac:TaxCategory/cbc:TaxExemptionReasonCode]/cbc:TaxableAmount`)}</td></tr>`,
    kdv: `<xsl:for-each select="${root}/cac:TaxTotal/cac:TaxSubtotal"><tr><td class="inv-tot" style="white-space:nowrap">Hesaplanan (%<xsl:value-of select="cbc:Percent"/>)</td><td align="right" style="white-space:nowrap">${xsltMoneyWithCurrency("cbc:TaxAmount", root)}</td></tr></xsl:for-each>`,
    tevkifat: `<tr><td class="inv-tot">${xmlEscape(TOTAL_ROW_LABELS.tevkifat)}</td><td align="right">${money(`${root}/cac:WithholdingTaxTotal/cbc:TaxAmount`)}</td></tr>`,
    inclusive: `<tr><td class="inv-tot">${xmlEscape(TOTAL_ROW_LABELS.inclusive)}</td><td align="right">${money(`${root}/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount`)}</td></tr>`,
    grand: `<tr class="inv-grand"><td>${xmlEscape(TOTAL_ROW_LABELS.grand)}</td><td align="right">${money(`${root}/cac:LegalMonetaryTotal/cbc:PayableAmount`)}</td></tr>`,
  };
  return `
      <table class="inv-totals" cellpadding="4" cellspacing="0" align="right">
        ${rows.map((r) => map[r.id] || "").join("")}
      </table>`;
}
function xsltPartyBox(role, R) {
  const path = role === "customer" ? R.customerParty : R.supplierParty;
  const label = role === "customer" ? "ALICI" : "SATICI";
  return `
      <div class="inv-box" style="padding:8px;">
        <div class="inv-k">${label}</div>
        <div class="inv-v"><xsl:value-of select="${path}/cac:PartyName/cbc:Name"/></div>
        <div><xsl:call-template name="partyAddress"><xsl:with-param name="party" select="${path}"/></xsl:call-template></div>
        <div>VKN/TCKN: <xsl:value-of select="${path}/cac:PartyIdentification/cbc:ID"/></div>
        <div>VD: <xsl:value-of select="${path}/cac:PartyTaxScheme/cac:TaxScheme/cbc:Name"/></div>
      </div>`;
}

function xsltGibSeal(kind) {
  return `
      <div class="inv-gib-seal" align="center">
        <img style="width:91px;" align="middle" alt="${xmlEscape(gibSealAlt(kind))}" src="${GIB_SEAL_JPEG_DATA_URL}"/>
        <h1 align="center"><span style="font-weight:bold;">${xmlEscape(gibSealCaption(kind))}</span></h1>
      </div>`;
}

function xsltLogoAlt(R) {
  return `<xsl:attribute name="alt">${xsltDocTitleInner(R)}</xsl:attribute>`;
}

function xsltLogoCluster(L, R) {
  const logoH = asLogoSize(L.logoSize);
  const logoSrc = gibSafeLogoSrc(L.logo);
  const embedded = logoSrc
    ? `<xsl:otherwise><img height="${logoH}" src="${xmlEscape(logoSrc)}" style="height:${logoH}px;width:auto;border:0;">${xsltLogoAlt(R)}</img></xsl:otherwise>`
    : "";
  return `<xsl:choose><xsl:when test="$IsLogoExists='true'"><img style="height:${logoH}px;width:auto;border:0;" src="data:image/jpeg;base64,firmaLogoImageString">${xsltLogoAlt(R)}</img></xsl:when>${embedded}</xsl:choose><xsl:if test="$IsEimzaLogoExists='true'"><img style="width:91px;" align="bottom" alt="E-Imza Logo" src="data:image/jpeg;base64,firmaImzaImageString"/></xsl:if>${xsltDocTitle(R)}`;
}

function xsltStamp(L) {
  const size = asStampSize(L.stampSize);
  const align = asStampAlign(L.stampAlign);
  const src = asStampImage(L.stampImage);
  const img = src
    ? `<img alt="Kaşe / İmza" src="${xmlEscape(src)}" style="width:${size}px;height:auto;border:0;"/>`
    : "&#160;";
  return `<div class="inv-stamp" align="${align}" style="text-align:${align}">${img}</div>`;
}

function xsltQrImg(L, R) {
  const size = asQrSize(L.qrSize);
  const style = `height:${size}px;width:${size}px;`;
  const bin = `${R.root}/cac:AdditionalDocumentReference[cbc:DocumentType='QRCODE' or cbc:DocumentType='KAREKOD' or cbc:DocumentType='QR' or cbc:DocumentTypeCode='QRCODE' or cbc:DocumentTypeCode='KAREKOD']/cac:Attachment/cbc:EmbeddedDocumentBinaryObject`;
  // XSLT 1.0 QR bitmap üretemez. XML'de gömülü görsel varsa onu bas; yoksa İşNet'in
  // render anında değiştirdiği yer tutucu kalır. UBL üretimi aynı alanlarla PNG ekler.
  return `<xsl:choose><xsl:when test="normalize-space(${bin})!=''"><img style="${style}" alt="QrCode"><xsl:attribute name="src"><xsl:text>data:</xsl:text><xsl:choose><xsl:when test="${bin}/@mimeCode!=''"><xsl:value-of select="${bin}/@mimeCode"/></xsl:when><xsl:otherwise><xsl:text>image/png</xsl:text></xsl:otherwise></xsl:choose><xsl:text>;base64,</xsl:text><xsl:value-of select="${bin}"/></xsl:attribute></img></xsl:when><xsl:otherwise><img style="${style}" alt="QrCode" src="data:image/jpeg;base64,qrCodeImageString"/></xsl:otherwise></xsl:choose>`;
}

function xsltBlocks(L, R) {
  const classic = L.preset === "classic_isnet";
  const headerVis = visibleHeaderFields(L);
  const headerBits = headerVis.map((f) => {
    if (f.id === "supplier_name") {
      return `<h1 class="inv-brand-name"><xsl:value-of select="${R.supplierParty}/cac:PartyName/cbc:Name"/></h1>`;
    }
    if (f.id === "supplier_address") {
      return `<div class="inv-brand-addr"><xsl:call-template name="partyAddress"><xsl:with-param name="party" select="${R.supplierParty}"/></xsl:call-template></div>`;
    }
    if (f.id === "supplier_vkn") {
      return `<div class="inv-brand-vkn">VKN/TCKN: <xsl:value-of select="${R.supplierParty}/cac:PartyIdentification/cbc:ID"/></div>`;
    }
    return "";
  }).join("");
  const supplier = xsltPartyBox("supplier", R);
  const customer = xsltPartyBox("customer", R);
  const logo = xsltLogoCluster(L, R);
  const qr = xsltQrImg(L, R);

  return {
    header: classic ? `
      <table class="inv-header" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td class="inv-brand" valign="top">${headerBits}</td>
          <td class="inv-brand-right" align="right" valign="top">${logo}&#160;${qr}</td>
        </tr>
      </table>` : `
      <table class="inv-header" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td class="inv-brand" valign="top">${logo}${headerBits}</td>
        </tr>
      </table>`,
    gib_seal_invoice: xsltGibSeal("e_invoice"),
    gib_seal_archive: xsltGibSeal("e_archive"),
    supplier,
    customer,
    parties: `
      <table class="inv-parties" width="100%" cellpadding="8" cellspacing="0">
        <tr>
          <td width="50%" valign="top">${supplier}</td>
          <td width="50%" valign="top">${customer}</td>
        </tr>
      </table>`,
    meta: xsltMetaTable(L, R),
    ettn: `
      <div class="inv-ettn">
        <span class="inv-ettn-k">ETTN</span>
        <span class="inv-ettn-v"><xsl:value-of select="${R.root}/cbc:UUID"/></span>
      </div>`,
    lines: xsltLineTable(L, R),
    totals: xsltTotalsTable(L, R),
    notes: xsltNotesBlock(L, R),
    iban: xsltIbanBlock(L, R),
    balance: `
      <div class="inv-balance">
        <div class="inv-k">Güncel bakiye</div>
        <div><xsl:value-of select="${balanceRefId(R)}"/></div>
      </div>`,
    stamp: xsltStamp(L),
    qr: `
      <div class="inv-qr" align="right">${qr}</div>`,
    spacer: `<div class="inv-spacer">&#160;</div>`,
  };
}

/** Layout JSON'u XSLT başına göm (geri yüklemede görsel düzen korunur). */
export function embedLayoutComment(xslt, layout) {
  const text = String(xslt || "");
  const stripped = text.replace(/<!--\s*TAMKOBI_LAYOUT[^>]*-->/g, "").trimStart();
  let b64 = "";
  try {
    const json = JSON.stringify(layout || {});
    b64 = typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, "utf8").toString("base64");
  } catch {
    return stripped;
  }
  const comment = `<!-- TAMKOBI_LAYOUT v1:${b64} -->`;
  // XML bildiriminin önüne yorum konursa belge iyi biçimli olmaz; İşNet/lxml parse edemez.
  const decl = stripped.match(/^<\?xml[^?]*\?>\s*/);
  if (decl) {
    const head = decl[0];
    return `${head}${comment}\n${stripped.slice(head.length)}`;
  }
  return `${comment}\n${stripped}`;
}

export function extractLayoutComment(xslt) {
  const m = String(xslt || "").match(/<!--\s*TAMKOBI_LAYOUT\s+v1:([A-Za-z0-9+/=]+)\s*-->/);
  if (!m) return null;
  try {
    const json = typeof atob === "function"
      ? decodeURIComponent(escape(atob(m[1])))
      : Buffer.from(m[1], "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Blok yazı tipi/punto CSS — her metin alanı kendi fontunu taşır. */
function xsltBlockFontRules(L) {
  return Array.from(BLOCKS_WITH_FONT).map((id) => {
    const size = blockFontSize(L, id);
    const family = xmlEscape(blockFontFamily(L, id));
    const k = Math.max(7, size - 2);
    const no = size + 3;
    const base = `.inv-blk-${id} { font-family:"${family}", Tahoma, Arial, Helvetica, sans-serif; font-size:${size}px; }`;
    if (id === "ettn") {
      return `${base}\n          .inv-blk-ettn .inv-ettn-v { font-size:${size}px; }`;
    }
    if (id === "meta") {
      return `${base}\n          .inv-blk-meta .inv-meta td { font-size:${size}px; }`;
    }
    if (id === "lines") {
      return `${base}\n          .inv-blk-lines .inv-lines th { font-size:${k}px; }\n          .inv-blk-lines .inv-lines td { font-size:${size}px; }`;
    }
    if (id === "totals") {
      return `${base}\n          .inv-blk-totals .inv-grand td { font-size:${size + 1}px; }`;
    }
    if (id === "header") {
      return `${base}\n          .inv-blk-header .inv-brand-name { font-size:${no}px; }\n          .inv-blk-header .inv-brand-addr, .inv-blk-header .inv-brand-vkn { font-size:${k}px; }`;
    }
    if (id === "notes" || id === "iban" || id === "balance") {
      return `${base}\n          .inv-blk-${id}.inv-notes, .inv-blk-${id}.inv-iban, .inv-blk-${id}.inv-balance, .inv-blk-${id} { font-size:${size}px; }`;
    }
    return base;
  }).join("\n          ");
}

function xsltPackedBody(L, R) {
  const map = xsltBlocks(L, R);
  return packBlockRows(L.blocks).map((row) => {
    const parts = row.map((b) => {
      const pct = Math.round((asSpan(b.span, BLOCK_SPAN_BY_DEFAULT[b.id] || 12) / 12) * 100);
      const inner = map[b.id] || "";
      const wrapped = blockHasFont(b.id)
        ? `<div class="inv-blk-${b.id}">${inner}</div>`
        : inner;
      const foot = b.id === "iban" || b.id === "balance" ? " inv-foot" : "";
      const td = `<td width="${pct}%" valign="top" class="inv-cell${foot}">${wrapped}</td>`;
      const test = blockPresenceTest(b.id, L, R);
      return { td: test ? `<xsl:if test="${test}">${td}</xsl:if>` : td, test };
    });
    const table = `<table class="inv-row" width="100%" cellpadding="4" cellspacing="0"><tr>${parts.map((p) => p.td).join("")}</tr></table>`;
    const tests = parts.map((p) => p.test);
    if (tests.length && tests.every(Boolean)) {
      return `<xsl:if test="${tests.join(" or ")}">${table}</xsl:if>`;
    }
    return table;
  }).join("\n");
}

function xsltPartyAddressTemplate() {
  return `
  <xsl:template name="partyAddress">
    <xsl:param name="party"/>
    <xsl:variable name="street" select="normalize-space($party/cac:PostalAddress/cbc:StreetName)"/>
    <xsl:variable name="bname" select="normalize-space($party/cac:PostalAddress/cbc:BuildingName)"/>
    <xsl:variable name="bldg" select="normalize-space($party/cac:PostalAddress/cbc:BuildingNumber)"/>
    <xsl:variable name="dist" select="normalize-space($party/cac:PostalAddress/cbc:CitySubdivisionName)"/>
    <xsl:variable name="city" select="normalize-space($party/cac:PostalAddress/cbc:CityName)"/>
    <xsl:value-of select="$street"/>
    <xsl:if test="$bname!='' and not(contains($street,$bname))"><xsl:text> </xsl:text><xsl:value-of select="$bname"/></xsl:if>
    <xsl:if test="$bldg!='' and not(contains($street,$bldg)) and not(contains($bname,$bldg))"><xsl:text> No:</xsl:text><xsl:value-of select="$bldg"/></xsl:if>
    <xsl:if test="$dist!='' and not(contains($street,$dist))"><xsl:text> </xsl:text><xsl:value-of select="$dist"/></xsl:if>
    <xsl:if test="$city!='' and not(contains($street,$city)) and not(contains($dist,$city))"><xsl:text> / </xsl:text><xsl:value-of select="$city"/></xsl:if>
  </xsl:template>`;
}

export function classicIsnetLayout(kind = "e_invoice") {
  const L = defaultLayout(asDocKind(kind));
  L.preset = "classic_isnet";
  L.notesTitle = "AÇIKLAMALAR";
  L.ibanTitle = "BANKA HESAP BİLGİLERİMİZ";
  L.qrSize = 160;
  const show = new Set(["header", "supplier", "customer", "meta", "ettn", "lines", "totals", "notes", "iban"]);
  L.blocks = L.blocks.map((b) => ({
    ...b,
    hidden: !show.has(b.id),
    span: (b.id === "notes" || b.id === "iban" || b.id === "supplier" || b.id === "customer") ? 6 : (BLOCK_SPAN_BY_DEFAULT[b.id] || 12),
  }));
  const showCols = new Set(["no", "sku", "name", "desc", "qty", "unit", "price", "vat_amount", "total"]);
  L.lineCols = L.lineCols.map((c) => ({ ...c, hidden: !showCols.has(c.id) }));
  return L;
}

export function layoutToXslt(layout, kind) {
  const L = normalizeLayout(layout, kind);
  const R = xsltRoots(L.kind);
  const body = xsltPackedBody(L, R);
  const font = xmlEscape(L.font);
  const fs = asFontSize(L.fontSize);
  const k = Math.max(7, fs - 2);
  const no = fs + 3;
  const raw = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:n1="${R.ns}"
  exclude-result-prefixes="cac cbc n1">
  <xsl:output method="html" indent="yes" encoding="UTF-8"/>
  <xsl:decimal-format name="tr" decimal-separator="," grouping-separator="."/>
  <xsl:variable name="IsLogoExists" select="'IsLogoExistsValue'"/>
  <xsl:variable name="IsEimzaLogoExists" select="'IsEimzaLogoExistsValue'"/>
  ${xsltPartyAddressTemplate()}
  <xsl:template match="/">
    <html>
      <head>
        <meta charset="UTF-8"/>
        <title>${xsltDocTitleInner(R)}</title>
        <style type="text/css">
          body, table, td, th, div, span, h1 { font-family:"${font}", Tahoma, Arial, Helvetica, sans-serif; }
          body { background:${L.paper}; color:${L.text}; font-size:${fs}px; margin:0; padding:16px; }
          table { font-size:${fs}px; }
          h1 { font-size:${no}px; color:${L.primary}; margin:8px 0 0; }
          .inv-wrap { max-width:900px; margin:0 auto; }
          .inv-row { margin:0 0 8px; }
          .inv-cell { padding:2px 4px; font-size:${fs}px; }
          .inv-header { border-bottom:3px solid ${L.accent}; padding-bottom:10px; }
          .inv-brand-name { font-size:${no}px; margin:6px 0 2px; color:${L.primary}; }
          .inv-brand-addr, .inv-brand-vkn { font-size:${k}px; }
          .inv-k { font-size:${k}px; font-weight:700; color:${L.muted}; text-transform:uppercase; letter-spacing:.04em; }
          .inv-tot { color:${L.muted}; }
          .inv-v { font-weight:700; color:${L.primary}; margin:2px 0 4px; }
          .inv-box { border:1px solid ${L.accent}33; background:${L.paper}; }
          .inv-meta { border-collapse:collapse; }
          .inv-meta td { font-weight:inherit; font-size:${fs}px; color:${L.text}; padding:1px 8px 1px 0; vertical-align:top; }
          .inv-meta-k { white-space:nowrap; }
          .inv-meta-v { word-break:break-word; }
          .inv-ettn { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; word-break:break-all; }
          .inv-ettn-k { font-weight:700; color:${L.muted}; white-space:nowrap; letter-spacing:.04em; }
          .inv-ettn-v { color:${L.primary}; margin:0; }
          .inv-lines { border-collapse:collapse; }
          .inv-lines th { background:${L.primary}; color:#fff; font-size:${k}px; }
          .inv-lines td { border-bottom:1px solid ${L.muted}22; font-size:${fs}px; }
          .inv-nowrap, .inv-lines th.inv-nowrap, .inv-lines td.inv-nowrap { white-space:nowrap; }
          .inv-brand-right { text-align:right; white-space:nowrap; }
          .inv-totals { min-width:260px; margin-top:8px; }
          .inv-grand td { font-weight:700; color:${L.primary}; font-size:${fs + 1}px; border-top:2px solid ${L.accent}; }
          .inv-notes, td.inv-foot { border-top:1px dashed ${L.muted}55; padding-top:8px; color:${L.muted}; font-size:${fs}px; background:transparent; vertical-align:top; }
          .inv-iban, .inv-balance { background:transparent; border:0; padding:0; color:inherit; font-size:inherit; height:100%; }
          .inv-qr { text-align:right; }
          .inv-stamp { margin:4px 0; }
          .inv-stamp img { border:0; height:auto; }
          .inv-doc-title { font-weight:700; color:${L.primary}; font-size:${no}px; margin:0 0 4px; }
          .inv-spacer { min-height:28px; }
          .inv-gib-seal { text-align:center; }
          .inv-gib-seal h1 { font-size:18px; margin:4px 0 0; color:${L.primary}; }
          ${xsltBlockFontRules(L)}
        </style>
      </head>
      <body style="font-family:'${font}', Tahoma, Arial, Helvetica, sans-serif; font-size:${fs}px; color:${L.text}; background:${L.paper};">
        <div class="inv-wrap">
          ${body || `<div>e-Fatura</div>`}
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
`;
  // HTML entity (&nbsp; vb.) XSLT parse'ı bozar — yalnız &#160; kullan.
  if (/&nbsp;|&amp;nbsp;/i.test(raw)) {
    throw new Error("XSLT içinde HTML entity (&nbsp;) olamaz; &#160; kullanın.");
  }
  if (!/<xsl:stylesheet\b[^>]*\bversion="1\.0"/.test(raw)) {
    throw new Error("XSLT stylesheet version 1.0 olmalı.");
  }
  return embedLayoutComment(raw, L);
}

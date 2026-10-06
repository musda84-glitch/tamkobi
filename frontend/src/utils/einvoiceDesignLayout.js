/** e-Fatura / e-Arşiv görsel tasarım düzeni → canlı önizleme + XSLT. */

import { GIB_SEAL_JPEG_DATA_URL, gibSealAlt, gibSealCaption } from "./einvoiceGibSeal";

export { GIB_SEAL_JPEG_DATA_URL, gibSealAlt, gibSealCaption };

export const BLOCK_IDS = [
  "header", "supplier", "customer", "meta", "lines", "totals",
  "notes", "iban", "balance", "qr", "gib_seal",
];

export const BLOCK_LABELS = {
  header: "Üst bilgi / logo",
  gib_seal: "GİB mührü",
  supplier: "Satıcı",
  customer: "Alıcı",
  meta: "Fatura bilgileri",
  lines: "Kalemler",
  totals: "Toplamlar",
  notes: "Notlar",
  iban: "IBAN / ödeme",
  balance: "Güncel bakiye",
  qr: "GİB karekod",
};

export const SPAN_OPTIONS = [
  { span: 12, label: "Tam" },
  { span: 6, label: "1/2" },
  { span: 4, label: "1/3" },
];

export const SPAN_CLASS = { 12: "col-span-12", 6: "col-span-6", 4: "col-span-4" };

const BLOCK_HIDDEN_BY_DEFAULT = { gib_seal: true, balance: true, qr: true };
const BLOCK_SPAN_BY_DEFAULT = {
  gib_seal: 4,
  supplier: 6,
  customer: 6,
  iban: 6,
  balance: 6,
  qr: 6,
};

export function asSpan(value, fallback = 12) {
  const n = Number(value);
  return n === 4 || n === 6 || n === 12 ? n : fallback;
}

export const LINE_COL_IDS = ["no", "sku", "name", "barcode", "qty", "unit", "net_price", "price", "discount", "vat", "total"];

export const LINE_COL_LABELS = {
  no: "Sıra",
  sku: "Stok kodu",
  name: "Mal / Hizmet",
  barcode: "Barkod",
  qty: "Miktar",
  unit: "Birim",
  net_price: "KDV'siz fiyat",
  price: "Birim fiyat",
  discount: "İskonto",
  vat: "KDV",
  total: "Tutar",
};

const LINE_COL_HIDDEN_BY_DEFAULT = {
  sku: true,
  barcode: true,
  unit: true,
  net_price: true,
  discount: true,
  vat: true,
};

export const META_FIELD_IDS = ["number", "date", "profile", "ettn", "order_no"];

export const META_FIELD_LABELS = {
  number: "Fatura numarası",
  date: "Tarih",
  profile: "Senaryo",
  ettn: "ETTN",
  order_no: "Sipariş numarası",
};

const META_FIELD_HIDDEN_BY_DEFAULT = { order_no: true };

export const TOTAL_ROW_IDS = ["subtotal", "allowance", "exemption", "kdv", "tevkifat", "grand"];

export const TOTAL_ROW_LABELS = {
  subtotal: "Mal hizmet toplam",
  allowance: "İskonto",
  exemption: "İstisna",
  kdv: "KDV",
  tevkifat: "Tevkifat",
  grand: "Ödenecek tutar",
};

const TOTAL_ROW_HIDDEN_BY_DEFAULT = { allowance: true, exemption: true, tevkifat: true };

export const TOTAL_ROW_SAMPLE_KEY = {
  subtotal: "subtotal",
  allowance: "discount",
  exemption: "exemption",
  kdv: "vat",
  tevkifat: "withholding",
  grand: "grand",
};

export const FONT_OPTIONS = [
  { id: "Tahoma", label: "Tahoma" },
  { id: "Arial", label: "Arial" },
  { id: "Calibri", label: "Calibri" },
  { id: "DejaVu Sans", label: "DejaVu Sans" },
  { id: "Times New Roman", label: "Times New Roman" },
];

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

function expandLegacyBlocks(raw) {
  const out = [];
  for (const b of Array.isArray(raw) ? raw : []) {
    if (b?.id === "parties") {
      out.push({ id: "supplier", hidden: !!b.hidden, span: 6 });
      out.push({ id: "customer", hidden: !!b.hidden, span: 6 });
    } else if (b?.id === "invoice_no" || b?.id === "order_no") {
      continue;
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

function normalizeBlocks(raw) {
  const seen = new Set();
  const out = [];
  for (const b of expandLegacyBlocks(raw)) {
    const id = String(b?.id || "");
    if (!BLOCK_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      hidden: !!b.hidden,
      span: asSpan(b.span, BLOCK_SPAN_BY_DEFAULT[id] || 12),
    });
  }
  for (const id of BLOCK_IDS) {
    if (seen.has(id)) continue;
    out.push({
      id,
      hidden: !!BLOCK_HIDDEN_BY_DEFAULT[id],
      span: BLOCK_SPAN_BY_DEFAULT[id] || 12,
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

export function defaultLayout(kind = "e_invoice") {
  return {
    version: 1,
    kind: kind === "e_archive" ? "e_archive" : "e_invoice",
    font: "Tahoma",
    paper: "#ffffff",
    primary: "#0f172a",
    accent: "#059669",
    text: "#334155",
    muted: "#64748b",
    logo: "",
    companyTitle: "",
    blocks: defaultBlocks(),
    lineCols: idList(LINE_COL_IDS, LINE_COL_HIDDEN_BY_DEFAULT),
    metaFields: idList(META_FIELD_IDS, META_FIELD_HIDDEN_BY_DEFAULT),
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

export function normalizeLayout(raw, kind) {
  const base = defaultLayout(kind);
  if (!raw || typeof raw !== "object") return base;
  const out = { ...base };
  out.kind = raw.kind === "e_archive" || raw.kind === "e_invoice"
    ? raw.kind
    : (kind === "e_archive" ? "e_archive" : "e_invoice");
  if (typeof raw.font === "string" && raw.font.trim()) out.font = raw.font.trim().slice(0, 80);
  out.paper = asColor(raw.paper, base.paper);
  out.primary = asColor(raw.primary, base.primary);
  out.accent = asColor(raw.accent, base.accent);
  out.text = asColor(raw.text, base.text);
  out.muted = asColor(raw.muted, base.muted);
  out.logo = asLogo(raw.logo);
  if (typeof raw.companyTitle === "string") out.companyTitle = raw.companyTitle.slice(0, 120);
  out.blocks = normalizeBlocks(raw.blocks);
  out.lineCols = normalizeIdList(raw.lineCols, LINE_COL_IDS, LINE_COL_HIDDEN_BY_DEFAULT);
  out.metaFields = deriveMetaFields(raw);
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

export function packBlockRows(blocks) {
  const vis = (blocks || []).filter((b) => !b.hidden);
  const rows = [];
  let row = [];
  let used = 0;
  for (const b of vis) {
    const span = asSpan(b.span, BLOCK_SPAN_BY_DEFAULT[b.id] || 12);
    if (row.length && used + span > 12) {
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
export const isTotalRow = (id) => TOTAL_ROW_IDS.includes(id);
export const visibleLineCols = (layout) => (layout?.lineCols || []).filter((c) => !c.hidden);
export const hiddenLineCols = (layout) => (layout?.lineCols || []).filter((c) => c.hidden);
export const visibleMetaFields = (layout) => (layout?.metaFields || []).filter((c) => !c.hidden);
export const hiddenMetaFields = (layout) => (layout?.metaFields || []).filter((c) => c.hidden);
export const visibleTotalRows = (layout) => (layout?.totalRows || []).filter((c) => !c.hidden);
export const hiddenTotalRows = (layout) => (layout?.totalRows || []).filter((c) => c.hidden);

export const SAMPLE_INVOICE = {
  number: "ABC2026000000001",
  orderNo: "SIP-2026-0142",
  date: "06.10.2026",
  ettn: "550e8400-e29b-41d4-a716-446655440000",
  profile: "TICARIFATURA",
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
    { no: 1, sku: "YZL-001", barcode: "8680000000001", name: "Yazılım lisans bedeli", qty: "1", unit: "C62", net_price: "10.000,00", price: "10.000,00", discount: "%0", vat: "%20", total: "12.000,00" },
    { no: 2, sku: "KUR-110", barcode: "8680000000002", name: "Kurulum ve eğitim", qty: "2", unit: "C62", net_price: "3.000,00", price: "1.500,00", discount: "%10", vat: "%20", total: "3.240,00" },
  ],
  subtotal: "13.000,00",
  discount: "300,00",
  exemption: "0,00",
  vat: "2.600,00",
  withholding: "1.300,00",
  grand: "15.600,00",
  balance: "18.450,00 TL Borç",
  notes: ["İşbu belge elektronik olarak düzenlenmiştir."],
  iban: "TR12 ACCT-000009 0000 01",
};

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

function kindTitle(kind) {
  return kind === "e_archive" ? "e-Arşiv Fatura" : "e-Fatura";
}

const LINE_COL_XSLT = {
  no: { align: "left", td: `<td><xsl:value-of select="cbc:ID"/></td>` },
  sku: { align: "left", td: `<td><xsl:value-of select="cac:Item/cac:SellersItemIdentification/cbc:ID"/></td>` },
  name: { align: "left", td: `<td><xsl:value-of select="cac:Item/cbc:Name"/></td>` },
  barcode: {
    align: "left",
    td: `<td><xsl:value-of select="cac:Item/cac:StandardItemIdentification/cbc:ID"/><xsl:if test="not(cac:Item/cac:StandardItemIdentification/cbc:ID)"><xsl:value-of select="cac:Item/cac:AdditionalItemIdentification/cbc:ID"/></xsl:if></td>`,
  },
  qty: { align: "right", td: `<td align="right"><xsl:value-of select="cbc:InvoicedQuantity"/></td>` },
  unit: { align: "left", td: `<td><xsl:value-of select="cbc:InvoicedQuantity/@unitCode"/></td>` },
  net_price: { align: "right", td: `<td align="right"><xsl:value-of select="cbc:LineExtensionAmount"/></td>` },
  price: { align: "right", td: `<td align="right"><xsl:value-of select="cac:Price/cbc:PriceAmount"/></td>` },
  discount: {
    align: "right",
    td: `<td align="right"><xsl:choose><xsl:when test="cac:AllowanceCharge/cbc:MultiplierFactorNumeric">%<xsl:value-of select="cac:AllowanceCharge/cbc:MultiplierFactorNumeric * 100"/></xsl:when><xsl:otherwise><xsl:value-of select="cac:AllowanceCharge[cbc:ChargeIndicator='false']/cbc:Amount"/></xsl:otherwise></xsl:choose></td>`,
  },
  vat: { align: "right", td: `<td align="right">%<xsl:value-of select="cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:Percent"/></td>` },
  total: { align: "right", td: `<td align="right"><xsl:value-of select="cbc:LineExtensionAmount"/></td>` },
};

function xsltLineTable(L) {
  const cols = visibleLineCols(L);
  if (!cols.length) return "";
  const th = cols.map((c) => `<th align="${LINE_COL_XSLT[c.id]?.align || "left"}">${xmlEscape(LINE_COL_LABELS[c.id] || c.id)}</th>`).join("");
  const td = cols.map((c) => LINE_COL_XSLT[c.id]?.td || `<td/>`).join("");
  return `
      <table class="inv-lines" width="100%" cellpadding="6" cellspacing="0">
        <thead><tr>${th}</tr></thead>
        <tbody>
          <xsl:for-each select="/n1:Invoice/cac:InvoiceLine">
            <tr>${td}</tr>
          </xsl:for-each>
        </tbody>
      </table>`;
}

function xsltMetaTable(L) {
  const title = kindTitle(L.kind);
  const fields = visibleMetaFields(L);
  if (!fields.length) return "";
  const map = {
    number: `<td><div class="inv-badge">${xmlEscape(title)}</div><span class="inv-k">${xmlEscape(META_FIELD_LABELS.number)}</span><div class="inv-no"><xsl:value-of select="/n1:Invoice/cbc:ID"/></div></td>`,
    date: `<td><span class="inv-k">${xmlEscape(META_FIELD_LABELS.date)}</span><div><xsl:value-of select="/n1:Invoice/cbc:IssueDate"/></div></td>`,
    profile: `<td><span class="inv-k">${xmlEscape(META_FIELD_LABELS.profile)}</span><div><xsl:value-of select="/n1:Invoice/cbc:ProfileID"/></div></td>`,
    ettn: `<td><span class="inv-k">${xmlEscape(META_FIELD_LABELS.ettn)}</span><div class="inv-ettn"><xsl:value-of select="/n1:Invoice/cbc:UUID"/></div></td>`,
    order_no: `<td><span class="inv-k">${xmlEscape(META_FIELD_LABELS.order_no)}</span><div class="inv-v"><xsl:value-of select="/n1:Invoice/cac:OrderReference/cbc:ID"/></div></td>`,
  };
  const cells = fields.map((f) => map[f.id] || "").join("");
  return `
      <table class="inv-meta" width="100%" cellpadding="6" cellspacing="0">
        <tr>${cells}</tr>
      </table>`;
}

function xsltTotalsTable(L) {
  const rows = visibleTotalRows(L);
  if (!rows.length) return "";
  const map = {
    subtotal: `<tr><td class="inv-k">${xmlEscape(TOTAL_ROW_LABELS.subtotal)}</td><td align="right"><xsl:value-of select="/n1:Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount"/></td></tr>`,
    allowance: `<tr><td class="inv-k">${xmlEscape(TOTAL_ROW_LABELS.allowance)}</td><td align="right"><xsl:value-of select="/n1:Invoice/cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount"/></td></tr>`,
    exemption: `<tr><td class="inv-k">${xmlEscape(TOTAL_ROW_LABELS.exemption)}</td><td align="right"><xsl:value-of select="/n1:Invoice/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/cbc:TaxExemptionReason or cac:TaxCategory/cbc:TaxExemptionReasonCode]/cbc:TaxableAmount"/></td></tr>`,
    kdv: `<tr><td class="inv-k">${xmlEscape(TOTAL_ROW_LABELS.kdv)}</td><td align="right"><xsl:value-of select="/n1:Invoice/cac:TaxTotal/cbc:TaxAmount"/></td></tr>`,
    tevkifat: `<tr><td class="inv-k">${xmlEscape(TOTAL_ROW_LABELS.tevkifat)}</td><td align="right"><xsl:value-of select="/n1:Invoice/cac:WithholdingTaxTotal/cbc:TaxAmount"/></td></tr>`,
    grand: `<tr class="inv-grand"><td>${xmlEscape(TOTAL_ROW_LABELS.grand)}</td><td align="right"><xsl:value-of select="/n1:Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount"/></td></tr>`,
  };
  return `
      <table class="inv-totals" cellpadding="4" cellspacing="0" align="right">
        ${rows.map((r) => map[r.id] || "").join("")}
      </table>`;
}
function xsltPartyBox(role) {
  const path = role === "customer"
    ? "/n1:Invoice/cac:AccountingCustomerParty/cac:Party"
    : "/n1:Invoice/cac:AccountingSupplierParty/cac:Party";
  const label = role === "customer" ? "ALICI" : "SATICI";
  return `
      <div class="inv-box" style="padding:8px;">
        <div class="inv-k">${label}</div>
        <div class="inv-v"><xsl:value-of select="${path}/cac:PartyName/cbc:Name"/></div>
        <div><xsl:value-of select="${path}/cac:PostalAddress/cbc:StreetName"/>
          <xsl:text> </xsl:text>
          <xsl:value-of select="${path}/cac:PostalAddress/cbc:BuildingNumber"/>
          <xsl:text> </xsl:text>
          <xsl:value-of select="${path}/cac:PostalAddress/cbc:CityName"/>
        </div>
        <div>VKN/TCKN: <xsl:value-of select="${path}/cac:PartyIdentification/cbc:ID"/></div>
        <div>VD: <xsl:value-of select="${path}/cac:PartyTaxScheme/cac:TaxScheme/cbc:Name"/></div>
      </div>`;
}

function xsltBlocks(L) {
  const logo = L.logo
    ? `<img src="${xmlEscape(L.logo)}" alt="logo" style="max-height:72px;max-width:220px;object-fit:contain;"/>`
    : "";
  const company = L.companyTitle
    ? xmlEscape(L.companyTitle)
    : `<xsl:value-of select="/n1:Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name"/>`;
  const supplier = xsltPartyBox("supplier");
  const customer = xsltPartyBox("customer");

  return {
    header: `
      <table class="inv-header" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td class="inv-brand" valign="top">${logo}<h1>${company}</h1></td>
        </tr>
      </table>`,
    gib_seal: `
      <div class="inv-gib-seal" align="center">
        <img style="width:91px;" align="middle" alt="${xmlEscape(gibSealAlt(L.kind))}" src="${GIB_SEAL_JPEG_DATA_URL}"/>
        <h1 align="center"><span style="font-weight:bold;">${xmlEscape(gibSealCaption(L.kind))}</span></h1>
      </div>`,
    supplier,
    customer,
    parties: `
      <table class="inv-parties" width="100%" cellpadding="8" cellspacing="0">
        <tr>
          <td width="50%" valign="top">${supplier}</td>
          <td width="50%" valign="top">${customer}</td>
        </tr>
      </table>`,
    meta: xsltMetaTable(L),
    lines: xsltLineTable(L),
    totals: xsltTotalsTable(L),
    notes: `
      <div class="inv-notes">
        <div class="inv-k">Notlar</div>
        <xsl:for-each select="/n1:Invoice/cbc:Note">
          <div><xsl:value-of select="."/></div>
        </xsl:for-each>
      </div>`,
    iban: `
      <div class="inv-iban">
        <div class="inv-k">IBAN / ödeme</div>
        <div><xsl:value-of select="/n1:Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID"/></div>
        <div><xsl:value-of select="/n1:Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:Name"/></div>
      </div>`,
    balance: `
      <div class="inv-balance">
        <div>
          <div class="inv-k">Güncel bakiye</div>
          <div class="inv-v">
            <xsl:value-of select="/n1:Invoice/cac:AdditionalDocumentReference[cbc:DocumentType='BAKIYE' or cbc:DocumentType='CARI_BAKIYE' or cbc:DocumentTypeCode='BAKIYE']/cbc:ID"/>
          </div>
        </div>
      </div>`,
    qr: `
      <div class="inv-qr">
        <xsl:for-each select="/n1:Invoice/cac:AdditionalDocumentReference[cbc:DocumentType='QR' or cbc:DocumentTypeCode='QR' or cbc:DocumentType='KAREKOD']">
          <xsl:if test="cac:Attachment/cbc:EmbeddedDocumentBinaryObject">
            <img alt="QR" style="width:96px;height:96px">
              <xsl:attribute name="src">
                <xsl:text>data:</xsl:text>
                <xsl:value-of select="cac:Attachment/cbc:EmbeddedDocumentBinaryObject/@mimeCode"/>
                <xsl:text>;base64,</xsl:text>
                <xsl:value-of select="cac:Attachment/cbc:EmbeddedDocumentBinaryObject"/>
              </xsl:attribute>
            </img>
          </xsl:if>
        </xsl:for-each>
      </div>`,
  };
}

function xsltPackedBody(L) {
  const map = xsltBlocks(L);
  return packBlockRows(L.blocks).map((row) => {
    const cells = row.map((b) => {
      const pct = Math.round((asSpan(b.span, BLOCK_SPAN_BY_DEFAULT[b.id] || 12) / 12) * 100);
      return `<td width="${pct}%" valign="top" class="inv-cell">${map[b.id] || ""}</td>`;
    }).join("");
    return `<table class="inv-row" width="100%" cellpadding="4" cellspacing="0"><tr>${cells}</tr></table>`;
  }).join("\n");
}

export function layoutToXslt(layout, kind) {
  const L = normalizeLayout(layout, kind);
  const body = xsltPackedBody(L);
  const font = xmlEscape(L.font);
  return `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:n1="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  exclude-result-prefixes="cac cbc n1">
  <xsl:output method="html" indent="yes" encoding="UTF-8"/>
  <xsl:template match="/">
    <html>
      <head>
        <meta charset="UTF-8"/>
        <title><xsl:value-of select="/n1:Invoice/cbc:ID"/></title>
        <style type="text/css">
          body { background:${L.paper}; color:${L.text}; font-family:"${font}", Tahoma, sans-serif; font-size:12px; margin:0; padding:16px; }
          h1 { font-size:18px; color:${L.primary}; margin:8px 0 0; }
          .inv-wrap { max-width:900px; margin:0 auto; }
          .inv-row { margin:0 0 8px; }
          .inv-cell { padding:2px 4px; }
          .inv-header { border-bottom:3px solid ${L.accent}; padding-bottom:10px; }
          .inv-badge { display:inline-block; background:${L.accent}; color:#fff; font-weight:700; padding:4px 10px; border-radius:4px; letter-spacing:.04em; }
          .inv-no { font-size:16px; font-weight:700; color:${L.primary}; margin-top:4px; }
          .inv-k { font-size:10px; font-weight:700; color:${L.muted}; text-transform:uppercase; letter-spacing:.04em; }
          .inv-v { font-weight:700; color:${L.primary}; margin:2px 0 4px; }
          .inv-box { border:1px solid ${L.accent}33; background:${L.paper}; }
          .inv-meta td { border-bottom:1px solid ${L.muted}33; }
          .inv-ettn { font-size:10px; word-break:break-all; }
          .inv-lines { border-collapse:collapse; }
          .inv-lines th { background:${L.primary}; color:#fff; font-size:10px; }
          .inv-lines td { border-bottom:1px solid ${L.muted}22; }
          .inv-totals { min-width:260px; margin-top:8px; }
          .inv-grand td { font-weight:700; color:${L.primary}; font-size:14px; border-top:2px solid ${L.accent}; }
          .inv-notes, .inv-iban { border-top:1px dashed ${L.muted}55; padding-top:8px; color:${L.muted}; }
          .inv-balance { border:1px solid ${L.accent}; padding:8px 10px; }
          .inv-qr { text-align:right; }
          .inv-gib-seal { text-align:center; }
          .inv-gib-seal h1 { font-size:18px; margin:4px 0 0; color:${L.primary}; }
        </style>
      </head>
      <body>
        <div class="inv-wrap">
          ${body || `<div>e-Fatura</div>`}
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
`;
}

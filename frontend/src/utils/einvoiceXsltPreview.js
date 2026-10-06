/** Yüklenen GİB XSLT → renk/logo ipuçları ve örnek veri önizlemesi. */

import { SAMPLE_INVOICE, defaultLayout, normalizeLayout, xmlEscape } from "./einvoiceDesignLayout";

const NAMED = {
  brown: "#a52a2a",
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  navy: "#000080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  teal: "#008080",
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const SAMPLE_UBL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<n1:Invoice xmlns:n1="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>ABC2026000000001</cbc:ID>
  <cbc:UUID>550e8400-e29b-41d4-a716-446655440000</cbc:UUID>
  <cbc:IssueDate>2026-10-06</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:Note>İşbu belge elektronik olarak düzenlenmiştir.</cbc:Note>
  <cac:OrderReference><cbc:ID>SIP-2026-0142</cbc:ID></cac:OrderReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Örnek Yazılım A.Ş.</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>Atatürk Cad.</cbc:StreetName><cbc:BuildingNumber>1</cbc:BuildingNumber><cbc:CityName>İstanbul</cbc:CityName></cac:PostalAddress>
    <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Kadıköy</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">9876543210</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Alıcı Ticaret Ltd. Şti.</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>İnönü Bulvarı</cbc:StreetName><cbc:BuildingNumber>2</cbc:BuildingNumber><cbc:CityName>Ankara</cbc:CityName></cac:PostalAddress>
    <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Çankaya</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cac:PayeeFinancialAccount><cbc:ID>TR12 ACCT-000009 0000 01</cbc:ID><cbc:Name>Örnek Banka</cbc:Name></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:TaxTotal><cbc:TaxAmount currencyID="TRY">2600.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="TRY">13000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="TRY">2600.00</cbc:TaxAmount>
      <cbc:Percent>20</cbc:Percent>
      <cac:TaxCategory><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">13000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">13000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">15600.00</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="TRY">300.00</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="TRY">15600.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">10000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cac:TaxSubtotal><cbc:Percent>20</cbc:Percent><cac:TaxCategory><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Name>Yazılım lisans bedeli</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>YZL-001</cbc:ID></cac:SellersItemIdentification>
      <cac:StandardItemIdentification><cbc:ID>8680000000001</cbc:ID></cac:StandardItemIdentification>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">10000.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID><cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">3000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cac:TaxSubtotal><cbc:Percent>20</cbc:Percent><cac:TaxCategory><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Name>Kurulum ve eğitim</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>KUR-110</cbc:ID></cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">1500.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</n1:Invoice>`;

function toHex(raw) {
  const s = String(raw || "").trim().replace(/['"]/g, "").split(/\s/)[0];
  if (!s) return "";
  const low = s.toLowerCase();
  if (NAMED[low]) return NAMED[low];
  if (HEX.test(s)) return s;
  return "";
}

export function extractXsltCss(xslt) {
  const m = String(xslt || "").match(/<style\b[^>]*>([\s\S]*?)<\/style>/i);
  return m ? m[1] : "";
}

export function extractXsltLogo(xslt) {
  const re = /(?:src|href)\s*=\s*["'](data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)["']/gi;
  let best = "";
  let m;
  const text = String(xslt || "");
  while ((m = re.exec(text))) {
    const url = m[1].replace(/\s+/g, "");
    if (url.length > best.length) best = url;
  }
  if (best.length < 40) return "";
  return best;
}

export function parseXsltHints(xslt) {
  const css = extractXsltCss(xslt);
  const body = css.match(/body\s*\{([^}]+)\}/i)?.[1] || css;
  const h2 = css.match(/h2\s*\{([^}]+)\}/i)?.[1] || "";
  const h4 = css.match(/h4\s*\{([^}]+)\}/i)?.[1] || "";
  const h1 = css.match(/h1\s*\{([^}]+)\}/i)?.[1] || "";
  const fontM = body.match(/font-family\s*:\s*['"]?([^'",;]+)/i);
  const font = fontM ? fontM[1].trim() : "";
  const paper = toHex((body.match(/background(?:-color)?\s*:\s*([^;]+)/i) || [])[1]);
  const text = toHex((body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i) || [])[1]);
  const accent = toHex((h2.match(/color\s*:\s*([^;]+)/i) || [])[1]);
  const primary = toHex((h4.match(/color\s*:\s*([^;]+)/i) || h1.match(/color\s*:\s*([^;]+)/i) || [])[1]);
  const logo = extractXsltLogo(xslt);
  return { css, font, paper, text, accent, primary, logo };
}

export function layoutFromXslt(xslt, kind) {
  const hints = parseXsltHints(xslt);
  const patch = {};
  if (hints.font) patch.font = hints.font.slice(0, 80);
  if (hints.paper) patch.paper = hints.paper;
  if (hints.text) patch.text = hints.text;
  if (hints.accent) patch.accent = hints.accent;
  if (hints.primary) patch.primary = hints.primary;
  if (hints.logo && hints.logo.length <= 420_000) patch.logo = hints.logo;
  return normalizeLayout({ ...defaultLayout(kind), ...patch }, kind);
}

export function prepareXsltForBrowser(xslt) {
  return String(xslt || "")
    .replace(/\sversion\s*=\s*["']2\.0["']/, ' version="1.0"')
    .replace(/<xsl:character-map\b[\s\S]*?<\/xsl:character-map>/gi, "")
    .replace(/\s+use-character-maps\s*=\s*["'][^"']*["']/gi, "");
}

export function transformXsltToHtml(xslt, xml = SAMPLE_UBL_XML) {
  if (typeof window === "undefined" || typeof window.XSLTProcessor !== "function" || typeof window.DOMParser !== "function") {
    return "";
  }
  try {
    const parser = new window.DOMParser();
    const sheet = parser.parseFromString(prepareXsltForBrowser(xslt), "text/xml");
    if (sheet.getElementsByTagName("parsererror").length) return "";
    const doc = parser.parseFromString(xml, "text/xml");
    if (doc.getElementsByTagName("parsererror").length) return "";
    const proc = new window.XSLTProcessor();
    proc.importStylesheet(sheet);
    const out = proc.transformToDocument(doc);
    if (!out || !out.documentElement) return "";
    const html = out.documentElement.outerHTML || new window.XMLSerializer().serializeToString(out);
    if (!html || html.length < 40) return "";
    if (html.includes("parsererror")) return "";
    return html;
  } catch {
    return "";
  }
}

export function xsltFallbackPreviewHtml(xslt, kind) {
  const hints = parseXsltHints(xslt);
  const s = SAMPLE_INVOICE;
  const title = kind === "e_archive" ? "e-Arşiv Fatura" : "e-Fatura";
  const css = hints.css || `body{font-family:Tahoma,sans-serif;color:${hints.text || "#666"};background:${hints.paper || "#fff"};font-size:11px}`;
  const logo = hints.logo ? `<img src="${xmlEscape(hints.logo)}" alt="logo" style="max-height:72px;max-width:220px"/>` : "";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${css}
    #xsltPreviewWrap{padding:8px}
  </style></head><body>
  <div id="xsltPreviewWrap" data-xslt-preview="1">
    <table width="100%" id="customerPartyTable"><tr>
      <td valign="top">${logo}<h1>${xmlEscape(s.supplier.name)}</h1>
        <div>${xmlEscape(s.supplier.address)}</div>
        <div>VKN/TCKN: ${xmlEscape(s.supplier.vkn)}</div>
      </td>
      <td valign="top" align="right">
        <h2>${xmlEscape(title)}</h2>
        <div><b>${xmlEscape(s.number)}</b></div>
        <div>${xmlEscape(s.date)}</div>
        <div id="ettnTable">${xmlEscape(s.ettn)}</div>
      </td>
    </tr></table>
    <table width="100%" id="lineTable" border="1" cellpadding="4" cellspacing="0">
      <tr id="lineTableTr">
        <td>Sıra No</td><td>Mal Hizmet</td><td>Miktar</td><td>Birim Fiyat</td><td>Mal Hizmet Tutarı</td>
      </tr>
      ${s.lines.map((ln) => `<tr><td>${ln.no}</td><td>${xmlEscape(ln.name)}</td><td>${xmlEscape(ln.qty)}</td><td>${xmlEscape(ln.price)}</td><td>${xmlEscape(ln.total)}</td></tr>`).join("")}
    </table>
    <table align="right" cellpadding="4">
      <tr><td>Mal Hizmet Toplam Tutarı</td><td>${xmlEscape(s.subtotal)}</td></tr>
      <tr><td>Toplam İskonto</td><td>${xmlEscape(s.discount)}</td></tr>
      <tr><td>KDV Matrahı</td><td>${xmlEscape(s.matrah)}</td></tr>
      <tr><td>Hesaplanan (%20)</td><td>${xmlEscape(s.vat)}</td></tr>
      <tr><td>Vergiler Dahil Toplam Tutar</td><td>${xmlEscape(s.inclusive)}</td></tr>
      <tr><td><b>Ödenecek Tutar</b></td><td><b>${xmlEscape(s.grand)}</b></td></tr>
    </table>
  </div></body></html>`;
}

export function buildXsltPreview(xslt, kind) {
  const raw = String(xslt || "");
  const hints = parseXsltHints(raw);
  if (raw.length < 400 || (!/<style/i.test(raw) && !/data:image\//i.test(raw) && raw.length < 4000)) {
    return { html: "", hints, transformed: false };
  }
  const transformed = transformXsltToHtml(raw);
  if (transformed) return { html: transformed, hints, transformed: true };
  return { html: xsltFallbackPreviewHtml(raw, kind), hints, transformed: false };
}

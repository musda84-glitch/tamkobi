import {
  buildXsltPreview,
  extractXsltLogo,
  layoutFromXslt,
  parseXsltHints,
  preparePreviewXml,
  prepareXsltForBrowser,
  readPreviewXmlFile,
  SAMPLE_DESPATCH_XML,
  SAMPLE_UBL_XML,
  sampleXmlForKind,
  stripEmbeddedDocuments,
  ublRootLocalName,
  xsltFallbackPreviewHtml,
} from "./einvoiceXsltPreview";

const SAMPLE = `
<xsl:stylesheet version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:character-map name="a"><xsl:output-character character="a" string=""/></xsl:character-map>
  <xsl:output method="html" use-character-maps="a"/>
  <xsl:template match="/">
    <html><head><style type="text/css">
      body { background-color: #F4F1EA; font-family: 'Calibri', Arial; color: #444444; }
      h2 { color: brown; }
      h4 { color: #112233; }
    </style></head>
    <body>
      <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" />
      <h1>Acme</h1>
    </body></html>
  </xsl:template>
</xsl:stylesheet>`;

test("parseXsltHints reads css colors, font and logo", () => {
  const h = parseXsltHints(SAMPLE);
  expect(h.paper).toBe("#F4F1EA");
  expect(h.text).toBe("#444444");
  expect(h.accent).toBe("#a52a2a");
  expect(h.primary).toBe("#112233");
  expect(h.font).toBe("Calibri");
  expect(h.logo).toContain("data:image/png;base64,");
  expect(h.css).toContain("background-color: #F4F1EA");
});

test("layoutFromXslt applies hints onto default layout", () => {
  const L = layoutFromXslt(SAMPLE, "e_archive");
  expect(L.kind).toBe("e_archive");
  expect(L.paper).toBe("#F4F1EA");
  expect(L.font).toBe("Calibri");
  expect(L.accent).toBe("#a52a2a");
  expect(L.logo).toContain("data:image/png");
});

test("prepareXsltForBrowser drops 2.0-only bits", () => {
  const out = prepareXsltForBrowser(SAMPLE);
  expect(out).toContain('version="1.0"');
  expect(out).not.toContain("character-map");
  expect(out).not.toContain("use-character-maps");
});

test("buildXsltPreview shows uploaded stylesheet, not the generic editor", () => {
  const prev = buildXsltPreview(SAMPLE, "e_invoice");
  expect(prev.html.length).toBeGreaterThan(80);
  expect(prev.html).toMatch(/Acme|#F4F1EA|ABC2026000000001|data-xslt-preview/);
});

test("tiny stylesheet has no xslt paper preview", () => {
  const prev = buildXsltPreview("<xsl:stylesheet/>", "e_invoice");
  expect(prev.html).toBe("");
});

test("extractXsltLogo ignores the stamp image", () => {
  const stamp = `data:image/png;base64,${"A".repeat(80)}`;
  const logo = `data:image/png;base64,${"B".repeat(40)}`;
  const xslt = `<div class="inv-stamp" align="right"><img alt="Kaşe / İmza" src="${stamp}"/></div><img src="${logo}"/>`;
  expect(extractXsltLogo(xslt)).toBe(logo);
});

test("sampleXmlForKind uses DespatchAdvice XML for e-İrsaliye", () => {
  expect(sampleXmlForKind("e_dispatch")).toBe(SAMPLE_DESPATCH_XML);
  expect(sampleXmlForKind("e_invoice")).toBe(SAMPLE_UBL_XML);
  expect(sampleXmlForKind("e_archive")).toBe(SAMPLE_UBL_XML);
  expect(ublRootLocalName(sampleXmlForKind("e_invoice"))).toBe("Invoice");
  expect(ublRootLocalName(sampleXmlForKind("e_archive"))).toBe("Invoice");
  expect(ublRootLocalName(sampleXmlForKind("e_dispatch"))).toBe("DespatchAdvice");
  expect(SAMPLE_DESPATCH_XML).toContain("urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2");
  expect(SAMPLE_DESPATCH_XML).toContain("DespatchSupplierParty");
  expect(SAMPLE_DESPATCH_XML).toContain("DeliveryCustomerParty");
  expect(SAMPLE_DESPATCH_XML.match(/<cac:DespatchLine>/g)).toHaveLength(2);
  expect(SAMPLE_DESPATCH_XML).toContain("Örnek Yazılım A.Ş.");
  expect(SAMPLE_DESPATCH_XML).toContain("Alıcı Ticaret Ltd. Şti.");
  expect(SAMPLE_DESPATCH_XML).toContain("1234567890");
  expect(SAMPLE_DESPATCH_XML).toContain("9876543210");
  expect(SAMPLE_DESPATCH_XML).toContain("ABC2026000000001");
});

test("stripEmbeddedDocuments drops embedded XSLT and images, keeps other references", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>KEEP123</cbc:ID>
  <cac:AdditionalDocumentReference>
    <cbc:ID>xslt-ref</cbc:ID>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="application/xml">SECRETBASE64PAYLOAD</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>BAKIYE-1</cbc:ID>
    <cbc:DocumentType>BAKIYE</cbc:DocumentType>
  </cac:AdditionalDocumentReference>
</Invoice>`;
  const out = stripEmbeddedDocuments(xml);
  expect(out).toContain("KEEP123");
  expect(out).toContain("BAKIYE-1");
  expect(out).not.toContain("SECRETBASE64PAYLOAD");
  expect(out).not.toContain("EmbeddedDocumentBinaryObject");
  expect(out).not.toContain("xslt-ref");
});

test("preparePreviewXml rejects DespatchAdvice for an invoice design", () => {
  const xml = `<?xml version="1.0"?><n1:DespatchAdvice xmlns:n1="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"><cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">IRS1</cbc:ID></n1:DespatchAdvice>`;
  expect(() => preparePreviewXml(xml, "e_invoice")).toThrow(/uyuşmuyor/);
  expect(() => preparePreviewXml(xml, "e_archive")).toThrow(/Invoice/);
  expect(preparePreviewXml(xml, "e_dispatch")).toContain("IRS1");
});

test("preparePreviewXml rejects unreadable XML", () => {
  expect(() => preparePreviewXml("bu bir xml degil", "e_invoice")).toThrow(/XML okunamadı/);
  expect(() => preparePreviewXml("", "e_dispatch")).toThrow(/XML okunamadı/);
});

test("readPreviewXmlFile rejects files over 2 MB and zip without jszip", async () => {
  const big = { name: "buyuk.xml", size: 2 * 1024 * 1024 + 1, text: async () => "<Invoice/>" };
  await expect(readPreviewXmlFile(big)).rejects.toThrow(/2 MB/);
  const zip = { name: "belge.zip", size: 120, type: "application/zip", text: async () => "PK" };
  await expect(readPreviewXmlFile(zip)).rejects.toThrow(/\.xml/);
});

test("xsltFallbackPreviewHtml uses extracted style", () => {
  const html = xsltFallbackPreviewHtml(SAMPLE, "e_archive");
  expect(html).toContain("e-Arşiv Fatura");
  expect(html).toContain("lineTable");
  expect(html).toContain("Yazılım lisans bedeli");
  expect(html).toContain("Mal Hizmet Toplam Tutarı");
  expect(html).toContain("Toplam İskonto");
  expect(html).toContain("KDV Matrahı");
  expect(html).toContain("Hesaplanan (%20)");
  expect(html).toContain("Vergiler Dahil Toplam Tutar");
  expect(html).toContain("Ödenecek Tutar");
});

import {
  buildXsltPreview,
  layoutFromXslt,
  parseXsltHints,
  prepareXsltForBrowser,
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

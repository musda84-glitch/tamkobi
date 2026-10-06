import {
  BLOCK_IDS,
  defaultLayout,
  layoutToXslt,
  moveBlock,
  moveVisible,
  normalizeLayout,
  setBlockHidden,
  xmlEscape,
} from "./einvoiceDesignLayout";

test("default layout shows core blocks and hides extra fields", () => {
  const L = defaultLayout("e_invoice");
  expect(L.blocks.map((b) => b.id)).toEqual(BLOCK_IDS);
  expect(L.blocks.find((b) => b.id === "header").hidden).toBe(false);
  expect(L.blocks.find((b) => b.id === "qr").hidden).toBe(true);
  expect(L.blocks.find((b) => b.id === "balance").hidden).toBe(true);
  expect(L.lineCols.find((c) => c.id === "sku").hidden).toBe(true);
  expect(L.lineCols.find((c) => c.id === "name").hidden).toBe(false);
  expect(L.kind).toBe("e_invoice");
});

test("normalizeLayout fills missing blocks and sanitizes colors", () => {
  const L = normalizeLayout({
    kind: "e_archive",
    primary: "red",
    accent: "#abc",
    blocks: [{ id: "totals", hidden: true }, { id: "bogus" }, { id: "header" }],
  });
  expect(L.kind).toBe("e_archive");
  expect(L.primary).toBe("#0f172a");
  expect(L.accent).toBe("#abc");
  expect(L.blocks[0]).toEqual({ id: "totals", hidden: true });
  expect(L.blocks[1]).toEqual({ id: "header", hidden: false });
  expect(L.blocks.map((b) => b.id).sort()).toEqual([...BLOCK_IDS].sort());
  expect(L.blocks.find((b) => b.id === "qr").hidden).toBe(true);
  expect(L.lineCols.find((c) => c.id === "barcode").hidden).toBe(true);
});

test("moveBlock reorders and moveVisible steps among shown items", () => {
  const blocks = BLOCK_IDS.map((id) => ({ id, hidden: id === "notes" }));
  const down = moveBlock(blocks, "header", "parties");
  expect(down[0].id).toBe("parties");
  expect(down[1].id).toBe("header");
  const visDown = moveVisible(blocks, "header", 1);
  expect(visDown[0].id).toBe("parties");
  expect(visDown[1].id).toBe("header");
  const visUp = moveVisible(visDown, "header", -1);
  expect(visUp[0].id).toBe("header");
});

test("setBlockHidden toggles a block", () => {
  const next = setBlockHidden(defaultLayout().blocks, "iban", true);
  expect(next.find((b) => b.id === "iban").hidden).toBe(true);
  expect(next.find((b) => b.id === "lines").hidden).toBe(false);
});

test("layoutToXslt writes stylesheet, colors and skips hidden blocks", () => {
  const layout = normalizeLayout({
    kind: "e_archive",
    primary: "#112233",
    accent: "#445566",
    companyTitle: "Demo A.Ş.",
    blocks: [
      { id: "header" },
      { id: "lines" },
      { id: "iban", hidden: true },
      { id: "notes", hidden: true },
    ],
  });
  const xslt = layoutToXslt(layout);
  expect(xslt).toContain("<xsl:stylesheet");
  expect(xslt).toContain("n1:Invoice");
  expect(xslt).toContain("cac:InvoiceLine");
  expect(xslt).toContain("#112233");
  expect(xslt).toContain("#445566");
  expect(xslt).toContain("e-Arşiv Fatura");
  expect(xslt).toContain("Demo A.Ş.");
  expect(xslt).toContain("Mal / Hizmet");
  expect(xslt).not.toContain("IBAN / ödeme");
  expect(xslt).not.toContain(">Notlar<");
  expect(xslt).not.toContain("GİB karekod");
  expect(xslt).not.toContain("Stok kodu");
});

test("layoutToXslt includes added line columns and extra blocks", () => {
  const layout = normalizeLayout({
    blocks: [{ id: "lines" }, { id: "balance" }, { id: "qr" }],
    lineCols: [
      { id: "sku" },
      { id: "barcode" },
      { id: "name" },
      { id: "discount" },
      { id: "vat" },
      { id: "net_price" },
    ],
  });
  const xslt = layoutToXslt(layout);
  expect(xslt).toContain("Stok kodu");
  expect(xslt).toContain("SellersItemIdentification");
  expect(xslt).toContain("Barkod");
  expect(xslt).toContain("İskonto");
  expect(xslt).toContain("KDV");
  expect(xslt).toContain("KDV'siz fiyat");
  expect(xslt).toContain("Güncel bakiye");
  expect(xslt).toContain("GİB karekod");
  expect(xslt).toContain("DocumentType='QR'");
});

test("xmlEscape encodes markup", () => {
  expect(xmlEscape(`a<"&>`)).toBe("a&lt;&quot;&amp;&gt;");
});

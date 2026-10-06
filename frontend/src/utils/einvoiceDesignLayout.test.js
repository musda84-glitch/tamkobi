import {
  BLOCK_IDS,
  defaultLayout,
  layoutToXslt,
  moveBlock,
  moveVisible,
  normalizeLayout,
  packBlockRows,
  setBlockHidden,
  setBlockSpan,
  xmlEscape,
} from "./einvoiceDesignLayout";

test("default layout shows core blocks and hides extra fields", () => {
  const L = defaultLayout("e_invoice");
  expect(L.blocks.map((b) => b.id)).toEqual(BLOCK_IDS);
  expect(L.blocks.find((b) => b.id === "header").hidden).toBe(false);
  expect(L.blocks.find((b) => b.id === "header").span).toBe(12);
  expect(L.blocks.find((b) => b.id === "supplier").span).toBe(6);
  expect(L.blocks.find((b) => b.id === "customer").span).toBe(6);
  expect(L.blocks.find((b) => b.id === "invoice_no")).toBeUndefined();
  expect(L.blocks.find((b) => b.id === "order_no")).toBeUndefined();
  expect(L.blocks.find((b) => b.id === "qr").hidden).toBe(true);
  expect(L.blocks.find((b) => b.id === "balance").hidden).toBe(true);
  expect(L.lineCols.find((c) => c.id === "sku").hidden).toBe(true);
  expect(L.lineCols.find((c) => c.id === "name").hidden).toBe(false);
  expect(L.metaFields.find((f) => f.id === "number").hidden).toBe(false);
  expect(L.metaFields.find((f) => f.id === "order_no").hidden).toBe(true);
  expect(L.totalRows.find((r) => r.id === "kdv").hidden).toBe(false);
  expect(L.totalRows.find((r) => r.id === "allowance").hidden).toBe(true);
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
  expect(L.blocks[0]).toEqual({ id: "totals", hidden: true, span: 12 });
  expect(L.blocks[1]).toEqual({ id: "header", hidden: false, span: 12 });
  expect(L.blocks.map((b) => b.id).sort()).toEqual([...BLOCK_IDS].sort());
  expect(L.blocks.find((b) => b.id === "qr").hidden).toBe(true);
  expect(L.lineCols.find((c) => c.id === "barcode").hidden).toBe(true);
});

test("moveBlock reorders and moveVisible steps among shown items", () => {
  const blocks = BLOCK_IDS.map((id) => ({ id, hidden: id === "notes" }));
  const down = moveBlock(blocks, "header", "supplier");
  expect(down[0].id).toBe("supplier");
  expect(down[1].id).toBe("header");
  const visDown = moveVisible(blocks, "header", 1);
  expect(visDown[0].id).toBe("supplier");
  expect(visDown[1].id).toBe("header");
  const visUp = moveVisible(visDown, "header", -1);
  expect(visUp[0].id).toBe("header");
});

test("legacy parties expands to supplier and customer at half width", () => {
  const L = normalizeLayout({
    blocks: [{ id: "header" }, { id: "parties" }],
  });
  expect(L.blocks.find((b) => b.id === "parties")).toBeUndefined();
  expect(L.blocks.find((b) => b.id === "supplier")).toEqual({ id: "supplier", hidden: false, span: 6 });
  expect(L.blocks.find((b) => b.id === "customer")).toEqual({ id: "customer", hidden: false, span: 6 });
});

test("legacy invoice_no and order_no fold into fatura bilgileri fields", () => {
  const L = normalizeLayout({
    blocks: [
      { id: "header" },
      { id: "invoice_no" },
      { id: "order_no", hidden: false },
    ],
  });
  expect(L.blocks.find((b) => b.id === "invoice_no")).toBeUndefined();
  expect(L.blocks.find((b) => b.id === "order_no")).toBeUndefined();
  expect(L.metaFields.find((f) => f.id === "number").hidden).toBe(false);
  expect(L.metaFields.find((f) => f.id === "order_no").hidden).toBe(false);
});

test("setBlockSpan and packBlockRows place half-width blocks side by side", () => {
  const spanned = setBlockSpan(defaultLayout().blocks, "header", 6);
  expect(spanned.find((b) => b.id === "header").span).toBe(6);
  const rows = packBlockRows([
    { id: "header", span: 6 },
    { id: "qr", span: 6 },
    { id: "supplier", span: 6 },
    { id: "customer", span: 6 },
    { id: "meta", span: 12 },
  ]);
  expect(rows.map((r) => r.map((b) => b.id))).toEqual([
    ["header", "qr"],
    ["supplier", "customer"],
    ["meta"],
  ]);
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
  expect(xslt).toContain("Fatura numarası");
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
  expect(xslt).toContain("DocumentType='QR'");
  expect(xslt).not.toMatch(/inv-k">GİB karekod/);
});

test("layoutToXslt packs half-width blocks and emits invoice/order numbers in meta", () => {
  const layout = normalizeLayout({
    blocks: [
      { id: "header", span: 6 },
      { id: "qr", span: 6 },
      { id: "supplier", span: 6 },
      { id: "customer", span: 6 },
      { id: "lines", hidden: true },
      { id: "totals", hidden: true },
      { id: "notes", hidden: true },
      { id: "iban", hidden: true },
    ],
    metaFields: [
      { id: "number" },
      { id: "date" },
      { id: "profile" },
      { id: "ettn" },
      { id: "order_no" },
    ],
  });
  const xslt = layoutToXslt(layout);
  expect(xslt).toContain('width="50%"');
  expect(xslt).toContain("SATICI");
  expect(xslt).toContain("ALICI");
  expect(xslt).toContain("Fatura numarası");
  expect(xslt).toContain("/n1:Invoice/cbc:ID");
  expect(xslt).toContain("Sipariş numarası");
  expect(xslt).toContain("cac:OrderReference/cbc:ID");
  expect(xslt).toContain("class=\"inv-row\"");
});

test("layoutToXslt includes optional totals rows", () => {
  const layout = normalizeLayout({
    blocks: [{ id: "totals" }, { id: "lines", hidden: true }, { id: "meta", hidden: true }],
    totalRows: [
      { id: "subtotal" },
      { id: "allowance" },
      { id: "exemption" },
      { id: "kdv" },
      { id: "tevkifat" },
      { id: "grand" },
    ],
  });
  const xslt = layoutToXslt(layout);
  expect(xslt).toContain("Mal hizmet toplam");
  expect(xslt).toContain("İskonto");
  expect(xslt).toContain("İstisna");
  expect(xslt).toContain("KDV");
  expect(xslt).toContain("Tevkifat");
  expect(xslt).toContain("AllowanceTotalAmount");
  expect(xslt).toContain("WithholdingTaxTotal");
  expect(xslt).toContain("TaxExemptionReason");
});

test("xmlEscape encodes markup", () => {
  expect(xmlEscape(`a<"&>`)).toBe("a&lt;&quot;&amp;&gt;");
});

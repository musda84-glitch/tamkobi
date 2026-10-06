import {
  BLOCK_IDS,
  defaultLayout,
  layoutToXslt,
  metaGridColsClass,
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
  expect(L.blocks.find((b) => b.id === "gib_seal")).toBeUndefined();
  expect(L.blocks.find((b) => b.id === "gib_seal_invoice").hidden).toBe(true);
  expect(L.blocks.find((b) => b.id === "gib_seal_invoice").span).toBe(4);
  expect(L.blocks.find((b) => b.id === "gib_seal_archive").hidden).toBe(true);
  expect(L.blocks.find((b) => b.id === "gib_seal_archive").span).toBe(4);
  expect(L.blocks.find((b) => b.id === "qr").hidden).toBe(true);
  expect(L.qrSize).toBe(96);
  expect(L.logoSize).toBe(72);
  expect(L.blocks.find((b) => b.id === "spacer").hidden).toBe(true);
  expect(L.blocks.find((b) => b.id === "spacer").span).toBe(4);
  expect(L.blocks.find((b) => b.id === "balance").hidden).toBe(true);
  expect(L.lineCols.find((c) => c.id === "sku").hidden).toBe(true);
  expect(L.lineCols.find((c) => c.id === "name").hidden).toBe(false);
  expect(L.metaFields.find((f) => f.id === "number").hidden).toBe(false);
  expect(L.metaFields.find((f) => f.id === "invoice_date").hidden).toBe(false);
  expect(L.metaFields.find((f) => f.id === "issue_time").hidden).toBe(false);
  expect(L.metaFields.find((f) => f.id === "customization").hidden).toBe(false);
  expect(L.metaFields.find((f) => f.id === "invoice_type").hidden).toBe(false);
  expect(L.metaFields.find((f) => f.id === "despatch_no").hidden).toBe(false);
  expect(L.metaFields.find((f) => f.id === "due_date").hidden).toBe(false);
  expect(L.metaFields.find((f) => f.id === "date").hidden).toBe(true);
  expect(L.metaFields.find((f) => f.id === "ettn").hidden).toBe(true);
  expect(L.metaFields.find((f) => f.id === "order_no").hidden).toBe(true);
  expect(L.headerFields.find((f) => f.id === "supplier_name").hidden).toBe(true);
  expect(L.headerFields.find((f) => f.id === "supplier_address").hidden).toBe(true);
  expect(L.totalRows.find((r) => r.id === "kdv").hidden).toBe(false);
  expect(L.totalRows.find((r) => r.id === "allowance").hidden).toBe(false);
  expect(L.totalRows.find((r) => r.id === "matrah").hidden).toBe(false);
  expect(L.totalRows.find((r) => r.id === "inclusive").hidden).toBe(false);
  expect(L.totalRows.find((r) => r.id === "exemption").hidden).toBe(true);
  expect(L.kind).toBe("e_invoice");
  expect(L.fontSize).toBe(12);
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
  expect(xslt).not.toContain("Demo A.Ş.");
  expect(xslt).toContain("Mal / Hizmet");
  expect(xslt).toContain("Fatura No");
  expect(xslt).toContain("Özelleştirme No");
  expect(xslt).toContain("Fatura Tipi");
  expect(xslt).not.toContain("class=\"inv-badge\"");
  expect(xslt).not.toContain("class=\"inv-no\"");
  expect(xslt).not.toContain("IBAN / ödeme");
  expect(xslt).not.toContain(">Notlar<");
  expect(xslt).not.toContain("GİB karekod");
  expect(xslt).not.toContain("Stok kodu");
  expect(xslt).not.toContain('class="inv-gib-seal"');
  expect(xslt).not.toContain("E-Fatura Logo");
  expect(xslt).not.toContain("E-Arşiv Logo");
});

test("layoutToXslt includes added line columns and extra blocks", () => {
  const layout = normalizeLayout({
    qrSize: 160,
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
  expect(xslt).toContain("width:160px;height:160px");
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
      { id: "customization" },
      { id: "profile" },
      { id: "invoice_type" },
      { id: "number" },
      { id: "invoice_date" },
      { id: "date" },
      { id: "issue_time" },
      { id: "despatch_no" },
      { id: "despatch_date" },
      { id: "due_date" },
      { id: "ettn" },
      { id: "order_no" },
    ],
  });
  const xslt = layoutToXslt(layout);
  expect(xslt).toContain('width="50%"');
  expect(xslt).toContain("SATICI");
  expect(xslt).toContain("ALICI");
  expect(xslt).toContain("Fatura No:");
  expect(xslt).toContain("Fatura Tarihi:");
  expect(xslt).toContain("Düzenleme tarihi:");
  expect(xslt).toContain("Fatura Saati:");
  expect(xslt).toContain("Özelleştirme No:");
  expect(xslt).toContain("Fatura Tipi:");
  expect(xslt).toContain("İrsaliye No:");
  expect(xslt).toContain("İrsaliye Tarihi:");
  expect(xslt).toContain("Son Ödeme Tarihi:");
  expect(xslt).toContain("/n1:Invoice/cbc:ID");
  expect(xslt).toContain("/n1:Invoice/cbc:IssueTime");
  expect(xslt).toContain("/n1:Invoice/cbc:CustomizationID");
  expect(xslt).toContain("/n1:Invoice/cbc:InvoiceTypeCode");
  expect(xslt).toContain("DespatchDocumentReference/cbc:ID");
  expect(xslt).toContain("Sipariş No:");
  expect(xslt).toContain("cac:OrderReference/cbc:ID");
  expect(xslt).toContain("class=\"inv-row\"");
  expect(xslt).toContain("class=\"inv-meta-k\"");
  expect(xslt).toContain("font-weight:inherit");
  expect(xslt).not.toMatch(/class="inv-k">Fatura No/);
});

test("layoutToXslt includes optional totals rows", () => {
  const layout = normalizeLayout({
    blocks: [{ id: "totals" }, { id: "lines", hidden: true }, { id: "meta", hidden: true }],
    totalRows: [
      { id: "subtotal" },
      { id: "allowance" },
      { id: "matrah" },
      { id: "kdv" },
      { id: "tevkifat" },
      { id: "inclusive" },
      { id: "grand" },
      { id: "exemption" },
    ],
  });
  const xslt = layoutToXslt(layout);
  expect(xslt).toContain("Mal Hizmet Toplam Tutarı");
  expect(xslt).toContain("Toplam İskonto");
  expect(xslt).toContain("KDV Matrahı");
  expect(xslt).toContain("Hesaplanan");
  expect(xslt).toContain("İstisna");
  expect(xslt).toContain("Hesaplanan KDV Tevkifat");
  expect(xslt).toContain("Vergiler Dahil Toplam Tutar");
  expect(xslt).toContain("Ödenecek Tutar");
  expect(xslt).toContain("AllowanceTotalAmount");
  expect(xslt).toContain("TaxExclusiveAmount");
  expect(xslt).toContain("TaxInclusiveAmount");
  expect(xslt).toContain("WithholdingTaxTotal");
  expect(xslt).toContain("TaxExemptionReason");
  expect(xslt).toContain('class="inv-tot"');
  expect(xslt).toContain("format-number");
  expect(xslt).toContain('decimal-format name="tr"');
  expect(xslt).toContain("<xsl:text> TL</xsl:text>");
  expect(xslt).toContain("DocumentCurrencyCode");
  expect(xslt).toContain("@currencyID");
  expect(xslt).not.toMatch(/class="inv-k">Mal Hizmet Toplam Tutarı/);
});

test("legacy gib_seal maps to the matching e-Fatura or e-Arşiv seal", () => {
  const invoice = normalizeLayout({
    kind: "e_invoice",
    blocks: [{ id: "gib_seal", hidden: false, span: 4 }],
  });
  expect(invoice.blocks.find((b) => b.id === "gib_seal")).toBeUndefined();
  expect(invoice.blocks.find((b) => b.id === "gib_seal_invoice")).toEqual({ id: "gib_seal_invoice", hidden: false, span: 4 });
  expect(invoice.blocks.find((b) => b.id === "gib_seal_archive").hidden).toBe(true);

  const archive = normalizeLayout({
    kind: "e_archive",
    blocks: [{ id: "gib_seal", hidden: false, span: 6 }],
  });
  expect(archive.blocks.find((b) => b.id === "gib_seal_archive")).toEqual({ id: "gib_seal_archive", hidden: false, span: 6 });
  expect(archive.blocks.find((b) => b.id === "gib_seal_invoice").hidden).toBe(true);
});

test("layoutToXslt embeds both GIB seals independently", () => {
  const invoice = layoutToXslt(normalizeLayout({
    kind: "e_invoice",
    blocks: [{ id: "gib_seal_invoice" }, { id: "header", hidden: true }, { id: "meta", hidden: true }, { id: "lines", hidden: true }, { id: "totals", hidden: true }],
  }));
  expect(invoice).toContain("inv-gib-seal");
  expect(invoice).toContain("E-Fatura Logo");
  expect(invoice).toContain("e-FATURA");
  expect(invoice).toContain("data:image/jpeg;base64,");
  expect(invoice).not.toContain("e-Arşiv Fatura");

  const archive = layoutToXslt(normalizeLayout({
    kind: "e_archive",
    blocks: [{ id: "gib_seal_archive" }, { id: "header", hidden: true }, { id: "meta", hidden: true }, { id: "lines", hidden: true }, { id: "totals", hidden: true }],
  }));
  expect(archive).toContain("E-Arşiv Logo");
  expect(archive).toContain("e-Arşiv Fatura");
  expect(archive).not.toContain("e-FATURA");

  const both = layoutToXslt(normalizeLayout({
    blocks: [
      { id: "gib_seal_invoice", span: 4 },
      { id: "gib_seal_archive", span: 4 },
      { id: "header", hidden: true },
      { id: "meta", hidden: true },
      { id: "lines", hidden: true },
      { id: "totals", hidden: true },
    ],
  }));
  expect(both).toContain("e-FATURA");
  expect(both).toContain("e-Arşiv Fatura");
});

test("layoutToXslt header is logo only without company title", () => {
  const xslt = layoutToXslt(normalizeLayout({
    logo: "data:image/png;base64,aaa",
    companyTitle: "Gizleme A.Ş.",
    blocks: [
      { id: "header" },
      { id: "supplier", hidden: true },
      { id: "customer", hidden: true },
      { id: "meta", hidden: true },
      { id: "lines", hidden: true },
      { id: "totals", hidden: true },
      { id: "notes", hidden: true },
      { id: "iban", hidden: true },
    ],
  }));
  expect(xslt).toContain('alt="logo"');
  expect(xslt).toContain("data:image/png;base64,aaa");
  expect(xslt).toContain("height:72px");
  expect(xslt).not.toContain("Gizleme A.Ş.");
  expect(xslt).not.toContain("AccountingSupplierParty");
});

test("metaGridColsClass always stacks like GIB paper", () => {
  expect(metaGridColsClass(4, 4)).toBe("grid-cols-1");
  expect(metaGridColsClass(4, 6)).toBe("grid-cols-1");
  expect(metaGridColsClass(6, 4)).toBe("grid-cols-1");
  expect(metaGridColsClass(12, 4)).toBe("grid-cols-1");
  expect(metaGridColsClass(12, 3)).toBe("grid-cols-1");
});

test("layoutToXslt writes GIB-style inline meta rows at any width", () => {
  const stacked = layoutToXslt(normalizeLayout({
    blocks: [{ id: "meta", span: 4 }],
    metaFields: [{ id: "number" }, { id: "date" }, { id: "profile" }, { id: "ettn" }],
  }));
  expect(stacked).toContain('class="inv-meta"');
  expect(stacked).toContain("class=\"inv-meta-k\"");
  expect(stacked).toMatch(/<tr>\s*<td class="inv-meta-k">Fatura No:[\s\S]*<\/tr>\s*<tr>[\s\S]*Düzenleme tarihi:/);
  expect(stacked).not.toContain("class=\"inv-no\"");
  expect(stacked).not.toMatch(/inv-meta-k \{[^}]*text-transform/);

  const full = layoutToXslt(defaultLayout("e_invoice"));
  expect(full).toContain('class="inv-meta"');
  expect(full).toContain("Özelleştirme No:");
  expect(full).toContain("Fatura Tipi:");
  expect(full).toContain("İrsaliye No:");
  expect(full).toContain("Son Ödeme Tarihi:");
  expect(full).toContain("' - '");
});

test("layoutToXslt uses selected logo height", () => {
  const xslt = layoutToXslt(normalizeLayout({
    logo: "data:image/png;base64,aaa",
    logoSize: 120,
    blocks: [
      { id: "header" },
      { id: "supplier", hidden: true },
      { id: "customer", hidden: true },
      { id: "meta", hidden: true },
      { id: "lines", hidden: true },
      { id: "totals", hidden: true },
      { id: "notes", hidden: true },
      { id: "iban", hidden: true },
    ],
  }));
  expect(xslt).toContain("height:120px");
  expect(xslt).not.toContain("height:72px");
});

test("layoutToXslt header can include supplier name from UBL", () => {
  const xslt = layoutToXslt(normalizeLayout({
    logo: "data:image/png;base64,aaa",
    headerFields: [{ id: "supplier_name" }],
    blocks: [
      { id: "header" },
      { id: "supplier", hidden: true },
      { id: "customer", hidden: true },
      { id: "meta", hidden: true },
      { id: "lines", hidden: true },
      { id: "totals", hidden: true },
      { id: "notes", hidden: true },
      { id: "iban", hidden: true },
    ],
  }));
  expect(xslt).toContain("inv-brand-name");
  expect(xslt).toContain("AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name");
});

test("layoutToXslt emits empty spacer block when added", () => {
  const xslt = layoutToXslt(normalizeLayout({
    blocks: [
      { id: "spacer", span: 4 },
      { id: "header", hidden: true },
      { id: "supplier", hidden: true },
      { id: "customer", hidden: true },
      { id: "meta", hidden: true },
      { id: "lines", hidden: true },
      { id: "totals", hidden: true },
      { id: "notes", hidden: true },
      { id: "iban", hidden: true },
    ],
  }));
  expect(xslt).toContain('class="inv-spacer"');
  expect(xslt).toContain("width=\"33%\"");
});

test("layoutToXslt uses paper font size and spaced invoice dates", () => {
  const xslt = layoutToXslt(normalizeLayout({
    fontSize: 9,
    blocks: [{ id: "meta" }, { id: "lines", hidden: true }, { id: "totals", hidden: true }],
  }));
  expect(xslt).toContain("font-size:9px");
  expect(xslt).toContain("substring(/n1:Invoice/cbc:IssueDate,9,2)");
  expect(xslt).toContain("' - '");
});

test("xmlEscape encodes markup", () => {
  expect(xmlEscape(`a<"&>`)).toBe("a&lt;&quot;&amp;&gt;");
});

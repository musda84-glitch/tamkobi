import {
  BLOCK_IDS,
  CLASSIC_ISNET_NAME,
  blockFontFamily,
  blockFontSize,
  classicIsnetLayout,
  defaultLayout,
  filledMetaFields,
  gibSafeLogoSrc,
  layoutToXslt,
  metaGridColsClass,
  moveBlock,
  moveVisible,
  normalizeLayout,
  detachFromColumn,
  extractLayoutComment,
  packBlockRows,
  previewIban,
  previewNotes,
  sampleMetaValue,
  setBlockFont,
  setBlockFontSize,
  setBlockHidden,
  setBlockSpan,
  stackBlock,
  unitLabel,
  xmlEscape,
} from "./einvoiceDesignLayout";

test("unitLabel maps UNECE codes to Turkish stock units", () => {
  expect(unitLabel("C62")).toBe("Adet");
  expect(unitLabel("niu")).toBe("Adet");
  expect(unitLabel("Adet")).toBe("Adet");
  expect(unitLabel("KGM")).toBe("Kg");
  expect(unitLabel("LTR")).toBe("Lt");
  expect(unitLabel("")).toBe("");
  expect(unitLabel("XYZ")).toBe("XYZ");
});

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
  expect(L.ettnFontSize).toBe(18);
  expect(L.blocks.find((b) => b.id === "spacer").hidden).toBe(true);
  expect(L.blocks.find((b) => b.id === "spacer").span).toBe(4);
  expect(L.blocks.find((b) => b.id === "balance").hidden).toBe(true);
  expect(L.blocks.find((b) => b.id === "stamp").hidden).toBe(true);
  expect(L.blocks.find((b) => b.id === "stamp").span).toBe(6);
  expect(L.stampImage).toBe("");
  expect(L.stampSize).toBe(128);
  expect(L.stampAlign).toBe("right");
  expect(L.stampKnockoutWhite).toBe(false);
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
  expect(L.metaFields.find((f) => f.id === "ettn")).toBeUndefined();
  expect(L.blocks.find((b) => b.id === "ettn").hidden).toBe(false);
  expect(L.blocks.find((b) => b.id === "ettn").span).toBe(12);
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

test("IBAN and balance share a row and the same foot style", () => {
  const rows = packBlockRows([
    { id: "notes", span: 6 },
    { id: "iban", span: 6 },
    { id: "balance", span: 6 },
  ]);
  expect(rows.map((r) => r.map((b) => b.id))).toEqual([["notes"], ["iban", "balance"]]);
  const xslt = layoutToXslt(normalizeLayout({
    blocks: [
      { id: "iban", span: 6 },
      { id: "balance", span: 6 },
      { id: "header", hidden: true },
      { id: "lines", hidden: true },
      { id: "totals", hidden: true },
    ],
  }));
  expect(xslt).toContain("td.inv-foot");
  expect(xslt).toContain('class="inv-cell inv-foot"');
  expect(xslt).toContain(".inv-iban, .inv-balance { background:transparent; border:0;");
  expect(xslt).not.toMatch(/\.inv-balance\s*\{[^}]*border:\s*1px solid/);
  const balAt = xslt.indexOf("Güncel bakiye");
  const bal = xslt.slice(balAt - 180, balAt + 280);
  expect(bal).toContain('class="inv-k"');
  expect(bal).not.toContain("inv-v");
  expect(xslt).toContain("normalize-space(/n1:Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID)!=''");
  expect(xslt).toContain("DocumentType='BAKIYE'");
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
  expect(xslt).not.toContain("Stok Kodu");
  expect(xslt).not.toContain('class="inv-gib-seal"');
  expect(xslt).toContain("@unitCode='C62'");
  expect(xslt).toContain("<xsl:text>Adet</xsl:text>");
  expect(xslt).not.toMatch(/<td><xsl:value-of select="cbc:InvoicedQuantity\/@unitCode"\/><\/td>/);
  expect(xslt).not.toContain("E-Fatura Logo");
  expect(xslt).not.toContain("E-Arşiv Logo");
  expect(xslt).not.toContain('class="inv-stamp"');
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
  expect(xslt).toContain("Stok Kodu");
  expect(xslt).toContain("SellersItemIdentification");
  expect(xslt).toContain("Barkod");
  expect(xslt).toContain("İskonto");
  expect(xslt).toContain("KDV");
  expect(xslt).toContain("KDV'siz fiyat");
  expect(xslt).toContain("cac:Price/cbc:PriceAmount");
  expect(xslt).toContain("Güncel bakiye");
  expect(xslt).toContain("qrCodeImageString");
  expect(xslt).toContain("height:160px;width:160px");
  expect(xslt).not.toMatch(/inv-k">GİB karekod/);
});

test("layoutToXslt maps C62 unitCode to Adet in the Birim column", () => {
  const xslt = layoutToXslt(normalizeLayout({
    blocks: [{ id: "lines" }],
    lineCols: [{ id: "name" }, { id: "qty" }, { id: "unit" }, { id: "total" }],
  }));
  expect(xslt).toContain(">Birim<");
  expect(xslt).toContain("@unitCode='C62'");
  expect(xslt).toContain("<xsl:text>Adet</xsl:text>");
  expect(xslt).not.toMatch(/<td><xsl:value-of select="cbc:InvoicedQuantity\/@unitCode"\/><\/td>/);
  expect(xslt).not.toMatch(/cbc:InvoicedQuantity"\/><xsl:if test="cbc:InvoicedQuantity\/@unitCode/);
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

test("legacy visible meta ETTN becomes its own block", () => {
  const L = normalizeLayout({
    metaFields: [{ id: "number" }, { id: "ettn", hidden: false }],
  });
  expect(L.metaFields.find((f) => f.id === "ettn")).toBeUndefined();
  expect(L.blocks.find((b) => b.id === "ettn").hidden).toBe(false);
  const kept = normalizeLayout({
    blocks: [{ id: "ettn", hidden: true }],
    metaFields: [{ id: "ettn", hidden: false }],
  });
  expect(kept.blocks.find((b) => b.id === "ettn").hidden).toBe(true);
});

test("layoutToXslt writes ETTN as its own block", () => {
  const shownDefault = layoutToXslt(defaultLayout("e_invoice"));
  expect(shownDefault).toContain('class="inv-ettn"');
  expect(shownDefault).toContain('<span class="inv-ettn-v">');
  const hidden = layoutToXslt(normalizeLayout({
    blocks: [{ id: "ettn", hidden: true }, { id: "header", hidden: true }, { id: "meta", hidden: true }, { id: "lines", hidden: true }, { id: "totals", hidden: true }],
  }));
  expect(hidden).not.toContain('class="inv-ettn"');
  const shown = layoutToXslt(normalizeLayout({
    blocks: [{ id: "ettn" }, { id: "header", hidden: true }, { id: "meta", hidden: true }, { id: "lines", hidden: true }, { id: "totals", hidden: true }],
  }));
  expect(shown).toContain("class=\"inv-ettn\"");
  expect(shown).toContain('<span class="inv-ettn-k">ETTN</span>');
  expect(shown).toContain('<span class="inv-ettn-v">');
  expect(shown).toContain("/n1:Invoice/cbc:UUID");
  expect(shown).toContain("width=\"100%\"");
  expect(shown).toMatch(/display:flex/);
  expect(shown).toMatch(/inv-ettn-v \{[^}]*font-size:18px/);
  const sized = layoutToXslt(normalizeLayout({
    ettnFontSize: 12,
    blocks: [{ id: "ettn" }, { id: "header", hidden: true }, { id: "meta", hidden: true }, { id: "lines", hidden: true }, { id: "totals", hidden: true }],
  }));
  expect(sized).toMatch(/inv-ettn-v \{[^}]*font-size:12px/);
});

test("layout stores footer note and IBAN for preview and XSLT", () => {
  const empty = defaultLayout("e_invoice");
  expect(empty.noteText).toBe("");
  expect(empty.ibanText).toBe("");
  expect(previewNotes(empty)).toEqual(["İşbu belge elektronik olarak düzenlenmiştir."]);
  expect(previewIban(empty).iban).toContain("TR12");

  const L = normalizeLayout({
    noteText: "Teslimat kapıda yapılır.",
    ibanText: "TR33 0006 1005 1978 6457 8413 26",
    ibanName: "İş Bankası",
    blocks: [{ id: "notes" }, { id: "iban" }, { id: "header", hidden: true }, { id: "meta", hidden: true }, { id: "lines", hidden: true }, { id: "totals", hidden: true }],
  });
  expect(previewNotes(L)).toEqual(["Teslimat kapıda yapılır."]);
  expect(previewIban(L)).toEqual({ iban: "TR33 0006 1005 1978 6457 8413 26", name: "İş Bankası" });
  const xslt = layoutToXslt(L);
  expect(xslt).toContain("Teslimat kapıda yapılır.");
  expect(xslt).toContain("TR33 0006 1005 1978 6457 8413 26");
  expect(xslt).toContain("İş Bankası");
  expect(xslt).not.toContain("PayeeFinancialAccount/cbc:ID");
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
  expect(invoice).toContain("cbc:ProfileID='EARSIVFATURA'");
  expect(invoice).toContain("<xsl:text>e-Fatura</xsl:text>");

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
  expect(xslt).toContain('name="alt"');
  expect(xslt).toContain("cbc:ProfileID='EARSIVFATURA'");
  expect(xslt).toContain("<xsl:text>e-Fatura</xsl:text>");
  expect(xslt).toContain("firmaLogoImageString");
  expect(xslt).not.toContain("data:image/png;base64,aaa");
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
    metaFields: [{ id: "number" }, { id: "date" }, { id: "profile" }],
  }));
  expect(stacked).toContain('class="inv-meta"');
  expect(stacked).toContain("class=\"inv-meta-k\"");
  expect(stacked).toMatch(/inv-meta-k">Fatura No:[\s\S]*<\/tr>[\s\S]*Düzenleme tarihi:/);
  expect(stacked).toContain('xsl:if test="/n1:Invoice/cbc:ID[normalize-space(.)!=\'\']"');
  expect(stacked).not.toContain("class=\"inv-no\"");
  expect(stacked).not.toMatch(/inv-meta-k \{[^}]*text-transform/);

  const full = layoutToXslt(defaultLayout("e_invoice"));
  expect(full).toContain('class="inv-meta"');
  expect(full).toContain("Özelleştirme No:");
  expect(full).toContain("Fatura Tipi:");
  expect(full).toContain("İrsaliye No:");
  expect(full).toContain("Son Ödeme Tarihi:");
  expect(full).toContain("' - '");
  expect(full).toContain('xsl:if test="/n1:Invoice/cac:DespatchDocumentReference/cbc:ID[normalize-space(.)!=\'\']"');
  expect(full).toContain('xsl:if test="/n1:Invoice/cbc:IssueTime[normalize-space(.)!=\'\']"');
  expect(full).toContain("normalize-space(.)!=''");
  const withOrder = layoutToXslt(normalizeLayout({
    metaFields: [{ id: "order_no", hidden: false }, { id: "number" }],
  }));
  expect(withOrder).toContain('xsl:if test="/n1:Invoice/cac:OrderReference/cbc:ID[normalize-space(.)!=\'\']"');
});

test("filledMetaFields drops empty values and keeps chip order", () => {
  const L = normalizeLayout({
    metaFields: [
      { id: "number" },
      { id: "order_no", hidden: false },
      { id: "profile" },
      { id: "despatch_no", hidden: false },
    ],
  });
  const sample = {
    number: "ABC1",
    orderNo: "",
    profile: "TICARIFATURA",
    despatchNo: "   ",
  };
  const filled = filledMetaFields(L, sample);
  expect(filled.map((f) => f.id)).toEqual(["number", "profile"]);
  expect(sampleMetaValue("order_no", sample)).toBe("");
});

test("gibSafeLogoSrc keeps data URIs and drops http", () => {
  expect(gibSafeLogoSrc("data:image/png;base64,aaa")).toContain("data:image/png");
  expect(gibSafeLogoSrc("https://cdn.example/logo.png")).toBe("");
  expect(gibSafeLogoSrc("/api/files/logo.png")).toBe("");
});

test("layoutToXslt writes inline body font size and skips http logos", () => {
  const withHttp = layoutToXslt(normalizeLayout({
    font: "Arial",
    fontSize: 14,
    logo: "https://cdn.example/logo.png",
    blocks: [{ id: "header" }, { id: "lines", hidden: true }, { id: "totals", hidden: true }],
  }));
  expect(withHttp).toContain('font-size:14px');
  expect(withHttp).toMatch(/<body style="[^"]*font-size:14px/);
  expect(withHttp).toContain("Arial");
  expect(withHttp).not.toContain("https://cdn.example/logo.png");
});

test("layoutToXslt never embeds canvas logo in XSLT", () => {
  const xslt = layoutToXslt(normalizeLayout({
    logo: "data:image/png;base64,aaa",
    blocks: [{ id: "header" }],
  }));
  expect(xslt).toContain("firmaLogoImageString");
  expect(xslt).toContain("$IsLogoExists='true'");
  expect(xslt).not.toContain("data:image/png;base64,aaa");
  expect(xslt).not.toContain('src="data:image/png;base64,aaa"');
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
  expect(xslt).toContain("&#160;");
  expect(xslt).not.toMatch(/&nbsp;/i);
  expect(xslt).toMatch(/version="1\.0"/);
  expect(xslt).toContain("TAMKOBI_LAYOUT v1:");
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

test("per-block fontSize/font persist and drive XSLT independently", () => {
  let L = normalizeLayout({
    font: "Tahoma",
    fontSize: 12,
    ettnFontSize: 18,
    blocks: [
      { id: "meta", fontSize: 9, font: "Arial" },
      { id: "customer", fontSize: 14 },
      { id: "ettn", fontSize: 20 },
      { id: "lines", font: "Calibri", fontSize: 11 },
    ],
  });
  expect(L.blocks.find((b) => b.id === "meta")).toMatchObject({ fontSize: 9, font: "Arial" });
  expect(L.blocks.find((b) => b.id === "customer").fontSize).toBe(14);
  expect(L.blocks.find((b) => b.id === "ettn").fontSize).toBe(20);
  expect(L.ettnFontSize).toBe(20);
  expect(blockFontSize(L, "meta")).toBe(9);
  expect(blockFontFamily(L, "meta")).toBe("Arial");
  expect(blockFontSize(L, "supplier")).toBe(12);
  expect(blockFontFamily(L, "supplier")).toBe("Tahoma");
  expect(blockFontSize(L, "ettn")).toBe(20);

  L = normalizeLayout({
    ...L,
    blocks: setBlockFontSize(setBlockFont(L.blocks, "totals", "Times New Roman"), "totals", 13),
  });
  expect(L.blocks.find((b) => b.id === "totals")).toMatchObject({ fontSize: 13, font: "Times New Roman" });

  const legacy = normalizeLayout({ ettnFontSize: 16, blocks: [{ id: "ettn" }] });
  expect(legacy.blocks.find((b) => b.id === "ettn").fontSize).toBe(16);

  const xslt = layoutToXslt(L);
  expect(xslt).toContain(".inv-blk-meta");
  expect(xslt).toMatch(/\.inv-blk-meta \{[^}]*font-family:"Arial"/);
  expect(xslt).toMatch(/\.inv-blk-meta \{[^}]*font-size:9px/);
  expect(xslt).toMatch(/\.inv-blk-customer \{[^}]*font-size:14px/);
  expect(xslt).toMatch(/\.inv-blk-ettn \.inv-ettn-v \{[^}]*font-size:20px/);
  expect(xslt).toMatch(/\.inv-blk-lines \{[^}]*font-family:"Calibri"/);
  expect(xslt).toMatch(/\.inv-blk-totals \{[^}]*font-family:"Times New Roman"/);
  expect(xslt).toContain('class="inv-blk-meta"');
  expect(xslt).toContain('class="inv-blk-customer"');
});

test("classic İşNet layout places logo and QR and hides an empty description column", () => {
  for (const kind of ["e_invoice", "e_archive", "e_dispatch"]) {
    const layout = classicIsnetLayout(kind);
    expect(layout.preset).toBe("classic_isnet");
    expect(layout.kind).toBe(kind);
    expect(layout.notesTitle).toBe("AÇIKLAMALAR");
    expect(layout.ibanTitle).toBe("BANKA HESAP BİLGİLERİMİZ");
    expect(layout.lineCols.find((c) => c.id === "sku").hidden).toBe(false);
    expect(layout.lineCols.find((c) => c.id === "desc").hidden).toBe(false);
    expect(layout.lineCols.find((c) => c.id === "unit").hidden).toBe(false);
    expect(layout.lineCols.find((c) => c.id === "vat_amount").hidden).toBe(false);
    expect(layout.blocks.find((b) => b.id === "qr").hidden).toBe(true);
    const xslt = layoutToXslt(layout, kind);
    expect(CLASSIC_ISNET_NAME).toBe("Klasik (İşNet örneği)");
    expect(xslt.trimStart().startsWith("<?xml")).toBe(true);
    expect(xslt.indexOf("<?xml")).toBeLessThan(xslt.indexOf("TAMKOBI_LAYOUT"));
    expect(xslt).toContain('src="data:image/jpeg;base64,qrCodeImageString"');
    expect(xslt).toContain("firmaLogoImageString");
    expect(xslt).toContain("firmaImzaImageString");
    expect(xslt).not.toContain("DocumentType='QRCODE'");
    expect(xslt).not.toContain("DocumentTypeCode='QRCODE'");
    expect(xslt).not.toContain("EmbeddedDocumentBinaryObject");
    expect(xslt).toContain("IsLogoExistsValue");
    expect(xslt).toContain("IsEimzaLogoExistsValue");
    expect(xslt).toContain("Stok Kodu");
    expect(xslt).toContain("AÇIKLAMALAR");
    expect(xslt).toContain("BANKA HESAP BİLGİLERİMİZ");
    expect(xslt).toContain("KDV Tutarı");
    expect(xslt).toContain("white-space:nowrap");
    expect(xslt).toContain("<xsl:text>Adet</xsl:text>");
    expect(xslt).toContain("name=\"partyAddress\"");
    expect(xslt).not.toContain("Adet(Unit)");
    expect(xslt).toContain(`xsl:if test="${kind === "e_dispatch" ? "/n1:DespatchAdvice" : "/n1:Invoice"}`);
    if (kind === "e_dispatch") {
      expect(xslt).toContain("DespatchAdvice");
      expect(xslt).toContain("DeliveredQuantity");
      expect(xslt).toContain("<xsl:text>e-İrsaliye</xsl:text>");
    } else {
      expect(xslt).toContain("n1:Invoice");
      expect(xslt).toContain("InvoicedQuantity");
      expect(xslt).toContain("cbc:ProfileID='EARSIVFATURA'");
      expect(xslt).toContain("<xsl:text>e-Fatura</xsl:text>");
      expect(xslt).toContain("<xsl:text>e-Arşiv Fatura</xsl:text>");
    }
    expect(xslt).toMatch(/<xsl:stylesheet\s+version="1\.0"/);
    expect(xslt).not.toMatch(/<xsl:stylesheet[^>]*version="2\.0"/);
    expect(xslt).not.toContain('class="inv-stamp"');
  }
});

test("line KDV, iskonto and miktar use Turkish XSLT 1.0 paths", () => {
  const xslt = layoutToXslt(normalizeLayout({
    blocks: [{ id: "lines" }, { id: "totals" }, { id: "iban" }, { id: "balance" }, { id: "qr" }, { id: "header" }],
    lineCols: [{ id: "qty" }, { id: "discount" }, { id: "vat" }, { id: "total" }],
    totalRows: [{ id: "grand" }],
  }));
  expect(xslt).toContain("cac:TaxTotal/cac:TaxSubtotal/cbc:Percent");
  expect(xslt).not.toContain("cac:TaxSubtotal/cac:TaxCategory/cbc:Percent");
  expect(xslt).toContain("format-number(cac:AllowanceCharge/cbc:MultiplierFactorNumeric * 100, '#.##0,##', 'tr')");
  expect(xslt).toContain("format-number(number(cbc:InvoicedQuantity), '#.##0,##', 'tr')");
  expect(xslt).toContain("Ödenecek Tutar");
  expect(xslt).toContain("cac:LegalMonetaryTotal/cbc:PayableAmount");
  expect(xslt).toContain("normalize-space(/n1:Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID)!=''");
  expect(xslt).toContain("DocumentType='BAKIYE'");
  expect(xslt).not.toContain("DocumentTypeCode='QRCODE'");
  expect(xslt).not.toContain("DocumentType='QRCODE'");
  expect(xslt).not.toContain("EmbeddedDocumentBinaryObject");
  expect(xslt).toContain('src="data:image/jpeg;base64,qrCodeImageString"');
  expect(xslt).toContain("firmaLogoImageString");
  expect(xslt).toContain("firmaImzaImageString");
  expect(xslt).toMatch(/<xsl:stylesheet\s+version="1\.0"/);
});

const STAMP_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("layoutToXslt embeds a stamp data URI for e-Fatura and e-Arşiv", () => {
  for (const kind of ["e_invoice", "e_archive"]) {
    const xslt = layoutToXslt(normalizeLayout({
      kind,
      stampImage: STAMP_PNG,
      stampSize: 160,
      stampAlign: "center",
      blocks: [{ id: "stamp", hidden: false, span: 6 }],
    }, kind), kind);
    expect(xslt).toContain(STAMP_PNG);
    expect(xslt).toContain('alt="Kaşe / İmza"');
    expect(xslt).toContain('class="inv-stamp"');
    expect(xslt).toContain('align="center"');
    expect(xslt).toContain("text-align:center");
    expect(xslt).toContain("width:160px");
    expect(xslt).toContain('width="50%"');
    expect(xslt).not.toContain("cdn.example");
    expect(xslt).toMatch(/<xsl:stylesheet\s+version="1\.0"/);
    expect(xslt).not.toMatch(/version="2\.0"/);
  }
  const hidden = layoutToXslt(normalizeLayout({
    stampImage: STAMP_PNG,
    blocks: [{ id: "stamp", hidden: true }],
  }));
  expect(hidden).not.toContain('class="inv-stamp"');
  expect(hidden).not.toContain(STAMP_PNG);
});

test("stamp image drops http urls and payloads over 150 KB", () => {
  const http = normalizeLayout({ stampImage: "https://cdn.example/stamp.png", blocks: [{ id: "stamp" }] });
  expect(http.stampImage).toBe("");
  expect(http.stampAlign).toBe("right");
  expect(http.stampSize).toBe(128);
  const weird = normalizeLayout({ stampImage: STAMP_PNG, stampSize: 50, stampAlign: "top" });
  expect(weird.stampImage).toBe(STAMP_PNG);
  expect(weird.stampSize).toBe(128);
  expect(weird.stampAlign).toBe("right");
  const huge = `data:image/png;base64,${"A".repeat(210000)}`;
  const dropped = normalizeLayout({ stampImage: huge, blocks: [{ id: "stamp", hidden: false }] });
  expect(dropped.stampImage).toBe("");
  const xslt = layoutToXslt(dropped);
  expect(xslt).not.toContain(huge);
  expect(xslt).not.toContain("https://cdn.example/stamp.png");
});

function columnIds(rows) {
  return rows.map((row) => row.map((cell) => (cell.column || [cell]).map((b) => b.id)));
}

test("old layouts without stack open unchanged", () => {
  const legacy = {
    version: 1,
    kind: "e_invoice",
    blocks: [
      { id: "header", span: 12 },
      { id: "supplier", span: 6 },
      { id: "customer", span: 6 },
    ],
  };
  const L = normalizeLayout(legacy);
  expect(L.version).toBe(1);
  expect(L.blocks.some((b) => Object.prototype.hasOwnProperty.call(b, "stack"))).toBe(false);
  expect(L.blocks.find((b) => b.id === "supplier")).toEqual({ id: "supplier", hidden: false, span: 6 });
  expect(L.blocks.find((b) => b.id === "customer")).toEqual({ id: "customer", hidden: false, span: 6 });
  const plain = layoutToXslt(defaultLayout("e_invoice"));
  expect(plain).not.toContain('class="inv-stack"');
});

test("normalizeLayout keeps a stack chain and drops dangling refs", () => {
  const L = normalizeLayout({
    blocks: [
      { id: "gib_seal_archive", hidden: false, span: 4 },
      { id: "stamp", hidden: false, span: 6, stack: "gib_seal_archive" },
      { id: "qr", hidden: false, stack: "stamp" },
      { id: "notes", stack: "yok-boyle-bir-blok" },
      { id: "spacer", stack: "spacer" },
    ],
  });
  expect(L.version).toBe(1);
  expect(L.blocks.find((b) => b.id === "gib_seal_archive").stack).toBeUndefined();
  expect(L.blocks.find((b) => b.id === "stamp").stack).toBe("gib_seal_archive");
  expect(L.blocks.find((b) => b.id === "qr").stack).toBe("gib_seal_archive");
  expect(L.blocks.find((b) => b.id === "notes").stack).toBeUndefined();
  expect(L.blocks.find((b) => b.id === "spacer").stack).toBeUndefined();
  const cycled = normalizeLayout({
    blocks: [
      { id: "stamp", hidden: false, stack: "gib_seal_archive" },
      { id: "gib_seal_archive", hidden: false, span: 4, stack: "stamp" },
    ],
  });
  expect(cycled.blocks.find((b) => b.id === "stamp").stack).toBeUndefined();
  expect(cycled.blocks.find((b) => b.id === "gib_seal_archive").stack).toBe("stamp");
});

test("stackBlock piles sections in one column and orders above or below", () => {
  let blocks = [
    { id: "supplier", span: 4, hidden: false },
    { id: "gib_seal_archive", span: 4, hidden: false },
    { id: "customer", span: 4, hidden: false },
    { id: "stamp", span: 6, hidden: false },
    { id: "spacer", span: 12, hidden: false },
  ];
  blocks = stackBlock(blocks, "stamp", "gib_seal_archive", "below");
  expect(blocks.find((b) => b.id === "stamp")).toMatchObject({ stack: "gib_seal_archive", span: 4 });
  expect(blocks.find((b) => b.id === "gib_seal_archive").span).toBe(4);
  expect(blocks.find((b) => b.id === "supplier").span).toBe(4);
  let rows = packBlockRows(blocks.filter((b) => b.id !== "spacer"));
  expect(columnIds(rows)).toEqual([
    [["supplier"], ["gib_seal_archive", "stamp"], ["customer"]],
  ]);
  expect(rows[0][1].span).toBe(4);

  blocks = stackBlock(blocks, "stamp", "gib_seal_archive", "above");
  rows = packBlockRows(blocks.filter((b) => b.id !== "spacer"));
  expect(columnIds(rows)).toEqual([
    [["supplier"], ["stamp", "gib_seal_archive"], ["customer"]],
  ]);

  blocks = stackBlock(blocks, "stamp", "gib_seal_archive", "below");
  blocks = stackBlock(blocks, "spacer", "stamp", "below");
  rows = packBlockRows(blocks);
  expect(columnIds(rows)).toEqual([
    [["supplier"], ["gib_seal_archive", "stamp", "spacer"], ["customer"]],
  ]);
  expect(rows[0].every((cell) => cell.span === 4)).toBe(true);

  blocks = moveVisible(blocks, "stamp", 1);
  rows = packBlockRows(blocks);
  expect(columnIds(rows)[0][1]).toEqual(["gib_seal_archive", "spacer", "stamp"]);
  expect(blocks.find((b) => b.id === "stamp").stack).toBe("gib_seal_archive");

  blocks = moveVisible(blocks, "gib_seal_archive", -1);
  expect(blocks.find((b) => b.id === "gib_seal_archive").stack).toBeUndefined();
  const piled = packBlockRows(blocks).flat().find((cell) => (cell.column || []).some((b) => b.id === "stamp"));
  expect(piled.column.map((b) => b.id)).toEqual(["spacer", "stamp"]);
  expect(piled.column.some((b) => b.id === "gib_seal_archive")).toBe(false);

  const detached = detachFromColumn(blocks, "stamp");
  expect(detached.find((b) => b.id === "stamp").stack).toBeUndefined();
  expect(packBlockRows(detached).flat().every((cell) => cell.column.length === 1)).toBe(true);

  const widened = setBlockSpan(stackBlock(detached, "stamp", "gib_seal_archive", "below"), "stamp", 6);
  expect(widened.find((b) => b.id === "stamp").span).toBe(6);
  expect(widened.find((b) => b.id === "gib_seal_archive").span).toBe(6);
  expect(widened.find((b) => b.id === "supplier").span).toBe(4);
});

test("layoutToXslt stacks sections as divs inside one table cell", () => {
  let L = normalizeLayout({
    kind: "e_archive",
    blocks: [
      { id: "supplier", span: 4, hidden: false },
      { id: "gib_seal_archive", span: 4, hidden: false },
      { id: "customer", span: 4, hidden: false },
      { id: "stamp", span: 6, hidden: false },
      { id: "header", hidden: true },
      { id: "meta", hidden: true },
      { id: "ettn", hidden: true },
      { id: "lines", hidden: true },
      { id: "totals", hidden: true },
      { id: "notes", hidden: true },
      { id: "iban", hidden: true },
    ],
  }, "e_archive");
  L = { ...L, blocks: stackBlock(L.blocks, "stamp", "gib_seal_archive", "below") };
  const xslt = layoutToXslt(L, "e_archive");
  expect(xslt).toMatch(/<xsl:stylesheet\s+version="1\.0"/);
  expect(xslt).toContain('class="inv-stack"');
  expect(xslt).toContain("vertical-align:top");
  expect(xslt).toContain(".inv-stack + .inv-stack { margin-top:6px; }");
  const tables = [...xslt.matchAll(/<table class="inv-row"[\s\S]*?<\/table>/g)].map((m) => m[0]);
  const row = tables.find((table) => table.includes("inv-gib-seal") && table.includes('class="inv-stamp"') && table.includes("SATICI") && table.includes("ALICI"));
  expect(row).toBeTruthy();
  expect(row.match(/<td /g)).toHaveLength(3);
  const cell = row.split(/<td /).find((part) => part.includes("inv-gib-seal") && part.includes('class="inv-stamp"'));
  expect(cell.startsWith('width="33%" valign="top"')).toBe(true);
  expect(cell.indexOf("inv-gib-seal")).toBeLessThan(cell.indexOf('class="inv-stamp"'));
  expect(cell.match(/class="inv-stack"/g)).toHaveLength(2);
  const restored = normalizeLayout(extractLayoutComment(xslt), "e_archive");
  expect(restored.blocks.find((b) => b.id === "stamp").stack).toBe("gib_seal_archive");
  expect(restored.version).toBe(1);

  const above = layoutToXslt({ ...L, blocks: stackBlock(L.blocks, "stamp", "gib_seal_archive", "above") }, "e_archive");
  const aboveCell = [...above.matchAll(/<table class="inv-row"[\s\S]*?<\/table>/g)]
    .map((m) => m[0])
    .find((table) => table.includes("inv-gib-seal") && table.includes('class="inv-stamp"'))
    .split(/<td /)
    .find((part) => part.includes("inv-gib-seal") && part.includes('class="inv-stamp"'));
  expect(aboveCell.indexOf('class="inv-stamp"')).toBeLessThan(aboveCell.indexOf("inv-gib-seal"));
});

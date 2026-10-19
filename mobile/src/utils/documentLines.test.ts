import {
  addProductToItems,
  commitProductLine,
  computeLine,
  documentLineTotals,
  emptyLine,
  hydrateLine,
  invoiceBarcodeFeedback,
  invoiceBarcodeMiss,
  lineFromProduct,
  removeInvoiceItem,
} from "./documentLines";

describe("documentLines", () => {
  it("fills dual unit prices and net/gross totals with discount", () => {
    const row = computeLine({
      ...emptyLine(),
      name: "Hizmet",
      quantity: 2,
      unit_price: 100,
      vat_rate: 20,
      discount_rate: 10,
    });
    expect(row.unit_price).toBeCloseTo(100);
    expect(row.unit_price_incl).toBeCloseTo(120);
    expect(row.total).toBeCloseTo(180);
    expect(row.vat_amount).toBeCloseTo(36);
    expect(row.total_incl).toBeCloseTo(216);
  });

  it("back-calculates net from KDV'li unit price", () => {
    const row = computeLine({ ...emptyLine(), quantity: 1, vat_rate: 20, unit_price_incl: 120 }, "unit_price_incl");
    expect(row.unit_price).toBeCloseTo(100);
    expect(row.total).toBeCloseTo(100);
    expect(row.total_incl).toBeCloseTo(120);
  });

  it("recalculates gross when VAT changes", () => {
    const row = computeLine({ ...emptyLine(), quantity: 1, unit_price: 200, vat_rate: 10 }, "vat_rate");
    expect(row.unit_price_incl).toBeCloseTo(220);
    expect(row.total_incl).toBeCloseTo(220);
  });

  it("hydrateLine maps product_name and discount_percent", () => {
    const row = hydrateLine({ product_name: "Stok A", quantity: 1, unit_price: 50, discount_percent: 10, vat_rate: 20 });
    expect(row.name).toBe("Stok A");
    expect(row.product_name).toBe("Stok A");
    expect(row.discount_rate).toBe(10);
    expect(row.total).toBeCloseTo(45);
    expect(row.total_incl).toBeCloseTo(54);
  });

  it("lineFromProduct uses sale vs purchase price", () => {
    const prod = { id: "p1", name: "Kart", sale_price: 100, purchase_price: 80, vat_rate: 10, sku: "SKU-1" };
    const sale = lineFromProduct(prod, { invoiceType: "sales", quantity: 2 });
    expect(sale.unit_price).toBe(100);
    expect(sale.vat_rate).toBe(10);
    expect(sale.total_incl).toBeCloseTo(220);
    const buy = lineFromProduct(prod, { invoiceType: "purchase", quantity: 1 });
    expect(buy.unit_price).toBe(80);
  });

  it("documentLineTotals sums hariç, KDV and dahil", () => {
    const t = documentLineTotals([
      { name: "A", quantity: 2, unit_price: 100, vat_rate: 20, discount_rate: 10 },
      { name: "B", quantity: 1, unit_price: 50, vat_rate: 10, discount_rate: 0 },
    ]);
    expect(t.subtotal).toBeCloseTo(230);
    expect(t.vat).toBeCloseTo(41);
    expect(t.grandTotal).toBeCloseTo(271);
    expect(t.lineDiscount).toBeCloseTo(20);
  });

  it("treats sale_price as gross when price_includes_vat", () => {
    const prod = { id: "p2", name: "Brüt", sale_price: 120, purchase_price: 80, vat_rate: 20, price_includes_vat: true };
    const sale = lineFromProduct(prod, { invoiceType: "sales", quantity: 2 });
    expect(sale.unit_price).toBeCloseTo(100);
    expect(sale.unit_price_incl).toBeCloseTo(120);
    expect(sale.total).toBeCloseTo(200);
    expect(sale.vat_amount).toBeCloseTo(40);
    expect(sale.total_incl).toBeCloseTo(240);
    const buy = lineFromProduct(prod, { invoiceType: "purchase", quantity: 1 });
    expect(buy.unit_price).toBe(80);
  });

  it("adds a product onto an empty line or bumps quantity", () => {
    const prod = { id: "p1", name: "Masa", sale_price: 100, vat_rate: 20 };
    const first = addProductToItems([emptyLine()], prod, "sales");
    expect(first).toHaveLength(1);
    expect(first[0].product_id).toBe("p1");
    expect(first[0].quantity).toBe(1);
    const bumped = addProductToItems(first, prod, "sales");
    expect(bumped).toHaveLength(1);
    expect(bumped[0].quantity).toBe(2);
  });

  it("keeps the product VAT, defaults to 20 only when the card has none, and zeroes export", () => {
    const ten = lineFromProduct({ id: "p", name: "Ekmek", sale_price: 10, vat_rate: 10 }, { invoiceType: "sales" });
    expect(ten.vat_rate).toBe(10);
    const one = lineFromProduct({ id: "p", name: "İlaç", sale_price: 10, vat_rate: 1 }, { invoiceType: "sales" });
    expect(one.vat_rate).toBe(1);
    const zero = lineFromProduct({ id: "p", name: "İstisna", sale_price: 10, vat_rate: 0 }, { invoiceType: "sales" });
    expect(zero.vat_rate).toBe(0);
    expect(lineFromProduct({ id: "p", name: "Yok", sale_price: 10 }, { invoiceType: "sales" }).vat_rate).toBe(20);
    expect(lineFromProduct({ id: "p", name: "Boş", sale_price: 10, vat_rate: "" }, { invoiceType: "sales" }).vat_rate).toBe(20);
    expect(lineFromProduct({ id: "p", name: "Boş", sale_price: 10, vat_rate: null }, { invoiceType: "sales" }).vat_rate).toBe(20);
    expect(lineFromProduct({ id: "p", name: "İhraç", sale_price: 10, vat_rate: 10 }, { exportInvoice: true }).vat_rate).toBe(0);

    const kept = addProductToItems([emptyLine()], { id: "p10", name: "Ekmek", sale_price: 10, vat_rate: 10 }, "sales", 20);
    expect(kept[0].vat_rate).toBe(10);
    const missing = addProductToItems([emptyLine()], { id: "p20", name: "Yok", sale_price: 5 }, "sales", 20);
    expect(missing[0].vat_rate).toBe(20);
    const cardZero = addProductToItems([emptyLine()], { id: "p0", name: "Sıfır", sale_price: 5, vat_rate: 0 }, "sales", 20);
    expect(cardZero[0].vat_rate).toBe(0);
    const exported = addProductToItems([emptyLine()], { id: "px", name: "İhraç", sale_price: 10, vat_rate: 10 }, "sales", { exportInvoice: true });
    expect(exported[0].vat_rate).toBe(0);
    expect(addProductToItems([emptyLine()], { id: "px", name: "İhraç", sale_price: 10, vat_rate: 1 }, "sales", 0)[0].vat_rate).toBe(0);
  });

  it("prefers last purchase price on purchase invoices and keeps sale price otherwise", () => {
    const prod = {
      id: "p1",
      name: "Kart",
      sale_price: 100,
      purchase_price: 80,
      last_purchase_price: 55,
      vat_rate: 10,
    };
    expect(lineFromProduct(prod, { invoiceType: "purchase" }).unit_price).toBe(55);
    expect(lineFromProduct({ ...prod, last_purchase_price: null }, { invoiceType: "purchase" }).unit_price).toBe(80);
    expect(lineFromProduct({ ...prod, last_purchase_price: 0 }, { invoiceType: "purchase" }).unit_price).toBe(80);
    expect(lineFromProduct(prod, { invoiceType: "sales" }).unit_price).toBe(100);
    expect(lineFromProduct(prod, { invoiceType: "return" }).unit_price).toBe(100);
    expect(lineFromProduct(prod, { invoiceType: "proforma" }).unit_price).toBe(100);
  });

  it("merges the same variant and keeps a different variant on its own line", () => {
    const prod = {
      id: "p1",
      name: "Masa",
      sale_price: 100,
      purchase_price: 70,
      last_purchase_price: 60,
      vat_rate: 10,
      unit: "Adet",
      barcode: "869",
      sku: "MS",
      variants: [
        { name: "Meşe", barcode: "869-A", sku: "MS-A", price: 150 },
        { name: "Ceviz", barcode: "869-B", sku: "MS-B", sale_price: 140 },
        { name: "Ham", barcode: "869-C", sku: "MS-C" },
      ],
    };
    const first = commitProductLine([emptyLine()], prod, "sales", { scanCode: "869-A" });
    expect(first.bumped).toBe(false);
    expect(first.line.name).toBe("Masa - Meşe");
    expect(first.line.product_name).toBe("Masa - Meşe");
    expect(first.line.unit_price).toBe(150);
    expect(first.line.sku).toBe("MS-A");
    expect(first.line.barcode).toBe("869-A");
    expect(first.line.vat_rate).toBe(10);
    expect(first.line.quantity).toBe(1);
    expect(invoiceBarcodeFeedback(first)).toBe("Masa - Meşe eklendi");

    const again = commitProductLine(first.items, prod, "sales", { scanCode: "869-A" });
    expect(again.items).toHaveLength(1);
    expect(again.bumped).toBe(true);
    expect(again.line.quantity).toBe(2);
    expect(again.line.unit_price).toBe(150);
    expect(invoiceBarcodeFeedback(again)).toBe("Masa - Meşe +1 → faturada 2 Adet");

    const other = commitProductLine(again.items, prod, "sales", { scanCode: "MS-B" });
    expect(other.items).toHaveLength(2);
    expect(other.bumped).toBe(false);
    expect(other.line.name).toBe("Masa - Ceviz");
    expect(other.line.unit_price).toBe(140);
    expect(other.line.sku).toBe("MS-B");
    expect(other.line.barcode).toBe("869-B");
    expect(other.items[0].quantity).toBe(2);
    expect(invoiceBarcodeFeedback(other)).toBe("Masa - Ceviz eklendi");

    const plain = commitProductLine(other.items, prod, "sales", { scanCode: "869" });
    expect(plain.items).toHaveLength(3);
    expect(plain.line.name).toBe("Masa");
    expect(plain.line.unit_price).toBe(100);
    expect(plain.line.barcode).toBe("869");

    const fallback = commitProductLine([emptyLine()], prod, "purchase", { scanCode: "869-C" });
    expect(fallback.line.name).toBe("Masa - Ham");
    expect(fallback.line.unit_price).toBe(60);
    expect(fallback.line.vat_rate).toBe(10);
    const exportVariant = commitProductLine([emptyLine()], prod, "sales", { scanCode: "869-A", exportInvoice: true });
    expect(exportVariant.line.vat_rate).toBe(0);
    expect(exportVariant.line.unit_price).toBe(150);
    expect(invoiceBarcodeMiss("869-YOK")).toBe("Barkod eşleşmedi: 869-YOK");
  });

  it("removes an invoice line and keeps one empty row", () => {
    const a = computeLine({ ...emptyLine(), name: "Kapı", unit_price: 10 });
    const b = computeLine({ ...emptyLine(), name: "Kasa", unit_price: 20 });
    expect(removeInvoiceItem([a, b], 0).map((x) => x.name)).toEqual(["Kasa"]);
    const last = removeInvoiceItem([a], 0);
    expect(last).toHaveLength(1);
    expect(last[0].name).toBe("");
    expect(last[0].quantity).toBe(1);
  });
});

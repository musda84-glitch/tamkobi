import { lineFromProduct } from "./documentLines";
import {
  fieldSaleScanProduct,
  isSameScanLine,
  normalizeCode,
  resolveScanMatch,
  scanLineKey,
} from "./variantScan";

const V1 = { name: "Siyah", sku: "V1", barcode: "8680000000011", price: 110, sale_price: 105 };
const V2 = { name: "Beyaz", sku: "V2", barcode: "8680000000028", price: 120, sale_price: 115 };
const V3 = { name: "Mavi", sku: "V3-Mavi", barcode: "8680000000035", price: 130 };

const shirt = {
  id: "p1",
  name: "Tişört",
  sku: "TSH",
  barcode: "8680000000004",
  sale_price: 100,
  vat_rate: 20,
  unit: "Adet",
  variants: [V1, V2, V3],
};

test("normalizeCode trims and stringifies", () => {
  expect(normalizeCode(8680000000028)).toBe("8680000000028");
  expect(normalizeCode("  8680000000028  ")).toBe("8680000000028");
  expect(normalizeCode(null)).toBe("");
  expect(normalizeCode(undefined)).toBe("");
});

test("V2 barkodu ikinci varyantı döndürür", () => {
  const match = resolveScanMatch([shirt], "8680000000028");
  expect(match.product).toBe(shirt);
  expect(match.variant).toBe(V2);
});

test("V3 SKU ile okutma V3 döner", () => {
  const match = resolveScanMatch([shirt], "V3-Mavi");
  expect(match.variant).toBe(V3);
});

test("ana ürün barkodu variant null döner", () => {
  const match = resolveScanMatch([shirt], "8680000000004");
  expect(match.product).toBe(shirt);
  expect(match.variant).toBeNull();
  const skuClash = {
    ...shirt,
    sku: V2.barcode,
    variants: [{ ...V2, sku: shirt.barcode }],
  };
  expect(resolveScanMatch([skuClash], shirt.barcode).variant).toBeNull();
  expect(resolveScanMatch([skuClash], V2.barcode).variant.sku).toBe(shirt.barcode);
});

test("sayı barkod, boşluk ve büyük/küçük harf duyarsız SKU eşleşir", () => {
  const numeric = {
    ...shirt,
    barcode: 8680000000004,
    variants: [{ ...V2, barcode: 8680000000028 }],
  };
  expect(resolveScanMatch([numeric], "  8680000000028 ").variant.sku).toBe("V2");
  expect(resolveScanMatch([numeric], " 8680000000004 ").variant).toBeNull();
  expect(resolveScanMatch([shirt], "v3-mavi").variant).toBe(V3);
});

test("ana barkod birinci varyant barkoduna eşitse varyant döner", () => {
  const product = {
    ...shirt,
    barcode: "8680000000011",
    variants: [{ ...V1, barcode: "8680000000011" }, V2],
  };
  const match = resolveScanMatch([product], "8680000000011");
  expect(match.variant).toBe(product.variants[0]);
  expect(match.variant.name).toBe("Siyah");
});

test("eşleşme yoksa ve boş kod null", () => {
  expect(resolveScanMatch([shirt], "yok")).toBeNull();
  expect(resolveScanMatch([shirt], "")).toBeNull();
  expect(resolveScanMatch([shirt], "   ")).toBeNull();
  expect(resolveScanMatch([shirt], null)).toBeNull();
  expect(resolveScanMatch(null, "V1")).toBeNull();
});

test("tam eşleşme, büyük/küçük harf duyarsız turdan önce gelir", () => {
  const product = {
    id: "p",
    name: "P",
    barcode: "ABC",
    sku: "PARENT",
    variants: [{ name: "Alt", sku: "ALT", barcode: "abc" }],
  };
  expect(resolveScanMatch([product], "ABC").variant).toBeNull();
  expect(resolveScanMatch([product], "abc").variant.name).toBe("Alt");
});

test("isSameScanLine varyant satırını ayırır, varyantsız üründe product_id yeter", () => {
  const v1Line = { product_id: "p1", sku: "V1", barcode: "8680000000011", name: "Tişört - Siyah" };
  expect(isSameScanLine(v1Line, "p1", V2)).toBe(false);
  expect(isSameScanLine(v1Line, "p1", V1)).toBe(true);
  expect(isSameScanLine(v1Line, "p2", V1)).toBe(false);

  const plain = { product_id: "p9", sku: "KLM", barcode: "999", name: "Kalem" };
  expect(isSameScanLine(plain, "p9", null)).toBe(true);
  expect(isSameScanLine(plain, "p9", undefined)).toBe(true);
  expect(isSameScanLine(plain, "px", null)).toBe(false);
});

test("SKU boşsa satır kimliği varyant barkodudur", () => {
  const bare = { name: "Beden", sku: "  ", barcode: "8680000000028" };
  const line = { product_id: "p1", sku: "TSH", barcode: "8680000000028" };
  expect(isSameScanLine(line, "p1", bare)).toBe(true);
  expect(isSameScanLine(line, "p1", { ...bare, barcode: "8680000000011" })).toBe(false);
  expect(scanLineKey("p1", { sku: "", barcode: "8680000000028" })).toBe(scanLineKey("p1", { sku: "  ", barcode: "8680000000028" }));
  expect(scanLineKey("p1", { sku: "V1", barcode: "8680000000028" })).toBe(scanLineKey("p1", { sku: " V1 " }));
  expect(scanLineKey("p1", {})).toBe("p1");
});

function applyInvoiceScan(items, products, code) {
  const match = resolveScanMatch(products, code);
  if (!match) return items;
  const { product, variant } = match;
  const pid = product.id || product._id;
  const existing = items.findIndex((it) => isSameScanLine(it, pid, variant));
  if (existing >= 0) {
    return items.map((it, i) => (i === existing ? { ...it, quantity: Number(it.quantity || 0) + 1 } : it));
  }
  const label = variant ? `${product.name} - ${variant.name}` : product.name;
  return [...items, {
    product_id: pid,
    name: label,
    product_name: label,
    sku: variant?.sku || product.sku || "",
    barcode: variant?.barcode || product.barcode || "",
    quantity: 1,
  }];
}

test("faturada V1 sonrası V2 ayrı satır açar, V2 tekrarı yalnız onu artırır", () => {
  let items = [];
  items = applyInvoiceScan(items, [shirt], V1.barcode);
  items = applyInvoiceScan(items, [shirt], V2.barcode);
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({ name: "Tişört - Siyah", sku: "V1", barcode: V1.barcode, quantity: 1 });
  expect(items[1]).toMatchObject({
    name: "Tişört - Beyaz",
    product_name: "Tişört - Beyaz",
    sku: "V2",
    barcode: V2.barcode,
    quantity: 1,
  });
  items = applyInvoiceScan(items, [shirt], ` ${V2.barcode} `);
  expect(items).toHaveLength(2);
  expect(items[0].quantity).toBe(1);
  expect(items[1].quantity).toBe(2);
});

test("varyantsız ürün tekrar okutulunca aynı satır artar", () => {
  const pen = { id: "p9", name: "Kalem", sku: "KLM", barcode: "999", sale_price: 10, variants: [] };
  let items = applyInvoiceScan([], [pen], "999");
  items = applyInvoiceScan(items, [pen], " 999 ");
  expect(items).toHaveLength(1);
  expect(items[0].quantity).toBe(2);
  expect(items[0].sku).toBe("KLM");
  expect(items[0].name).toBe("Kalem");
});

function applyFieldScan(cart, products, code) {
  const match = resolveScanMatch(products, code);
  if (!match) return cart;
  const { product, variant } = match;
  const id = product.id;
  const existing = cart.findIndex((it) => isSameScanLine(it, id, variant));
  if (existing >= 0) {
    return cart.map((it, i) => (i === existing ? { ...it, quantity: Number(it.quantity || 0) + 1 } : it));
  }
  const src = fieldSaleScanProduct(product, variant);
  const line = lineFromProduct(src, { invoiceType: "sales", quantity: 1 });
  return [...cart, {
    product_id: id,
    product_name: src.name,
    sku: src.sku || "",
    barcode: src.barcode || "",
    quantity: 1,
    unit_price: line.unit_price,
  }];
}

test("saha fiyatı önce variant.price, yoksa sale_price, o da yoksa ana satış fiyatı", () => {
  const product = { ...shirt, sale_price: 100 };
  expect(fieldSaleScanProduct(product, { name: "Y", sku: "Y", barcode: "1", sale_price: 88 }).sale_price).toBe(88);
  expect(fieldSaleScanProduct(product, { name: "Z", sku: "Z", barcode: "2" }).sale_price).toBe(100);
  expect(fieldSaleScanProduct(product, null)).toBe(product);
});

test("sahada V2 kendi fiyatı ve adıyla satır açar, tekrarında yalnız o artar", () => {
  let cart = [];
  cart = applyFieldScan(cart, [shirt], V1.barcode);
  cart = applyFieldScan(cart, [shirt], V2.barcode);
  expect(cart).toHaveLength(2);
  expect(cart[0].product_name).toBe("Tişört - Siyah");
  expect(cart[0].unit_price).toBe(110);
  expect(cart[1]).toMatchObject({
    product_name: "Tişört - Beyaz",
    sku: "V2",
    barcode: V2.barcode,
    unit_price: 120,
    quantity: 1,
  });
  expect(cart[1].unit_price).not.toBe(shirt.sale_price);
  cart = applyFieldScan(cart, [shirt], V2.barcode);
  expect(cart).toHaveLength(2);
  expect(cart[0].quantity).toBe(1);
  expect(cart[1].quantity).toBe(2);
  expect(cart[1].unit_price).toBe(120);
});

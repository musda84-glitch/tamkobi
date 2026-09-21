import { addCartLine, cartCount, formatCartSheetLine, lineKey, normalizeNote, parseStoredCart, productCartQty, setCartLineQty, type B2BCart } from "./b2bCart";

describe("b2bCart", () => {
  test("same product + different notes stay separate lines", () => {
    let cart: B2BCart = {};
    cart = addCartLine(cart, "prod_01", 1, "kırmızı kutu");
    cart = addCartLine(cart, "prod_01", 2, "mavi kutu");
    expect(Object.keys(cart)).toHaveLength(2);
    expect(cart[lineKey("prod_01", "kırmızı kutu")].qty).toBe(1);
    expect(cart[lineKey("prod_01", "mavi kutu")].qty).toBe(2);
  });

  test("same product + same note increments quantity", () => {
    let cart = addCartLine({}, "prod_01", 1, "  aynı not  ");
    cart = addCartLine(cart, "prod_01", 3, "aynı not");
    expect(Object.keys(cart)).toHaveLength(1);
    expect(cart[lineKey("prod_01", "aynı not")].qty).toBe(4);
    expect(cartCount(cart)).toBe(4);
  });

  test("empty and missing notes share one line", () => {
    let cart = addCartLine({}, "prod_01", 1, "");
    cart = addCartLine(cart, "prod_01", 1, "  ");
    expect(Object.keys(cart)).toHaveLength(1);
    expect(cart[lineKey("prod_01", "")].qty).toBe(2);
  });

  test("parseStoredCart migrates legacy id→qty maps", () => {
    const cart = parseStoredCart({ prod_01: 3, prod_02: 0 });
    expect(cart[lineKey("prod_01", "")]).toEqual({ productId: "prod_01", qty: 3, note: "" });
    expect(cart[lineKey("prod_02", "")]).toBeUndefined();
  });

  test("parseStoredCart migrates packed { qty, note } maps", () => {
    const cart = parseStoredCart({ prod_01: { qty: 2, note: "özel" } });
    expect(cart[lineKey("prod_01", "özel")].qty).toBe(2);
  });

  test("setCartLineQty(0) removes the line", () => {
    const key = lineKey("prod_01", "x");
    const cart = setCartLineQty({ [key]: { productId: "prod_01", qty: 2, note: "x" } }, key, 0);
    expect(cart[key]).toBeUndefined();
  });

  test("normalizeNote trims and caps length", () => {
    expect(normalizeNote("  ab  ")).toBe("ab");
    expect(normalizeNote("x".repeat(600)).length).toBe(500);
  });

  test("formatCartSheetLine keeps name and qty/price on one string", () => {
    expect(formatCartSheetLine("Duvar Rafı Çizgili_DRD 35x20cm BEYAZ", 1, "160,00 ₺")).toBe(
      "Duvar Rafı Çizgili_DRD 35x20cm BEYAZ  1 × 160,00 ₺"
    );
    expect(formatCartSheetLine("Raf", 2, "", "kırmızı")).toBe("Raf  2 adet · kırmızı");
  });

  test("productCartQty sums every line of that product", () => {
    let cart = addCartLine({}, "prod_01", 1, "kırmızı");
    cart = addCartLine(cart, "prod_01", 2, "mavi");
    cart = addCartLine(cart, "prod_02", 4, "");
    expect(productCartQty(cart, "prod_01")).toBe(3);
    expect(productCartQty(cart, "prod_02")).toBe(4);
    expect(productCartQty(cart, "prod_99")).toBe(0);
  });
});

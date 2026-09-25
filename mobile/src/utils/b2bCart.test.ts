import { addCartLine, b2bFlashChrome, cartCount, cartHasItems, formatCartSheetLine, formatCartSheetMeta, heldCartsAsOrders, holdActiveCart, lineKey, normalizeNote, parseStoredCart, productCartQty, resumeHeldCart, setCartLineQty, type B2BCart } from "./b2bCart";

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

  test("formatCartSheetMeta puts qty and price on the second line", () => {
    expect(formatCartSheetMeta(1, "160,00 ₺")).toBe("1 × 160,00 ₺");
    expect(formatCartSheetMeta(2, "", "kırmızı")).toBe("2 adet · kırmızı");
    expect(formatCartSheetLine("Duvar Rafı Çizgili_DRD 35x20cm BEYAZ", 1, "160,00 ₺")).toBe(
      "Duvar Rafı Çizgili_DRD 35x20cm BEYAZ  1 × 160,00 ₺"
    );
  });

  test("productCartQty sums every line of that product", () => {
    let cart = addCartLine({}, "prod_01", 1, "kırmızı");
    cart = addCartLine(cart, "prod_01", 2, "mavi");
    cart = addCartLine(cart, "prod_02", 4, "");
    expect(productCartQty(cart, "prod_01")).toBe(3);
    expect(productCartQty(cart, "prod_02")).toBe(4);
    expect(productCartQty(cart, "prod_99")).toBe(0);
  });

  test("flash banner goes from gray to green with a solid border", () => {
    const idle = b2bFlashChrome(false);
    const on = b2bFlashChrome(true);
    expect(idle.borderStyle).toBe("solid");
    expect(on.borderStyle).toBe("solid");
    expect(idle.backgroundColor).toBe("#F8FAFC");
    expect(on.backgroundColor).toBe("#ECFDF5");
    expect(on.borderColor).toBe("#059669");
  });

  test("hold and siparişlerim view-only rows", () => {
    let cart: B2BCart = addCartLine({}, "prod_01", 2, "kırmızı");
    const held = holdActiveCart([], cart);
    expect(cartHasItems(held.cart)).toBe(false);
    expect(held.held[0].label).toBe("Bekleyen sepet #1");
    const resumed = resumeHeldCart(held.held, addCartLine({}, "prod_02", 1, ""), held.held[0].id);
    expect(resumed.cart[lineKey("prod_01", "kırmızı")].qty).toBe(2);
    expect(resumed.held[0].label).toBe("Bekleyen sepet #1");
    const rows = heldCartsAsOrders(held.held, [{ id: "prod_01", name: "A", price_gross: 10 }], {
      activeCart: addCartLine({}, "prod_01", 1, ""),
      priceGross: (p) => Number((p as { price_gross?: number }).price_gross) || 0,
    });
    expect(rows[0].order_number).toBe("Aktif sepet");
    expect(rows[1].order_number).toBe("Bekleyen sepet #1");
    expect(rows.every((r) => r.view_only)).toBe(true);
  });
});

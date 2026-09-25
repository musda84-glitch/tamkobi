
import { describe, expect, it } from "vitest";
import { addCartLine, cartHasItems, heldCartsAsOrders, holdActiveCart, lineKey, mergePortalOrderLists, normalizeNote, parseStoredCart, resumeHeldCart, setCartLineQty } from "./b2bCart";

describe("b2bCart", () => {
  it("same product + different notes stay separate lines", () => {
    let cart = {};
    cart = addCartLine(cart, "prod_01", 1, "kırmızı kutu");
    cart = addCartLine(cart, "prod_01", 2, "mavi kutu");
    expect(Object.keys(cart)).toHaveLength(2);
    expect(cart[lineKey("prod_01", "kırmızı kutu")].qty).toBe(1);
    expect(cart[lineKey("prod_01", "mavi kutu")].qty).toBe(2);
  });

  it("same product + same note increments quantity", () => {
    let cart = addCartLine({}, "prod_01", 1, "  aynı not  ");
    cart = addCartLine(cart, "prod_01", 3, "aynı not");
    expect(Object.keys(cart)).toHaveLength(1);
    expect(cart[lineKey("prod_01", "aynı not")].qty).toBe(4);
  });

  it("empty and missing notes share one line", () => {
    let cart = addCartLine({}, "prod_01", 1, "");
    cart = addCartLine(cart, "prod_01", 1, "  ");
    expect(Object.keys(cart)).toHaveLength(1);
    expect(cart[lineKey("prod_01", "")].qty).toBe(2);
  });

  it("parseStoredCart migrates legacy id→qty maps", () => {
    const cart = parseStoredCart({ prod_01: 3, prod_02: 0 });
    expect(cart[lineKey("prod_01", "")]).toEqual({ productId: "prod_01", qty: 3, note: "" });
    expect(cart[lineKey("prod_02", "")]).toBeUndefined();
  });

  it("parseStoredCart migrates packed { qty, note } maps", () => {
    const cart = parseStoredCart({ prod_01: { qty: 2, note: "özel" } });
    expect(cart[lineKey("prod_01", "özel")].qty).toBe(2);
  });

  it("setCartLineQty(0) removes the line", () => {
    const key = lineKey("prod_01", "x");
    const cart = setCartLineQty({ [key]: { productId: "prod_01", qty: 2, note: "x" } }, key, 0);
    expect(cart[key]).toBeUndefined();
  });

  it("normalizeNote trims and caps length", () => {
    expect(normalizeNote("  ab  ")).toBe("ab");
    expect(normalizeNote("x".repeat(600)).length).toBe(500);
  });

  it("hold / resume / view-only order rows", () => {
    let cart = addCartLine({}, "prod_01", 2, "kırmızı");
    cart = addCartLine(cart, "prod_02", 1, "");
    const held1 = holdActiveCart([], cart, { note: "acil", customerOrderNo: "PO-1" });
    expect(cartHasItems(held1.cart)).toBe(false);
    expect(held1.held).toHaveLength(1);
    expect(held1.held[0].label).toBe("Bekleyen sepet #1");

    let active = addCartLine({}, "prod_03", 5, "");
    const resumed = resumeHeldCart(held1.held, active, held1.held[0].id, { note: "x" });
    expect(resumed.cart[lineKey("prod_01", "kırmızı")].qty).toBe(2);
    expect(resumed.held).toHaveLength(1);
    expect(resumed.held[0].label).toBe("Bekleyen sepet #1");
    expect(resumed.meta.customerOrderNo).toBe("PO-1");

    const products = [
      { id: "prod_01", name: "A", price_gross: 10 },
      { id: "prod_02", name: "B", price_gross: 20 },
      { id: "prod_03", name: "C", price_gross: 5 },
    ];
    const rows = heldCartsAsOrders(held1.held, products, {
      activeCart: addCartLine({}, "prod_03", 1, ""),
      priceGross: (p) => Number(p.price_gross) || 0,
    });
    expect(rows[0].order_number).toBe("Aktif sepet");
    expect(rows[0].view_only).toBe(true);
    expect(rows[1].order_number).toBe("Bekleyen sepet #1");
    expect(rows[1].is_held_cart).toBe(true);
    expect(rows[1].items).toHaveLength(2);
  });

  it("mergePortalOrderLists puts server held carts into the list", () => {
    const products = [{ id: "prod_01", name: "A", price_gross: 10 }];
    const merged = mergePortalOrderLists({
      serverOrders: [
        { id: "bh1", order_number: "BH-1", order_status: "held_cart", held_seq: 1, is_held_cart: true, held_label: "Bekleyen sepet #1", items: [], grand_total: 10 },
        { id: "o1", order_number: "B2B-1", order_status: "pending", items: [], grand_total: 20 },
      ],
      heldLocal: [],
      products,
      activeCart: {},
      priceGross: (p) => Number(p.price_gross) || 0,
    });
    expect(merged[0].order_number).toBe("Bekleyen sepet #1");
    expect(merged[0].is_held_cart).toBe(true);
    expect(merged[1].order_number).toBe("B2B-1");
  });

  it("mergePortalOrderLists shows server active cart when local cart empty", () => {
    const merged = mergePortalOrderLists({
      serverOrders: [
        { id: "ba1", order_number: "BA-1", order_status: "active_cart", is_active_cart: true, held_label: "Aktif sepet", items: [], grand_total: 5 },
        { id: "o1", order_number: "B2B-1", order_status: "pending", items: [], grand_total: 20 },
      ],
      heldLocal: [],
      products: [],
      activeCart: {},
    });
    expect(merged[0].order_number).toBe("Aktif sepet");
    expect(merged[0].is_active_cart).toBe(true);
    expect(merged[1].order_number).toBe("B2B-1");
  });
});

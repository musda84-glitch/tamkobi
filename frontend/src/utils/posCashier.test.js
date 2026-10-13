import {
  actionIsFree,
  defaultPosRules,
  exitIsBlocked,
  mixedChange,
  normalizePin,
  pinIsValid,
  priceChangeNeedsApproval,
  refreshKeepsLock,
  restoreCartOnReject,
  sessionIsIdle,
  shouldBounceToPos,
} from "./posCashier";

const cashierRules = defaultPosRules("sales");
const adminRules = defaultPosRules("admin");

describe("PIN", () => {
  test("4-6 hane kabul", () => {
    expect(pinIsValid("1234")).toBe(true);
    expect(pinIsValid("123456")).toBe(true);
    expect(pinIsValid("12")).toBe(false);
    expect(pinIsValid("1234567")).toBe(false);
    expect(pinIsValid("12ab")).toBe(false);
    expect(normalizePin("12a34b56")).toBe("123456");
  });
});

describe("kasiyer fiyat değiştiremez", () => {
  test("satış rolü katalog fiyatını değiştiremez", () => {
    expect(priceChangeNeedsApproval(cashierRules, 100, 120)).toBe(true);
    expect(actionIsFree(cashierRules, "price_change", { catalog_price: 100, unit_price: 120 })).toBe(false);
  });
  test("yönetici fiyat değiştirebilir", () => {
    expect(priceChangeNeedsApproval(adminRules, 100, 120)).toBe(false);
    expect(actionIsFree(adminRules, "price_change", { catalog_price: 100, unit_price: 120 })).toBe(true);
  });
  test("limit içi iskonto serbest, üstü onay", () => {
    const r = { ...cashierRules, max_discount_pct: 10 };
    expect(priceChangeNeedsApproval(r, 100, 90)).toBe(false);
    expect(priceChangeNeedsApproval(r, 100, 80)).toBe(true);
  });
});

describe("onaysız iptal yok", () => {
  test("kasiyer sepet/satış iptal edemez", () => {
    expect(actionIsFree(cashierRules, "cancel_cart")).toBe(false);
    expect(actionIsFree(cashierRules, "cancel_sale")).toBe(false);
    expect(actionIsFree(cashierRules, "delete_line")).toBe(false);
  });
  test("can_cancel açılırsa serbest", () => {
    expect(actionIsFree({ ...cashierRules, can_cancel: true }, "cancel_cart")).toBe(true);
  });
});

describe("reddedilince sepet geri döner", () => {
  test("snapshot önceki satırları geri yükler", () => {
    const snap = { items: [{ id: "a", name: "Çay", unit_price: 10 }], customer_name: "Ali" };
    const current = { items: [], customerName: "X" };
    const restored = restoreCartOnReject(snap, current);
    expect(restored.items).toHaveLength(1);
    expect(restored.items[0].name).toBe("Çay");
    expect(restored.customerName).toBe("Ali");
  });
});

describe("yetkisiz çıkış ve yenileme atlatması", () => {
  const sess = {
    cashier_user_id: "u1",
    locked: false,
    exit_granted: false,
    rules: cashierRules,
    last_activity: new Date().toISOString(),
  };
  test("çıkış varsayılan kapalı", () => {
    expect(exitIsBlocked(sess)).toBe(true);
    expect(shouldBounceToPos(sess, "/settings")).toBe(true);
    expect(shouldBounceToPos(sess, "/hizli-satis")).toBe(false);
  });
  test("can_exit veya onay sonrası serbest", () => {
    expect(exitIsBlocked({ ...sess, rules: { can_exit: true } })).toBe(false);
    expect(exitIsBlocked({ ...sess, exit_granted: true })).toBe(false);
    expect(shouldBounceToPos({ ...sess, exit_granted: true }, "/settings")).toBe(false);
  });
  test("sayfa yenileme kilidi korur", () => {
    expect(refreshKeepsLock(sess)).toBe(true);
    expect(refreshKeepsLock({ ...sess, locked: true })).toBe(true);
    const idle = { ...sess, last_activity: new Date(Date.now() - 200000).toISOString() };
    expect(sessionIsIdle(idle, Date.now(), 120)).toBe(true);
    expect(refreshKeepsLock(idle, 120)).toBe(true);
    expect(refreshKeepsLock({ ...sess, ended_at: new Date().toISOString(), exit_granted: true })).toBe(false);
  });
});

describe("karma ödeme para üstü", () => {
  test("nakit+kart ve para üstü", () => {
    const r = mixedChange(100, 40, 60, 50);
    expect(r.cash).toBe(40);
    expect(r.card).toBe(60);
    expect(r.change).toBe(10);
  });
});

describe("veresiye ve iade kapısı", () => {
  test("kasiyer veresiye ve iade yapamaz", () => {
    expect(actionIsFree(cashierRules, "credit_sale")).toBe(false);
    expect(actionIsFree(cashierRules, "refund")).toBe(false);
    expect(actionIsFree(adminRules, "credit_sale")).toBe(true);
    expect(actionIsFree(adminRules, "refund")).toBe(true);
  });
});

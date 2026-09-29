import { b2bMobileCartBarCopy } from "./b2bMobileCartBar";

describe("b2bMobileCartBarCopy", () => {
  test("hides when cart and held are empty", () => {
    expect(b2bMobileCartBarCopy(0, 0).visible).toBe(false);
  });

  test("shows Sepet with qty badge when items present", () => {
    expect(b2bMobileCartBarCopy(6, 2)).toEqual({
      visible: true,
      badge: 6,
      title: "Sepet",
      action: "Siparişe geç →",
      actionTone: "go",
    });
  });

  test("shows held carts when active cart empty", () => {
    expect(b2bMobileCartBarCopy(0, 3)).toEqual({
      visible: true,
      badge: 3,
      title: "Bekleyen sepetler",
      action: "Görüntüle →",
      actionTone: "held",
    });
  });
});

import { resolveCheckoutClick } from "./checkoutArm";

describe("resolveCheckoutClick", () => {
  test("ignores when checkout not available", () => {
    expect(resolveCheckoutClick({ armed: false, canCheckout: false })).toBe("ignore");
    expect(resolveCheckoutClick({ armed: true, canCheckout: false })).toBe("ignore");
  });

  test("first click arms, second fires", () => {
    expect(resolveCheckoutClick({ armed: false, canCheckout: true })).toBe("arm");
    expect(resolveCheckoutClick({ armed: true, canCheckout: true })).toBe("fire");
  });
});

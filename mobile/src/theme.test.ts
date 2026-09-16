import { colors } from "./theme";

describe("theme matches web Tailwind tokens", () => {
  it("uses emerald-600 as the primary/accent brand color", () => {
    expect(colors.primary).toBe("#059669");
    expect(colors.primaryHover).toBe("#047857");
    expect(colors.accent).toBe("#059669");
  });

  it("uses slate canvas and indigo brand secondary", () => {
    expect(colors.ink).toBe("#020617");
    expect(colors.secondary).toBe("#0F172A");
    expect(colors.background).toBe("#F8FAFC");
    expect(colors.indigo).toBe("#4F46E5");
    expect(colors.danger).toBe("#E11D48");
  });
});

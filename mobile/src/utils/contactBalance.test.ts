import { contactBalanceBadge, formatTrBalanceAmount } from "./contactBalance";

describe("contactBalanceBadge", () => {
  it("formats Turkish kuruş and marks borç, alacak, zero", () => {
    expect(formatTrBalanceAmount(12450)).toBe("12.450,00");
    expect(contactBalanceBadge({ balance: -12450, currency: "TRY" })).toEqual({
      text: "12.450,00 ₺ B",
      side: "B",
      tone: "borc",
    });
    expect(contactBalanceBadge({ balance_display: 3200, balance_currency: "TRY" })).toEqual({
      text: "3.200,00 ₺ A",
      side: "A",
      tone: "alacak",
    });
    expect(contactBalanceBadge({ balance: 0 }).tone).toBe("zero");
    expect(contactBalanceBadge({ balance: 0 }).text).toBe("0,00 ₺");
  });

  it("uses the search row currency for fx contacts", () => {
    expect(contactBalanceBadge({ balance_display: 100, balance_currency: "USD" }).text).toBe("100,00 USD A");
  });
});

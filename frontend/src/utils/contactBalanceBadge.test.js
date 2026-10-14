import { contactBalanceBadge, formatTrBalanceAmount } from "./contactBalanceBadge";

test("turkish balance amounts use dot thousands and comma kuruş", () => {
  expect(formatTrBalanceAmount(12450)).toBe("12.450,00");
  expect(formatTrBalanceAmount(-3200)).toBe("3.200,00");
  expect(formatTrBalanceAmount(0)).toBe("0,00");
});

test("borç is red B, alacak is green A, zero is gray without a letter", () => {
  const debt = contactBalanceBadge({ balance: -12450, currency: "TRY" });
  expect(debt).toEqual({ text: "12.450,00 ₺ B", side: "B", tone: "borc" });
  const credit = contactBalanceBadge({ balance_display: 3200, balance_currency: "TRY" });
  expect(credit).toEqual({ text: "3.200,00 ₺ A", side: "A", tone: "alacak" });
  const zero = contactBalanceBadge({ balance: 0, currency: "TRY" });
  expect(zero).toEqual({ text: "0,00 ₺", side: "", tone: "zero" });
});

test("fx contacts use the currency that came with the search row", () => {
  expect(contactBalanceBadge({ balance_display: 100, balance_currency: "USD" })).toEqual({
    text: "100,00 USD A",
    side: "A",
    tone: "alacak",
  });
  expect(contactBalanceBadge({ balance_display: -15.5, balance_currency: "EUR" }).text).toBe("15,50 EUR B");
});

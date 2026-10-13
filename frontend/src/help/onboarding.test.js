import { ONBOARDING_STEPS, firstRemainingIndex, invoiceLineTotals, progressLabel, shouldShowWizard } from "./onboarding";

test("wizard steps cover the six setup items", () => {
  expect(ONBOARDING_STEPS.map((s) => s.key)).toEqual([
    "company", "logo", "einvoice", "contact", "product", "invoice",
  ]);
});

test("first remaining and progress copy", () => {
  expect(firstRemainingIndex({ remaining: ["contact", "product"] })).toBe(3);
  expect(progressLabel(50)).toBe("%50 tamamlandı");
});

test("invoice line totals include VAT", () => {
  const t = invoiceLineTotals({ quantity: 2, unit_price: 100, vat_rate: 20 });
  expect(t.total).toBe(200);
  expect(t.vat_amount).toBe(40);
  expect(t.total_incl).toBe(240);
});

test("wizard hidden on public and platform paths", () => {
  const status = { show_wizard: true };
  expect(shouldShowWizard(status, { authenticated: true, pathname: "/panel" })).toBe(true);
  expect(shouldShowWizard(status, { authenticated: true, pathname: "/sistem/yardim" })).toBe(false);
  expect(shouldShowWizard(status, { authenticated: false, pathname: "/panel" })).toBe(false);
  expect(shouldShowWizard({ show_wizard: false }, { authenticated: true, pathname: "/panel" })).toBe(false);
});

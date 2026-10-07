import { isLockedContactPay, isPartnerContactPay, lockedContactPayTitle } from "./contactPayLock";

test("partner contact pay is editable (not locked)", () => {
  const p = { source: "partner", account_name: "Ortaklar Hesabı", amount: 511304 };
  expect(isPartnerContactPay(p)).toBe(true);
  expect(isLockedContactPay(p)).toBe(false);
});

test("bank_sync and cheque stay locked", () => {
  expect(isLockedContactPay({ source: "bank_sync" })).toBe(true);
  expect(isLockedContactPay({ source: "cheque", virtual: true })).toBe(true);
  expect(lockedContactPayTitle({ source: "bank_sync" })).toMatch(/Banka entegrasyon/);
});

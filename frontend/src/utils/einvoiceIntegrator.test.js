import {
  einvoiceProviderLabel,
  isEinvoiceConfigured,
  supportsGibInbox,
  supportsEDispatch,
} from "./einvoiceIntegrator";

test("provider labels", () => {
  expect(einvoiceProviderLabel("isnet")).toBe("İşNet SOAP");
  expect(einvoiceProviderLabel("isnet_portal")).toBe("İşNet Portal");
  expect(einvoiceProviderLabel("")).toMatch(/yok/i);
});

test("configured check", () => {
  expect(isEinvoiceConfigured({ provider: "isnet", status: "configured" })).toBe(true);
  expect(isEinvoiceConfigured({ provider: "isnet", status: "draft" })).toBe(false);
  expect(isEinvoiceConfigured({ provider: "simulated", status: "configured" })).toBe(false);
});

test("inbox and e-dispatch support", () => {
  expect(supportsGibInbox({ provider: "isnet", status: "configured" })).toBe(true);
  expect(supportsGibInbox({ provider: "n11faturam", status: "configured" })).toBe(true);
  expect(supportsEDispatch({ provider: "isnet", status: "configured" })).toBe(true);
  expect(supportsEDispatch({ provider: "isnet", status: "configured", e_dispatch_enabled: false })).toBe(false);
  expect(supportsEDispatch({ provider: "n11faturam", status: "configured" })).toBe(false);
});

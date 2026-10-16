import {
  einvoiceProviderLabel,
  isEinvoiceConfigured,
  shouldShowEinvoiceUnconfiguredWarning,
  supportsGibInbox,
  supportsEDispatch,
} from "./einvoiceIntegrator";

test("provider labels", () => {
  expect(einvoiceProviderLabel("isnet")).toBe("İşNet SOAP");
  expect(einvoiceProviderLabel("isnet_portal")).toBe("İşNet Portal");
  expect(einvoiceProviderLabel("qnb_efinans")).toBe("QNB eFinans");
  expect(einvoiceProviderLabel("")).toMatch(/yok/i);
});

test("configured check", () => {
  expect(isEinvoiceConfigured({ provider: "isnet", status: "configured" })).toBe(true);
  expect(isEinvoiceConfigured({ provider: "isnet", status: "draft" })).toBe(false);
  expect(isEinvoiceConfigured({ provider: "simulated", status: "configured" })).toBe(false);
});

test("unconfigured warning waits until integrator status is known", () => {
  const connected = { provider: "isnet", status: "configured" };
  expect(shouldShowEinvoiceUnconfiguredWarning({ loading: true, settings: null })).toBe(false);
  expect(shouldShowEinvoiceUnconfiguredWarning({ loading: true, settings: connected })).toBe(false);
  expect(shouldShowEinvoiceUnconfiguredWarning({ loading: false, settings: connected })).toBe(false);
  expect(shouldShowEinvoiceUnconfiguredWarning({ loading: false, settings: null })).toBe(true);
  expect(shouldShowEinvoiceUnconfiguredWarning({ loading: false, settings: { provider: "isnet", status: "draft" } })).toBe(true);
  expect(shouldShowEinvoiceUnconfiguredWarning({ loading: false, settings: { provider: "simulated", status: "configured" } })).toBe(true);
});

test("inbox and e-dispatch support", () => {
  expect(supportsGibInbox({ provider: "isnet", status: "configured" })).toBe(true);
  expect(supportsGibInbox({ provider: "n11faturam", status: "configured" })).toBe(true);
  expect(supportsEDispatch({ provider: "isnet", status: "configured" })).toBe(true);
  expect(supportsEDispatch({ provider: "isnet", status: "configured", e_dispatch_enabled: false })).toBe(false);
  expect(supportsEDispatch({ provider: "n11faturam", status: "configured" })).toBe(false);
  expect(supportsGibInbox({ provider: "qnb_efinans", status: "configured" })).toBe(false);
  expect(supportsEDispatch({ provider: "qnb_efinans", status: "configured" })).toBe(false);
});

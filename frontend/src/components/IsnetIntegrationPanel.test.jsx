import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import IsnetIntegrationPanel from "./IsnetIntegrationPanel";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...rest }) => React.createElement("a", { href: typeof to === "string" ? to : "/", ...rest }, children),
  };
}, { virtual: true });

const SETTINGS = {
  username: "apiuser",
  alias: "urn:mail:pk@firma.com",
  company_tax_id: "6131659091",
  corporate_code: "C1",
  company_vendor_number: "05",
  mode: "live",
  status: "configured",
  has_password: true,
  e_dispatch_enabled: true,
  despatch_defaults: { plate: "61AEI119" },
};

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockResolvedValue({ data: SETTINGS });
  axios.post.mockResolvedValue({ data: { ...SETTINGS, status: "configured", has_password: true } });
});

afterEach(() => {
  host.remove();
});

async function renderPanel(props) {
  const root = createRoot(host);
  await act(async () => {
    root.render(<IsnetIntegrationPanel companyId="comp_1" {...props} />);
  });
  await act(async () => { await Promise.resolve(); });
  return root;
}

test("company variant keeps VKN, GIB alias and portal credentials only", async () => {
  await renderPanel({ variant: "company" });
  const panel = host.querySelector('[data-testid="isnet-integration-panel"]');
  expect(panel?.getAttribute("data-variant")).toBe("company");
  expect(host.querySelector('[data-testid="isnet-company-tax-id"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-gib-alias"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-username"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-password"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-mode-test"]')).toBeNull();
  expect(host.querySelector('[data-testid="isnet-soap-endpoints"]')).toBeNull();
  expect(host.querySelector('[data-testid="isnet-despatch-section"]')).toBeNull();
  expect(host.querySelector('[data-testid="isnet-client-code"]')).toBeNull();
  expect(host.querySelector('[data-testid="isnet-test-btn"]')).toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="isnet-save-btn"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  const call = axios.post.mock.calls.find((c) => String(c[0]).includes("/integrations/isnet/save"));
  expect(call).toBeTruthy();
  expect(call[1]).toMatchObject({
    company_id: "comp_1",
    company_tax_id: "6131659091",
    gib_alias: "urn:mail:pk@firma.com",
    username: "apiuser",
  });
  expect(call[1].test_mode).toBeUndefined();
  expect(call[1].despatch_defaults).toBeUndefined();
  expect(call[1].company_vendor_number).toBeUndefined();
});

test("system variant shows SOAP, vendor and despatch; omits company identity fields", async () => {
  await renderPanel({ variant: "system" });
  expect(host.querySelector('[data-testid="isnet-integration-panel"]')?.getAttribute("data-variant")).toBe("system");
  expect(host.querySelector('[data-testid="isnet-mode-live"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-soap-endpoints"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-despatch-section"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-client-code"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-company-vendor-number"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-test-btn"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="isnet-company-tax-id"]')).toBeNull();
  expect(host.querySelector('[data-testid="isnet-gib-alias"]')).toBeNull();
  expect(host.querySelector('[data-testid="isnet-username"]')).toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="isnet-save-btn"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  const call = axios.post.mock.calls.find((c) => String(c[0]).includes("/integrations/isnet/save"));
  expect(call[1]).toMatchObject({
    company_id: "comp_1",
    test_mode: false,
    company_vendor_number: "05",
    e_dispatch_enabled: true,
  });
  expect(call[1].company_tax_id).toBeUndefined();
  expect(call[1].gib_alias).toBeUndefined();
});

/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import axios from "axios";
import { InvoiceGibBar } from "../components/InvoiceGibBar";
import { useEinvoiceIntegrator } from "./useEinvoiceIntegrator";

jest.mock("axios");
jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test/api",
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CONNECTED = { provider: "isnet", status: "configured", mode: "live" };
const DISCONNECTED = { provider: "isnet", status: "draft", mode: "test" };

function Harness({ companyId }) {
  const { settings, loading } = useEinvoiceIntegrator(companyId);
  return (
    <InvoiceGibBar
      settings={settings}
      loading={loading}
      onPullIncoming={() => {}}
      onRefreshOutgoing={() => {}}
      onFilterDispatch={() => {}}
    />
  );
}

function mount(companyId = "co1") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter>
        <Harness companyId={companyId} />
      </MemoryRouter>,
    );
  });
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function warning(host) {
  return host.querySelector('[data-testid="invoice-gib-bar-unconfigured"]');
}

beforeEach(() => {
  axios.get.mockReset();
});

test("yükleniyor: entegratör uyarısı yok", async () => {
  let resolveGet;
  axios.get.mockImplementation(() => new Promise((resolve) => { resolveGet = resolve; }));
  const view = mount("co1");
  expect(axios.get).toHaveBeenCalledWith(
    "http://test/api/einvoice/settings",
    expect.objectContaining({ params: { company_id: "co1" } }),
  );
  expect(warning(view.host)).toBeNull();
  expect(view.host.textContent || "").not.toMatch(/bağlı değil/);
  expect(view.host.querySelector('[data-testid="invoice-gib-bar"]')).toBeNull();

  await act(async () => { resolveGet({ data: CONNECTED }); });
  expect(warning(view.host)).toBeNull();
  view.cleanup();
});

test("bağlı: entegratör uyarısı yok", async () => {
  axios.get.mockResolvedValue({ data: CONNECTED });
  const view = mount("co1");
  await act(async () => {});
  expect(warning(view.host)).toBeNull();
  expect(view.host.textContent || "").not.toMatch(/bağlı değil/);
  expect(view.host.querySelector('[data-testid="invoice-gib-bar"]')).not.toBeNull();
  expect(view.host.querySelector('[data-testid="invoice-gib-bar-provider"]').textContent).toMatch(/İşNet/);
  view.cleanup();
});

test("bağlı değil: entegratör uyarısı var", async () => {
  axios.get.mockResolvedValue({ data: DISCONNECTED });
  const view = mount("co1");
  await act(async () => {});
  const node = warning(view.host);
  expect(node).not.toBeNull();
  expect(node.textContent).toMatch(/GİB entegratörü bağlı değil/);
  expect(node.textContent).toMatch(/Ayarlar/);
  expect(node.textContent).toMatch(/e-Fatura/);
  expect(view.host.querySelector('[data-testid="invoice-gib-bar"]')).toBeNull();
  view.cleanup();
});

test("firma henüz yokken istek atılmaz ve uyarı çıkmaz", () => {
  const view = mount("");
  expect(axios.get).not.toHaveBeenCalled();
  expect(warning(view.host)).toBeNull();
  view.cleanup();
});

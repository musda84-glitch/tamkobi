/**
 * @jest-environment jsdom
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { ProductMappingPanel } from "./ProductMappingPanel";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COMPANY = "comp-map-1";

function isIntegrationList(url) {
  return String(url).split("?")[0].endsWith("/integrations/ecommerce");
}

function routeGet(handlers) {
  axios.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("/integrations/ecommerce/mappings")) {
      return Promise.resolve({ data: handlers.maps || [] });
    }
    if (path.includes("/integrations/ecommerce/unmapped")) {
      return Promise.resolve({ data: handlers.unmapped || [] });
    }
    if (path.includes("/products")) {
      return Promise.resolve({ data: handlers.products || [] });
    }
    if (isIntegrationList(path)) {
      return Promise.resolve({ data: handlers.integrations || [] });
    }
    return Promise.resolve({ data: [] });
  });
}

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.post.mockReset();
  axios.delete.mockReset();
  axios.post.mockResolvedValue({ data: { id: "map-1" } });
  axios.delete.mockResolvedValue({ data: { status: "success" } });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderPanel(ui) {
  root = createRoot(host);
  await act(async () => {
    root.render(ui);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function optionValues() {
  return [...host.querySelectorAll('[data-testid="map-channel-select"] option')].map((node) => node.value);
}

test("pasif ve is_active alanı olmayan ekli kanallar seçilir", async () => {
  routeGet({
    integrations: [
      { channel: "trendyol", channel_name: "Trendyol", is_active: false },
      { channel: "n11", channel_name: "n11" },
    ],
  });
  await renderPanel(<ProductMappingPanel companyId={COMPANY} />);
  expect(optionValues()).toEqual(["trendyol", "n11"]);
  expect(host.querySelector('[data-testid="map-channel-empty-hint"]')).toBeNull();
  expect(host.querySelector('[data-testid="map-save-btn"]').disabled).toBe(false);
});

test("ekli pazaryeri yokken ipucu görünür ve eşleştir kapalıdır", async () => {
  routeGet({ integrations: [] });
  await renderPanel(<ProductMappingPanel companyId={COMPANY} />);
  const select = host.querySelector('[data-testid="map-channel-select"]');
  expect(select.options).toHaveLength(1);
  expect(select.options[0].textContent).toBe("Ekli pazaryeri yok");
  expect(select.value).toBe("");
  expect(host.querySelector('[data-testid="map-channel-empty-hint"]').textContent).toBe(
    "E-Ticaret → Kanal Ekle ile pazaryeri bağlayın.",
  );
  expect(host.querySelector('[data-testid="map-save-btn"]').disabled).toBe(true);
});

test("eşleşmemiş ürün düğmesi listedeki kanalı seçer ve kaydeder", async () => {
  routeGet({
    integrations: [
      { channel: "trendyol", channel_name: "Trendyol", is_active: false },
    ],
    unmapped: [
      { channel: "hepsiburada", marketplace_sku: "HB-9", product_name: "Bardak" },
    ],
    maps: [
      { id: "map-amz", channel: "amazon", marketplace_sku: "AMZ-1", product_name: "Kupa", sku: "SKU1" },
    ],
  });
  await renderPanel(<ProductMappingPanel companyId={COMPANY} />);
  expect(optionValues()).toEqual(["trendyol", "hepsiburada", "amazon"]);
  expect(host.querySelector('[data-testid="map-channel-select"]').value).toBe("trendyol");

  await act(async () => {
    host.querySelector('[data-testid="unmapped-0"]').click();
  });
  expect(host.querySelector('[data-testid="map-channel-select"]').value).toBe("hepsiburada");

  await act(async () => {
    host.querySelector('[data-testid="map-save-btn"]').click();
  });
  expect(axios.post).toHaveBeenCalledWith(
    "/api/integrations/ecommerce/mappings",
    expect.objectContaining({ company_id: COMPANY, channel: "hepsiburada" }),
  );
});

test("büyük harfli eşleşmemiş kanal seçilir, manual satır liste dışı kanala yazılmaz", async () => {
  routeGet({
    integrations: [
      { channel: "trendyol", channel_name: "Trendyol", is_active: false },
    ],
    unmapped: [
      { channel: "manual", marketplace_sku: "M-1", product_name: "Elle" },
      { channel: "Hepsiburada", marketplace_sku: "HB-2", product_name: "Kupa" },
    ],
  });
  await renderPanel(<ProductMappingPanel companyId={COMPANY} />);
  const select = host.querySelector('[data-testid="map-channel-select"]');
  expect(select.value).toBe("trendyol");

  const buttons = [...host.querySelectorAll('button[data-testid^="unmapped-"]')];
  const manualBtn = buttons.find((node) => node.textContent.includes("M-1"));
  if (manualBtn) {
    await act(async () => { manualBtn.click(); });
    const shown = host.querySelector('[data-testid="map-channel-select"]').value;
    expect(optionValues()).toContain(shown);
    await act(async () => {
      host.querySelector('[data-testid="map-save-btn"]').click();
    });
    expect(axios.post.mock.calls.at(-1)[1].channel).toBe(shown);
  } else {
    expect(host.textContent).not.toContain("M-1");
  }

  const hb = [...host.querySelectorAll('button[data-testid^="unmapped-"]')].find((node) => node.textContent.includes("HB-2"));
  expect(hb).toBeTruthy();
  await act(async () => { hb.click(); });
  expect(host.querySelector('[data-testid="map-channel-select"]').value).toBe("hepsiburada");

  await act(async () => {
    host.querySelector('[data-testid="map-save-btn"]').click();
  });
  const posted = axios.post.mock.calls.at(-1)[1];
  expect(posted.company_id).toBe(COMPANY);
  expect(posted.channel).toBe("hepsiburada");
  expect(posted.channel).toBe(host.querySelector('[data-testid="map-channel-select"]').value);
});

test("prop ile verilen entegrasyonlar değişince seçenekler güncellenir", async () => {
  routeGet({
    integrations: [{ channel: "amazon", channel_name: "Amazon", is_active: true }],
  });
  const Harness = () => {
    const [integrations, setIntegrations] = useState([
      { channel: "trendyol", channel_name: "Trendyol", is_active: false },
    ]);
    return (
      <>
        <button
          type="button"
          data-testid="probe-add-n11"
          onClick={() => setIntegrations([
            { channel: "trendyol", channel_name: "Trendyol", is_active: false },
            { channel: "n11", channel_name: "n11", is_active: false },
          ])}
        >
          n11 ekle
        </button>
        <ProductMappingPanel companyId={COMPANY} integrations={integrations} />
      </>
    );
  };
  await renderPanel(<Harness />);
  expect(optionValues()).toEqual(["trendyol"]);
  expect(axios.get.mock.calls.map((call) => call[0]).some(isIntegrationList)).toBe(false);

  await act(async () => {
    host.querySelector('[data-testid="probe-add-n11"]').click();
  });
  expect(optionValues()).toEqual(["trendyol", "n11"]);
  expect(axios.get.mock.calls.map((call) => call[0]).some(isIntegrationList)).toBe(false);
});

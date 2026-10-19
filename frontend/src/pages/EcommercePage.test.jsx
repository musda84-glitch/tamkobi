/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import EcommercePage from "./EcommercePage";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "comp-map-1" } }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COMPANY = "comp-map-1";

function isIntegrationList(url) {
  return String(url).split("?")[0].endsWith("/integrations/ecommerce");
}

let integrationResponses;

function routeGet(url) {
  const path = String(url);
  if (path.includes("/integrations/ecommerce/catalog")) {
    return Promise.resolve({
      data: {
        groups: [{
          group: "Pazaryerleri",
          channels: [{ code: "n11", name: "n11", added: false, live_api: null }],
        }],
      },
    });
  }
  if (path.includes("/integrations/ecommerce/mappings")) return Promise.resolve({ data: [] });
  if (path.includes("/integrations/ecommerce/unmapped")) return Promise.resolve({ data: [] });
  if (path.includes("/products")) return Promise.resolve({ data: [] });
  if (path.includes("/banking/accounts")) return Promise.resolve({ data: [] });
  if (isIntegrationList(path)) {
    const data = integrationResponses.shift() || [];
    return Promise.resolve({ data });
  }
  return Promise.resolve({ data: [] });
}

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  integrationResponses = [[]];
  axios.get.mockImplementation(routeGet);
  axios.post.mockResolvedValue({ data: { message: "n11 kanalı eklendi." } });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function optionValues() {
  return [...host.querySelectorAll('[data-testid="map-channel-select"] option')].map((node) => node.value);
}

test("kanal eklendikten sonra panelde yeni kanal seçeneği görünür", async () => {
  root = createRoot(host);
  await act(async () => {
    root.render(<EcommercePage />);
  });
  await flush();

  expect(host.querySelector('[data-testid="map-channel-empty-hint"]')).toBeTruthy();
  expect(optionValues()).toEqual([""]);
  const listUrls = axios.get.mock.calls.map((call) => call[0]).filter(isIntegrationList);
  expect(listUrls.every((url) => String(url).includes(`company_id=${COMPANY}`))).toBe(true);

  await act(async () => {
    host.querySelector('[data-testid="add-channel-btn"]').click();
  });
  await flush();

  integrationResponses.push([
    { id: "ecom_n11", channel: "n11", channel_name: "n11", is_active: false },
  ]);
  await act(async () => {
    host.querySelector('[data-testid="channel-add-n11"]').click();
  });
  await flush();
  await flush();

  expect(optionValues()).toEqual(["n11"]);
  expect(host.querySelector('[data-testid="map-channel-empty-hint"]')).toBeNull();
  expect(host.querySelector('[data-testid="map-save-btn"]').disabled).toBe(false);
  expect(axios.post).toHaveBeenCalledWith(
    "/api/integrations/ecommerce/add-channel",
    { company_id: COMPANY, channel: "n11" },
  );
});

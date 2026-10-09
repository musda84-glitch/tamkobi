/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { CreateShipmentModal } from "./CreateShipmentModal";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: { message: "ok" } })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/useEscape", () => ({ useEscape: () => {} }));
jest.mock("../utils/modalBackdrop", () => ({ backdropDismissProps: () => ({}) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.post.mockReset();
  axios.get.mockImplementation(async (url) => {
    if (String(url).includes("/integrations/cargo")) {
      return {
        data: [
          { carrier_code: "geliver", carrier_name: "Geliver (Kargo Pazaryeri)", status: "connected", is_active: true },
          { carrier_code: "yurtici", carrier_name: "Yurtiçi Kargo", status: "disconnected", is_active: false },
        ],
      };
    }
    return { data: {} };
  });
  axios.post.mockResolvedValue({ data: { message: "ok", tracking_number: "YK-1" } });
});

afterEach(() => {
  host.remove();
});

const order = {
  id: "ord_1",
  order_number: "S-100",
  customer_name: "Ali Veli",
  city: "İstanbul",
  shipping_address: "Kadıköy",
  customer_phone: "05321112233",
  items: [],
};

const renderModal = async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<CreateShipmentModal order={order} companyId="c1" onClose={() => {}} onDone={() => {}} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return root;
};

test("Geliver seçilince satın almasız teklif modülü görünür", async () => {
  await renderModal();
  expect(host.querySelector("[data-testid='ship-carrier-geliver']")).not.toBeNull();
  const picker = host.querySelector("[data-testid='geliver-offer-picker']");
  expect(picker).not.toBeNull();
  expect(picker.textContent).toMatch(/Teklifleri getir/);
  expect(picker.textContent).toMatch(/Satın almadan/);
  expect(host.querySelector("[data-testid='create-shipment-submit']")?.textContent).toMatch(/Teklifleri getir/);
});

test("Teklifleri getir satın almaz; listeden seçince offer_id gönderir", async () => {
  axios.post.mockImplementation(async (_url, body) => {
    if (body?.quote_only) {
      return {
        data: {
          quote_only: true,
          geliver_id: "shp_q",
          message: "2 kargo teklifi hazır",
          percentage_completed: 100,
          offers: [
            { id: "off_a", service: "MNG_STANDART", amount: "20", amount_num: 20, currency: "TRY", is_cheapest: true, is_fastest: false, eta: "2 gün" },
            { id: "off_b", service: "YK_NEXTDAY", amount: "35", amount_num: 35, currency: "TRY", is_cheapest: false, is_fastest: true, eta: "1 gün" },
          ],
        },
      };
    }
    return { data: { message: "teklif kabul edildi", tracking_number: "YK999" } };
  });

  await renderModal();
  await act(async () => {
    host.querySelector("[data-testid='geliver-quotes-fetch']").click();
    await Promise.resolve();
    await Promise.resolve();
  });

  const quoteCall = axios.post.mock.calls.find((c) => c[1]?.quote_only === true);
  expect(quoteCall).toBeTruthy();
  expect(quoteCall[1].accept_offer).toBe(false);
  expect(quoteCall[1].offer_id).toBeUndefined();

  expect(host.querySelector("[data-testid='geliver-offer-off_a']")).not.toBeNull();
  expect(host.querySelector("[data-testid='geliver-offer-off_b']")?.textContent).toMatch(/YK NEXTDAY|YK Next Day|YK_NEXTDAY|YK Nextday/i);
  expect(host.querySelector("[data-testid='create-shipment-submit']")?.textContent).toMatch(/Satın al/);

  await act(async () => {
    host.querySelector("[data-testid='geliver-offer-off_b']").click();
  });
  await act(async () => {
    host.querySelector("[data-testid='create-shipment-submit']").click();
    await Promise.resolve();
    await Promise.resolve();
  });

  const buy = axios.post.mock.calls.find((c) => c[1]?.offer_id);
  expect(buy).toBeTruthy();
  expect(buy[1].offer_id).toBe("off_b");
  expect(buy[1].geliver_id).toBe("shp_q");
  expect(buy[1].quote_only).toBeUndefined();
});

test("Yurtiçi seçilince teklif modülü kapanır ve doğrudan kargolar", async () => {
  await renderModal();
  await act(async () => {
    host.querySelector("[data-testid='ship-carrier-yurtici']").click();
  });
  expect(host.querySelector("[data-testid='geliver-offer-picker']")).toBeNull();
  expect(host.querySelector("[data-testid='create-shipment-submit']")?.textContent).toMatch(/Kargola/);

  await act(async () => {
    host.querySelector("[data-testid='create-shipment-submit']").click();
    await Promise.resolve();
    await Promise.resolve();
  });
  const body = axios.post.mock.calls.map((c) => c[1]).find((b) => b?.carrier_code === "yurtici");
  expect(body).toBeTruthy();
  expect(body.quote_only).toBeUndefined();
  expect(body.offer_id).toBeUndefined();
});

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { DashboardShopFloorPerf } from "./DashboardShopFloorPerf";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = { get: jest.fn(() => Promise.resolve({ data: {} })) };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

const perf = {
  total_done: 3,
  operators: [{ name: "Ali", done: 2, produced: 5, scrap_rate: 1, avg_min: 6, over_target: 0 }],
  stations: [{ name: "CNC", done: 2, produced: 5, scrap_rate: 0, avg_min: 6, over_target: 1 }],
};

function renderPerf() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<DashboardShopFloorPerf companyId="c1" />);
  });
  return {
    host,
    async clickToggle() {
      await act(async () => {
        host.querySelector('[data-testid="dashboard-shopfloor-perf-toggle"]').click();
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    cleanup() {
      act(() => { root.unmount(); });
      host.remove();
    },
  };
}

beforeEach(() => {
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: perf });
});

test("starts closed and does not request performance", () => {
  const view = renderPerf();
  expect(axios.get).not.toHaveBeenCalled();
  expect(view.host.querySelector('[data-testid="dashboard-shopfloor-perf"]')).not.toBeNull();
  expect(view.host.querySelector('[data-testid="dashboard-shopfloor-perf-toggle"]').textContent).toContain("Göster");
  expect(view.host.querySelector('[data-testid="dashboard-shopfloor-perf-toggle"]').textContent).toContain("0 adım tamamlandı");
  expect(view.host.querySelector("table")).toBeNull();
  view.cleanup();
});

test("loads the performance table once when opened", async () => {
  const view = renderPerf();
  await view.clickToggle();
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(String(axios.get.mock.calls[0][0])).toBe("/api/production/work-orders/performance?company_id=c1");
  expect(view.host.textContent).toContain("Ali");
  expect(view.host.textContent).toContain("CNC");
  const table = view.host.querySelector("table");
  expect(table).not.toBeNull();
  expect(table.parentElement.className).toContain("overflow-x-auto");
  expect(table.parentElement.className).toContain("max-w-full");
  expect(table.className).toContain("w-full");
  expect(view.host.textContent).toContain("Operatörler");
  expect(view.host.textContent).toContain("İstasyonlar");
  expect(view.host.textContent).toContain("3 adım tamamlandı");
  expect(view.host.querySelector('[data-testid="dashboard-shopfloor-perf-toggle"]').textContent).toContain("Gizle");
  await view.clickToggle();
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(view.host.querySelector("table")).toBeNull();
  await view.clickToggle();
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(view.host.textContent).toContain("Ali");
  view.cleanup();
});

test("hides the row when the performance request fails", async () => {
  axios.get.mockRejectedValue(new Error("down"));
  const view = renderPerf();
  await view.clickToggle();
  expect(view.host.querySelector('[data-testid="dashboard-shopfloor-perf"]')).toBeNull();
  expect(view.host.querySelector('[data-testid="dashboard-shopfloor-perf-toggle"]')).toBeNull();
  view.cleanup();
});

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { OrdersToolbar } from "./OrdersToolbar";
import { ORDER_FILTER_DEFAULTS } from "../utils/orderFilters";

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

test("iptal talepleri chip shows count and toggles pending filter", async () => {
  const setF = jest.fn();
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <OrdersToolbar
        f={{ ...ORDER_FILTER_DEFAULTS }}
        setF={setF}
        orders={[]}
        count={0}
        total={0}
        statusCounts={{ cancel_request: 3 }}
      />,
    );
  });
  const chip = host.querySelector('[data-testid="ord-cancel-request-chip"]');
  expect(chip).not.toBeNull();
  expect(chip.textContent).toContain("İptal talepleri (3)");
  await act(async () => {
    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(setF).toHaveBeenCalled();
});

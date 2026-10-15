import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { OrderCancelRequestDialog, OrderCancelRequestBadge } from "./OrderCancelRequestDialog";
import { BulkResultModal } from "./BulkResultModal";
import { toast } from "sonner";
import { resolveCancelRequestError } from "../utils/orderCancelRequest";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  toast.error.mockClear();
});

afterEach(() => {
  host.remove();
});

test("accept dialog shows trash confirm text", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <OrderCancelRequestDialog
        action="accept"
        order={{ id: "1", order_number: "B2B-1" }}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
  });
  expect(host.querySelector('[data-testid="cancel-request-dialog"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="cancel-request-accept-text"]')?.textContent)
    .toContain("Sipariş ve bağlı taslak fatura çöp kutusuna taşınacak.");
});

test("reject dialog has optional note", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <OrderCancelRequestDialog
        action="reject"
        order={{ id: "1", order_number: "B2B-1" }}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
  });
  expect(host.querySelector('[data-testid="cancel-request-reject-note"]')).not.toBeNull();
});

test("pending badge shows tooltip reason", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <OrderCancelRequestBadge
        ord={{ order_number: "B2B-9", cancel_request: { status: "pending", reason: "yanlış sipariş" } }}
      />,
    );
  });
  const badge = host.querySelector('[data-testid="cancel-request-badge-B2B-9"]');
  expect(badge).not.toBeNull();
  expect(badge.textContent).toContain("İptal talebi");
  expect(badge.getAttribute("title")).toContain("yanlış sipariş");
});

test("error toast keeps 409 detail and BulkResultModal lists row results", async () => {
  const detail = "Fatura faturalaştırılmış veya e-belge kesilmiş; önce Faturalar'dan faturayı İptal Et, sonra talebi onaylayın.";
  toast.error(resolveCancelRequestError({ response: { status: 409, data: { detail } } }));
  expect(toast.error).toHaveBeenCalledWith(detail);

  const root = createRoot(host);
  await act(async () => {
    root.render(
      <BulkResultModal
        title="İptal talebi sonucu"
        items={[
          { id: "1", label: "B2B-1", outcome: "ok" },
          { id: "2", label: "B2B-2", outcome: "error", reason: detail },
        ]}
        onClose={() => {}}
      />,
    );
  });
  expect(host.textContent).toContain("B2B-2");
  expect(host.textContent).toContain(detail);
  expect(host.textContent).toContain("B2B-1");
});

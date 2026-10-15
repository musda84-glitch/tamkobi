/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { DespatchSendDialog } from "./DespatchSendDialog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc.set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

test("eksik plaka gönderilmez ve Türkçe hata gösterilir", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSubmit = jest.fn();
  await act(async () => {
    root.render(
      <DespatchSendDialog
        invoice={{
          invoice_number: "IRS-2026-0007",
          invoice_type: "dispatch",
          einvoice_state: "error",
          gib_status: "Hata: şema",
          issue_date: "2026-10-15",
          issue_time: "10:30",
          shipping_address: "Teslim adresi",
          despatch_plate: "34ABC123",
          despatch_driver_first: "Ali",
          despatch_driver_last: "Yılmaz",
          despatch_driver_tckn: "10000000146",
        }}
        defaults={{}}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
  });
  const plate = host.querySelector('[data-testid="despatch-plate"]');
  await act(async () => { setNativeValue(plate, "ABC"); });
  await act(async () => {
    host.querySelector('[data-testid="despatch-send-submit"]').click();
  });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="despatch-form-error"]').textContent).toMatch(/plaka/i);
  expect(host.textContent).toMatch(/Düzelt ve tekrar gönder/);
  await act(async () => { root.unmount(); });
  host.remove();
});

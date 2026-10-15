import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { BulkInvoiceLinkConfirmModal } from "./BulkInvoiceLinkConfirmModal";
import {
  classifyInvoiceLinkRecipients,
  invoiceShareLinkParams,
  sendInvoiceShareLink,
  INVOICE_LINK_TTL_HOURS,
} from "../utils/invoiceBulkActions";

jest.mock("axios");

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.post.mockReset();
});

afterEach(() => {
  host.remove();
});

test("link confirm modal lists recipients and skipped; axios.post is not called without confirm", async () => {
  const invoices = [
    { id: "i1", invoice_number: "A-1", contact_id: "c1", contact_name: "Ali" },
    { id: "i2", invoice_number: "A-2", contact_id: "c2", contact_name: "Veli" },
  ];
  const contacts = [
    { id: "c1", email: "ali@ornek.com" },
    { id: "c2" },
  ];
  const { ready, skipped, total } = classifyInvoiceLinkRecipients(invoices, contacts);
  expect(ready).toHaveLength(1);
  expect(ready[0].email).toBe("ali@ornek.com");
  expect(skipped).toHaveLength(1);
  expect(skipped[0].inv.invoice_number).toBe("A-2");
  expect(total).toBe(2);

  const onConfirm = jest.fn();
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <BulkInvoiceLinkConfirmModal
        ready={ready}
        skipped={skipped}
        total={total}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
  });
  const text = host.textContent;
  expect(host.querySelector('[data-testid="bulk-invoice-link-confirm-modal"]')).not.toBeNull();
  expect(text).toContain("A-1");
  expect(text).toContain("ali@ornek.com");
  expect(text).toContain("A-2");
  expect(text).toMatch(/atlanacak/i);
  expect(axios.post).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});

test("share-link uses ttl_hours=720", async () => {
  expect(invoiceShareLinkParams()).toEqual({ kind: "pdf", ttl_hours: INVOICE_LINK_TTL_HOURS });
  expect(INVOICE_LINK_TTL_HOURS).toBe(720);
  axios.get.mockResolvedValue({ data: { url: "https://app.example/s/x" } });
  axios.post.mockResolvedValue({ data: { status: "ok" } });
  await sendInvoiceShareLink({
    axiosClient: axios,
    apiUrl: "/api",
    companyId: "co",
    inv: { id: "i1", invoice_number: "A-1", contact_name: "Ali", contact_id: "c1" },
    email: "ali@ornek.com",
  });
  expect(axios.get).toHaveBeenCalledWith("/api/invoices/i1/share-link", {
    params: { kind: "pdf", ttl_hours: 720 },
  });
  expect(axios.post).toHaveBeenCalledTimes(1);
  const body = axios.post.mock.calls[0][1];
  expect(body.get("body")).toContain("Link 30 gün geçerlidir.");
});

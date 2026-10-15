import {
  INVOICE_BULK_ACTIONS,
  invoiceBulkNeedsSelection,
  bulkApiErrorDetail,
  invoiceHasGoneToGib,
  invoiceBulkRefreshSkipReason,
  invoiceBulkRefreshConfirmText,
  invoiceBulkRefreshRemainderReason,
  invoiceBulkRefreshGate,
  runInvoiceRefreshBulk,
  invoiceXmlFileName,
  invoiceBulkXmlSkipReason,
  runInvoiceXmlBulk,
  fetchInvoiceXmlResponse,
  invoiceGibLocked,
  invoiceBulkDateSkipReason,
  classifyInvoiceDateBulk,
  invoiceBulkDateSummaryText,
  runInvoiceDateBulk,
  invoiceBulkDeleteSkipReason,
  runInvoiceDeleteBulk,
} from "./invoiceBulkActions";
import { invoicesBulkDeleteConfirmMessage } from "../components/InvoiceContextMenu";

test("invoice bulk menu lists actions and only refresh works without selection", () => {
  expect(INVOICE_BULK_ACTIONS.map((a) => a.id)).toEqual([
    "einvoice_send",
    "einvoice_print",
    "invoice_print",
    "xml",
    "invoice_date",
    "invoice_link",
    "approve",
    "refresh",
    "cancel",
    "delete",
  ]);
  expect(invoiceBulkNeedsSelection("refresh")).toBe(false);
  expect(invoiceBulkNeedsSelection("cancel")).toBe(true);
  expect(invoiceBulkNeedsSelection("einvoice_send")).toBe(true);
});

const gibSent = {
  id: "g1",
  invoice_number: "EA-1",
  status: "approved",
  e_type: "e_archive",
  gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  einvoice_state: "sent",
};
const unsent = { id: "u1", invoice_number: "TA-1", status: "approved", e_type: "e_archive" };
const draft = { id: "d1", invoice_number: "DR-1", status: "draft", e_type: "e_archive" };
const paper = { id: "p1", invoice_number: "KA-1", status: "approved", e_type: "paper" };
const cancelled = { id: "c1", invoice_number: "IP-1", status: "cancelled", e_type: "e_archive" };

test("refresh skip unsent selected docs and ask confirm without selection", () => {
  expect(invoiceHasGoneToGib(gibSent)).toBe(true);
  expect(invoiceBulkRefreshSkipReason(unsent)).toBe("GİB'e gönderilmemiş");
  expect(invoiceBulkRefreshSkipReason(gibSent)).toBe("");
  const confirm = jest.fn(() => true);
  const visible = Array.from({ length: 42 }, (_, i) => ({
    ...gibSent,
    id: `g${i}`,
    invoice_number: `EA-${i}`,
  }));
  const gate = invoiceBulkRefreshGate({ selected: [], visible, confirm });
  expect(confirm).toHaveBeenCalledWith(invoiceBulkRefreshConfirmText(42));
  expect(confirm).toHaveBeenCalledWith("42 belge güncellenecek");
  expect(gate.targets).toHaveLength(40);
  expect(gate.remainder).toBe(2);
  expect(invoiceBulkRefreshRemainderReason(2)).toBe("kalan 2 belge için tekrar çalıştırın");
});

test("refresh silent loop counts API errors and remainder in results", async () => {
  const items = await runInvoiceRefreshBulk(
    [gibSent, unsent, { ...gibSent, id: "g2", invoice_number: "EA-2" }],
    {
      remainder: 5,
      refresh: async (inv) => {
        if (inv.id === "g1") {
          const err = new Error("x");
          err.response = { data: { detail: "GİB durumu alınamadı." } };
          throw err;
        }
        return { updated: true, gib_status: "1300" };
      },
    },
  );
  expect(items.map((x) => x.outcome)).toEqual(["error", "skipped", "ok", "skipped"]);
  expect(items[0].reason).toBe("GİB durumu alınamadı.");
  expect(items[1].reason).toBe("GİB'e gönderilmemiş");
  expect(items[2].reason).toBe("1300");
  expect(items[3].reason).toContain("kalan 5 belge için tekrar çalıştırın");
});

test("xml skips draft/paper/cancelled and names file from invoice number", async () => {
  expect(invoiceXmlFileName({ invoice_number: "EA-9", id: "xyz" })).toBe("EA-9.xml");
  expect(invoiceXmlFileName({ id: "only-id" })).toBe("only-id.xml");
  expect(invoiceBulkXmlSkipReason(draft)).toBe("Taslak");
  expect(invoiceBulkXmlSkipReason(paper)).toBe("Kağıt fatura");
  expect(invoiceBulkXmlSkipReason(cancelled)).toBe("İptal edilmiş");
  expect(invoiceBulkXmlSkipReason(unsent)).toBe("GİB'e gönderilmemiş");
  expect(invoiceBulkXmlSkipReason(gibSent)).toBe("");
  const downloaded = [];
  const items = await runInvoiceXmlBulk([draft, paper, cancelled, gibSent], {
    download: async (inv) => {
      downloaded.push(invoiceXmlFileName(inv));
      const err = new Error("x");
      err.response = { data: { detail: "XML yok" } };
      throw err;
    },
  });
  expect(downloaded).toEqual(["EA-1.xml"]);
  expect(items.map((x) => x.outcome)).toEqual(["skipped", "skipped", "skipped", "error"]);
  expect(items[3].reason).toBe("XML yok");
});

test("xml fetch falls back from e-invoice to invoices endpoint", async () => {
  const axiosClient = {
    get: jest.fn()
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: "xml-bytes" }),
  };
  const r = await fetchInvoiceXmlResponse(axiosClient, "/api", "inv-1");
  expect(axiosClient.get.mock.calls[0][0]).toBe("/api/e-invoice/inv-1/xml");
  expect(axiosClient.get.mock.calls[1][0]).toBe("/api/invoices/inv-1/xml");
  expect(r.data).toBe("xml-bytes");
});

test("date skip cancelled and GİB-locked; backend error listed", async () => {
  expect(invoiceGibLocked(gibSent)).toBe(true);
  expect(invoiceBulkDateSkipReason(cancelled)).toBe("İptal edilmiş fatura düzenlenemez.");
  expect(invoiceBulkDateSkipReason(gibSent)).toBe("GİB'e iletilmiş faturada sadece vade ve not düzenlenebilir.");
  expect(invoiceBulkDateSkipReason(draft)).toBe("");
  const classified = classifyInvoiceDateBulk([draft, cancelled, gibSent]);
  expect(invoiceBulkDateSummaryText(classified)).toBe("1 fatura güncellenecek; 2 atlanacak");
  const put = jest.fn(async (inv) => {
    if (inv.id === "d1") {
      const err = new Error("x");
      err.response = { data: { detail: "GİB'e iletilmiş faturada sadece vade ve not düzenlenebilir." } };
      throw err;
    }
  });
  const items = await runInvoiceDateBulk([draft, cancelled, gibSent], { date: "2026-10-15", put });
  expect(put).toHaveBeenCalledTimes(1);
  expect(put.mock.calls[0][0].id).toBe("d1");
  expect(items.map((x) => x.outcome)).toEqual(["error", "skipped", "skipped"]);
  expect(items[0].reason).toBe("GİB'e iletilmiş faturada sadece vade ve not düzenlenebilir.");
});

test("delete 409 reason appears and confirm text matches #1264", async () => {
  const confirmText = invoicesBulkDeleteConfirmMessage([
    { status: "draft", invoice_number: "TA1", order_number: "B2B-1" },
  ]);
  expect(confirmText).toBe("1 fatura çöp kutusuna taşınsın mı?\nBağlı sipariş B2B-1 da silinecek");
  expect(invoiceBulkDeleteSkipReason(gibSent)).toBe("Faturalaşmış belge silinemez");
  const items = await runInvoiceDeleteBulk([draft, gibSent], {
    remove: async () => {
      const err = new Error("x");
      err.response = { status: 409, data: { detail: "Faturalaşmış belge silinemez; iptal/iade kullanın." } };
      throw err;
    },
  });
  expect(items.map((x) => x.outcome)).toEqual(["error", "skipped"]);
  expect(items[0].reason).toBe("Faturalaşmış belge silinemez; iptal/iade kullanın.");
});

test("bulkApiErrorDetail reads FastAPI detail", () => {
  expect(bulkApiErrorDetail({ response: { data: { detail: "Faturalaşmış belge silinemez" } } })).toBe(
    "Faturalaşmış belge silinemez",
  );
});

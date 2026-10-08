import { describe, expect, it } from "@jest/globals";
import {
  INVOICE_PRINT_SHARE_HINT,
  fetchInvoicePdfFile,
  invoicePdfPublicUrl,
  invoicePrintShareDocFromOrder,
  invoicePrintShareKindLabel,
  invoicePrintShareMessage,
  invoicePrintShareNumber,
  invoicePrintShareSubject,
  whatsappMeUrl,
  whatsappPhoneDigits,
} from "./invoicePrintShare";

describe("invoicePrintShare", () => {
  const ord = {
    invoice_id: "inv-1",
    e_type: "e_invoice",
    einvoice_state: "sent",
    gib_invoice_id: "U052026000000090",
    customer_name: "Acme A.Ş.",
    customer_phone: "0532 111 22 33",
    customer_email: "a@x.com",
    shipping_address: "Atatürk Cad. No:1 Kadıköy",
    city: "İstanbul",
    grand_total: 1210,
    order_number: "B2B-2026-0065",
  };

  it("kind / number / subject follow GİB e-fatura fields", () => {
    expect(invoicePrintShareKindLabel(ord)).toBe("E-Fatura");
    expect(invoicePrintShareNumber(ord)).toBe("U052026000000090");
    expect(invoicePrintShareSubject(ord)).toBe("E-Fatura U052026000000090");
    expect(invoicePrintShareKindLabel({ e_type: "e_archive" })).toBe("E-Arşiv");
    expect(INVOICE_PRINT_SHARE_HINT).toMatch(/WhatsApp/i);
  });

  it("builds integrator print doc from order without GİB send fields", () => {
    const doc = invoicePrintShareDocFromOrder(ord);
    expect(doc.id).toBe("inv-1");
    expect(doc.e_type).toBe("e_invoice");
    expect(doc.einvoice_state).toBe("sent");
    expect(doc.shipping_address).toBe("Atatürk Cad. No:1 Kadıköy");
    expect(doc.address).toBe("Atatürk Cad. No:1 Kadıköy");
    expect(doc.city).toBe("İstanbul");
    expect(doc.customer_phone).toBe("0532 111 22 33");
    expect(invoicePrintShareDocFromOrder({})).toBeNull();
  });

  it("message is customer share copy with optional PDF link", () => {
    const msg = invoicePrintShareMessage(ord, {
      pdfUrl: "https://app.example/api/invoices/inv-1/pdf",
      companyName: "TamKobi",
    });
    expect(msg).toContain("Sayın Acme A.Ş.");
    expect(msg).toContain("U052026000000090");
    expect(msg).toContain("E-Fatura");
    expect(msg).toContain("PDF: https://app.example/api/invoices/inv-1/pdf");
    expect(msg).toContain("TamKobi");
    expect(msg.toLowerCase()).not.toContain("gib");
  });

  it("normalizes TR phones for wa.me", () => {
    expect(whatsappPhoneDigits("0532 111 22 33")).toBe("905321112233");
    expect(whatsappPhoneDigits("+90 532 111 22 33")).toBe("905321112233");
    expect(whatsappMeUrl("0532 111 22 33", "merhaba")).toBe(
      "https://wa.me/905321112233?text=merhaba",
    );
    expect(whatsappMeUrl("", "x")).toBe("");
  });

  it("builds public invoice PDF url", () => {
    expect(invoicePdfPublicUrl("https://app.example/", "inv-1")).toBe(
      "https://app.example/api/invoices/inv-1/pdf",
    );
  });

  it("fetchInvoicePdfFile wraps blob as File", async () => {
    const blob = new Blob([new Uint8Array(80).fill(37)], { type: "application/pdf" });
    const axiosClient = { get: jest.fn(async () => ({ data: blob, headers: { "content-type": "application/pdf" } })) };
    const file = await fetchInvoicePdfFile(axiosClient, "/api", "inv-1", "Fatura.pdf");
    expect(axiosClient.get).toHaveBeenCalledWith("/api/invoices/inv-1/pdf", expect.objectContaining({
      responseType: "blob",
    }));
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("Fatura.pdf");
  });
});

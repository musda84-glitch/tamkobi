import { describe, expect, test } from "@jest/globals";
import {
  canCancelInvoice,
  canIssueExpenseSlip,
  canEditInvoice,
  canIssueInvoice,
  canDownloadGibDocuments,
  canDeleteInvoice,
  displayInvoiceNumber,
  formatGibStatusLabel,
  invoiceBuyerTaxId,
  invoiceETypeLabel,
  invoiceHasPayment,
  isIncomingPurchaseInvoice,
  canMatchIncomingProducts,
  unmatchedIncomingLineCount,
  placeContextMenu,
  suggestedIssueTypeFromGib,
  shouldResolveIssueFromGib,
  looksLikeOfficialGibInvoiceNumber,
  isGibIssued,
} from "./InvoiceContextMenu";

describe("displayInvoiceNumber", () => {
  test("prefers GİB invoice id over local number", () => {
    expect(displayInvoiceNumber({ invoice_number: "LOCAL-1", gib_invoice_id: "TA202600000115" })).toBe("TA202600000115");
  });

  test("falls back to local invoice number", () => {
    expect(displayInvoiceNumber({ invoice_number: "TA202600000115" })).toBe("TA202600000115");
  });
});

describe("formatGibStatusLabel", () => {
  test("marks test mode when status empty but sent", () => {
    expect(formatGibStatusLabel({ einvoice_state: "sent", gib_mode: "test" })).toBe("Test · GİB durumu bekleniyor");
  });

  test("prefixes Test on existing status", () => {
    expect(formatGibStatusLabel({ gib_status: "GİB onaylı", gib_mode: "test" })).toBe("Test · GİB onaylı");
  });

  test("only real 1300 maps to Başarıyla Tamamlandı", () => {
    expect(formatGibStatusLabel({ gib_status: "Basariyla_Tamamlandi", gib_status_code: "1300", gib_mode: "test" })).toBe(
      "Test · Başarıyla Tamamlandı"
    );
    expect(formatGibStatusLabel({ gib_status: "Başarıyla Tamamlandı", gib_status_code: "1300" })).toBe(
      "Başarıyla Tamamlandı"
    );
    expect(formatGibStatusLabel({ gib_status: "Hedeften Sistem Yanıtı Gelmedi", gib_status_code: "1220", gib_mode: "test" })).toBe(
      "Test · Hedeften Sistem Yanıtı Gelmedi"
    );
    expect(formatGibStatusLabel({ gib_status: "Zarf Başarıyla İşlendi", gib_status_code: "1200" })).toBe(
      "Zarf Başarıyla İşlendi"
    );
  });

  test("keeps schematron / queue statuses", () => {
    expect(formatGibStatusLabel({ gib_status: "Schematron Kontrol Sonucu Hatalı", gib_status_code: "1150", gib_mode: "test" })).toBe(
      "Test · Schematron Kontrol Sonucu Hatalı"
    );
    expect(formatGibStatusLabel({ gib_status: "Zarf Kuyruğa Eklendi", gib_status_code: "1000" })).toBe(
      "Zarf Kuyruğa Eklendi"
    );
  });
});

describe("placeContextMenu", () => {
  test("shifts a menu opened at the bottom of the screen fully into view", () => {
    const placed = placeContextMenu({
      x: 1494,
      y: 856,
      height: 425,
      viewportWidth: 1680,
      viewportHeight: 1000,
    });
    expect(placed.top + 425).toBeLessThanOrEqual(1000 - 8);
    expect(placed.top).toBeGreaterThanOrEqual(8);
    expect(placed.left + 256).toBeLessThanOrEqual(1680 - 8);
    expect(placed.maxHeight).toBe(1000 - 16);
  });

  test("keeps a menu that already fits where it was opened", () => {
    const placed = placeContextMenu({
      x: 400,
      y: 120,
      height: 425,
      viewportWidth: 1680,
      viewportHeight: 1000,
    });
    expect(placed.top).toBe(120);
    expect(placed.left).toBe(400);
  });

  test("caps a menu taller than the viewport and pins it to the top margin", () => {
    const placed = placeContextMenu({
      x: 40,
      y: 700,
      height: 900,
      viewportWidth: 800,
      viewportHeight: 720,
    });
    expect(placed.top).toBe(8);
    expect(placed.maxHeight).toBe(720 - 16);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(720 - 8);
  });
});

describe("canMatchIncomingProducts", () => {
  test("allows incoming purchase and dispatch", () => {
    expect(canMatchIncomingProducts({
      invoice_type: "purchase",
      direction: "incoming",
      status: "approved",
    })).toBe(true);
    expect(canMatchIncomingProducts({
      invoice_type: "dispatch",
      direction: "incoming",
      e_type: "e_dispatch",
      status: "approved",
    })).toBe(true);
    expect(canMatchIncomingProducts({
      invoice_type: "sales",
      status: "approved",
    })).toBe(false);
    expect(canMatchIncomingProducts({
      invoice_type: "purchase",
      direction: "incoming",
      status: "cancelled",
    })).toBe(false);
  });

  test("counts unmatched lines", () => {
    expect(unmatchedIncomingLineCount([
      { name: "A" },
      { name: "B", product_id: "p1" },
      { name: "" },
    ])).toBe(1);
  });
});

describe("isGibIssued", () => {
  test("treats exact İşNet success status as issued", () => {
    expect(isGibIssued({ gib_status: "İşNet SOAP API ile GİB'e iletildi" })).toBe(true);
  });

  test("treats gib_uuid / ziplenmiş as issued", () => {
    expect(isGibIssued({ gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", gib_status: "Onaylandı" })).toBe(true);
    expect(isGibIssued({ gib_status: "Test - Ziplenmiş — GİB iletimi bekleniyor" })).toBe(true);
  });

  test("local Taslak/Onaylandı without GİB ids is not issued", () => {
    expect(isGibIssued({ gib_status: "Onaylandı", e_type: "paper", status: "approved" })).toBe(false);
    expect(isGibIssued({ gib_status: "Taslak", e_type: "e_archive", status: "draft" })).toBe(false);
  });

  test("does not treat Hata gib_status containing iletildi as issued", () => {
    expect(
      isGibIssued({
        einvoice_state: "error",
        gib_status:
          "Hata: İşNet SendArchiveInvoiceXml ETTN döndürmedi — fatura NetteFatura'ya düşmemiş olabilir. Fatura İşNet'e iletildi.",
      }),
    ).toBe(false);
    expect(
      isGibIssued({
        gib_status:
          "Hata: İşNet SOAP ETTN döndürdü ancak fatura NetteFatura test/canlı portalında bulunamadı. Gönderim tamamlanmamış — «GİB'e iletildi» yazılmadı.",
      }),
    ).toBe(false);
  });
});

describe("purchase invoices are not issued via FATURAYI KES", () => {
  test("canIssueInvoice is false for all purchase invoices", () => {
    expect(canIssueInvoice({
      status: "draft",
      invoice_type: "purchase",
      e_type: "e_archive",
      contact_name: "TEST",
    })).toBe(false);
    expect(canIssueInvoice({
      status: "draft",
      invoice_type: "purchase",
      e_type: "paper",
    })).toBe(false);
    expect(canIssueInvoice({
      status: "approved",
      invoice_type: "purchase",
      e_type: "e_invoice",
      direction: "incoming",
    })).toBe(false);
  });

  test("sales drafts cannot issue e-Fatura / e-Arşiv", () => {
    expect(canIssueInvoice({
      status: "draft",
      invoice_type: "sales",
      e_type: "e_archive",
    })).toBe(false);
    expect(canIssueInvoice({
      status: "draft",
      invoice_type: "sales",
      e_type: "e_invoice",
    })).toBe(false);
    expect(canIssueInvoice({
      status: "draft",
      invoice_type: "sales",
      e_type: "paper",
    })).toBe(false);
  });

  test("posted paper sales invoices can still issue GİB e-belge", () => {
    expect(canIssueInvoice({
      status: "approved",
      invoice_type: "sales",
      e_type: "paper",
    })).toBe(true);
  });

  test("draft e-dispatch can still be sent", () => {
    expect(canIssueInvoice({
      status: "draft",
      invoice_type: "dispatch",
      e_type: "e_dispatch",
    })).toBe(true);
  });

  test("purchase e-invoice can download GİB documents", () => {
    expect(canDownloadGibDocuments({
      invoice_type: "purchase",
      e_type: "e_invoice",
      status: "approved",
      direction: "incoming",
    })).toBe(true);
    expect(canDownloadGibDocuments({
      invoice_type: "purchase",
      e_type: "paper",
      status: "draft",
      direction: "incoming",
    })).toBe(true);
    expect(canDownloadGibDocuments({
      invoice_type: "purchase",
      e_type: "paper",
      status: "draft",
    })).toBe(false);
  });
});

const issued = {
  status: "approved",
  e_type: "e_invoice",
  invoice_type: "sales",
  contact_id: "c1",
  contact_name: "ERSAY",
  gib_status: "Başarıyla İletildi (GİB Onaylı)",
  payment_status: "unpaid",
  paid_amount: 0,
};

describe("issued invoice menu actions", () => {
  test("paid e-invoice can still be cancelled from the menu", () => {
    const paid = { ...issued, payment_status: "paid", paid_amount: 100 };
    expect(invoiceHasPayment(paid)).toBe(true);
    expect(canCancelInvoice(paid)).toBe(true);
    expect(canIssueExpenseSlip(paid)).toBe(true);
  });

  test("paper invoices are not cancelled — they are deleted", () => {
    expect(canCancelInvoice({ ...issued, e_type: "paper" })).toBe(false);
    expect(canCancelInvoice({ ...issued, e_type: "e_archive" })).toBe(true);
  });

  test("unpaid issued sales invoice offers cancel and expense slip", () => {
    expect(canCancelInvoice(issued)).toBe(true);
    expect(canIssueExpenseSlip(issued)).toBe(true);
  });

  test("drafts, slips, dispatches and incoming e-invoices do not offer a new slip", () => {
    expect(canCancelInvoice({ ...issued, status: "draft" })).toBe(false);
    expect(canIssueExpenseSlip({ ...issued, status: "draft" })).toBe(false);
    expect(canIssueExpenseSlip({ ...issued, e_type: "expense_slip" })).toBe(false);
    expect(canIssueExpenseSlip({ ...issued, invoice_type: "dispatch" })).toBe(false);
    expect(canIssueExpenseSlip({
      ...issued,
      invoice_type: "purchase",
      direction: "incoming",
    })).toBe(false);
  });
});

describe("draft edit lives in the ⋮ menu", () => {
  test("sales drafts can be edited", () => {
    expect(canEditInvoice({ status: "draft", invoice_type: "sales", e_type: "e_archive" })).toBe(true);
  });

  test("approved but not GİB-sent invoices can be edited", () => {
    expect(canEditInvoice({
      status: "approved",
      invoice_type: "sales",
      e_type: "e_invoice",
      gib_status: "Taslak",
    })).toBe(true);
  });

  test("issued invoices and incoming e-invoices cannot be edited from the menu", () => {
    expect(canEditInvoice(issued)).toBe(false);
    expect(canEditInvoice({ status: "draft", invoice_type: "purchase", direction: "incoming" })).toBe(false);
    expect(canEditInvoice({ status: "draft", invoice_type: "dispatch" })).toBe(false);
  });

  test("GİB-sent e-invoice with uuid or official number cannot be edited", () => {
    expect(canEditInvoice({
      status: "approved",
      invoice_type: "sales",
      e_type: "e_invoice",
      invoice_number: "U052026000000090",
      gib_invoice_id: "U052026000000090",
      gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      gib_status: "Onaylandı",
    })).toBe(false);
    expect(canEditInvoice({
      status: "approved",
      invoice_type: "sales",
      e_type: "e_archive",
      invoice_number: "U052026000000090",
      gib_invoice_id: "U052026000000090",
      gib_status: "Onaylandı",
    })).toBe(false);
    // Resmi GİB serisi invoice_number — gib_invoice_id yoksa bile düzenlenmez
    expect(looksLikeOfficialGibInvoiceNumber("U052026000000090")).toBe(true);
    expect(canEditInvoice({
      status: "approved",
      invoice_type: "sales",
      e_type: "e_archive",
      invoice_number: "U052026000000090",
      gib_status: "Onaylandı",
    })).toBe(false);
  });
});

describe("incoming GİB purchase labels and delete guard", () => {
  test("wrong paper e_type still shows Gelen e-Fatura", () => {
    expect(invoiceETypeLabel({
      invoice_type: "purchase",
      e_type: "paper",
      direction: "incoming",
      source: "edoc_inbox",
    })).toBe("Gelen e-Fatura");
    expect(invoiceETypeLabel({
      invoice_type: "purchase",
      e_type: "paper",
      gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    })).toBe("Gelen e-Fatura");
  });

  test("incoming GİB purchase cannot be deleted from the list", () => {
    expect(canDeleteInvoice({
      status: "draft",
      invoice_type: "purchase",
      e_type: "paper",
      direction: "incoming",
    })).toBe(false);
    expect(canDeleteInvoice({
      status: "draft",
      invoice_type: "sales",
      e_type: "paper",
    })).toBe(true);
  });

  test("isIncomingPurchaseInvoice catches gib_uuid even when e_type is paper", () => {
    expect(isIncomingPurchaseInvoice({
      invoice_type: "purchase",
      e_type: "paper",
      gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    })).toBe(true);
  });
});

describe("GİB suggested issue type", () => {
  test("maps lookup to e_invoice or e_archive", () => {
    expect(suggestedIssueTypeFromGib({ is_e_invoice_user: true, suggested_e_type: "e_invoice" })).toBe("e_invoice");
    expect(suggestedIssueTypeFromGib({ is_e_invoice_user: false, suggested_e_type: "e_archive" })).toBe("e_archive");
    expect(suggestedIssueTypeFromGib({ is_e_invoice_user: true })).toBe("e_invoice");
    expect(suggestedIssueTypeFromGib(null)).toBe("e_archive");
  });

  test("paper and export stay manual; auto/e-belge resolve from GİB", () => {
    expect(shouldResolveIssueFromGib("paper")).toBe(false);
    expect(shouldResolveIssueFromGib("e_export")).toBe(false);
    expect(shouldResolveIssueFromGib("auto")).toBe(true);
    expect(shouldResolveIssueFromGib("e_invoice")).toBe(true);
    expect(shouldResolveIssueFromGib("e_archive")).toBe(true);
    expect(shouldResolveIssueFromGib(null)).toBe(true);
  });

  test("invoiceBuyerTaxId strips non-digits", () => {
    expect(invoiceBuyerTaxId({ contact_tax_id: "123-456-7890" })).toBe("1234567890");
    expect(invoiceBuyerTaxId({})).toBe("");
  });
});

import { describe, expect, test } from "@jest/globals";
import { shouldUseIntegratorPdf, integratorPdfKindLabel } from "./printIntegratorPdf";

describe("shouldUseIntegratorPdf", () => {
  test("uses integrator PDF for sent e-archive / e-invoice", () => {
    expect(shouldUseIntegratorPdf("invoice", {
      e_type: "e_archive",
      einvoice_state: "sent",
      gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    })).toBe(true);
    expect(shouldUseIntegratorPdf("invoice", {
      e_type: "e_invoice",
      gib_status: "İşNet SOAP API ile GİB'e iletildi",
      gib_tracking_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    })).toBe(true);
  });

  test("keeps template print for draft / paper / non-invoice", () => {
    expect(shouldUseIntegratorPdf("invoice", { e_type: "paper", status: "approved" })).toBe(false);
    expect(shouldUseIntegratorPdf("invoice", { e_type: "e_archive", status: "draft" })).toBe(false);
    expect(shouldUseIntegratorPdf("order", { e_type: "e_archive", einvoice_state: "sent" })).toBe(false);
  });

  test("does not use integrator PDF for Hata gib_status", () => {
    expect(shouldUseIntegratorPdf("invoice", {
      e_type: "e_archive",
      einvoice_state: "error",
      gib_status: "Hata: İşNet ETTN döndürmedi — fatura NetteFatura'ya düşmemiş olabilir. Fatura İşNet'e iletildi.",
    })).toBe(false);
  });

  test("integratorPdfKindLabel", () => {
    expect(integratorPdfKindLabel({ e_type: "e_invoice" })).toBe("e-Fatura");
    expect(integratorPdfKindLabel({ e_type: "e_archive" })).toBe("e-Arşiv");
  });
});

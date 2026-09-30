import { describe, expect, test } from "@jest/globals";
import { shouldUseIntegratorPdf } from "./printIntegratorPdf";

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
});

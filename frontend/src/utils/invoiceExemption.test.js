import { describe, expect, it } from "@jest/globals";
import {
  invoiceNeedsExemptionPrompt,
  TAX_EXEMPTION_OPTIONS,
} from "./invoiceExemption";

describe("invoiceNeedsExemptionPrompt", () => {
  it("asks when KDV %0 and no exemption code", () => {
    expect(
      invoiceNeedsExemptionPrompt({
        items: [{ vat_rate: 0 }],
      }),
    ).toBe(true);
  });

  it("skips when invoice already has tax_exemption_code", () => {
    expect(
      invoiceNeedsExemptionPrompt({
        tax_exemption_code: "351",
        items: [{ vat_rate: 0 }],
      }),
    ).toBe(false);
  });

  it("skips when all lines have positive KDV", () => {
    expect(
      invoiceNeedsExemptionPrompt({
        items: [{ vat_rate: 20 }],
      }),
    ).toBe(false);
  });

  it("lists common GİB codes including 351", () => {
    expect(TAX_EXEMPTION_OPTIONS.some(([c]) => c === "351")).toBe(true);
  });
});

import { describe, expect, it } from "@jest/globals";
import {
  invoiceNeedsWithholdingPrompt,
  parseWithholdingValue,
  WITHHOLDING_OPTIONS,
} from "./invoiceWithholding";

describe("invoiceNeedsWithholdingPrompt", () => {
  it("asks when a line has KDV %0 and no tevkifat", () => {
    expect(
      invoiceNeedsWithholdingPrompt({
        items: [{ name: "Hizmet", vat_rate: 0 }],
        withholding_rate: 0,
      }),
    ).toBe(true);
  });

  it("skips when tevkifat already selected", () => {
    expect(
      invoiceNeedsWithholdingPrompt({
        items: [{ vat_rate: 0 }],
        withholding_rate: 0.5,
        withholding_code: "603",
      }),
    ).toBe(false);
  });

  it("skips export / e-export", () => {
    expect(
      invoiceNeedsWithholdingPrompt({
        trade_kind: "export",
        items: [{ vat_rate: 0 }],
      }),
    ).toBe(false);
    expect(
      invoiceNeedsWithholdingPrompt({
        e_type: "e_export",
        items: [{ vat_rate: 0 }],
      }),
    ).toBe(false);
  });

  it("skips when all lines have positive KDV", () => {
    expect(
      invoiceNeedsWithholdingPrompt({
        items: [{ vat_rate: 20 }, { vat_rate: 10 }],
      }),
    ).toBe(false);
  });
});

describe("parseWithholdingValue", () => {
  it("parses rate|code", () => {
    expect(parseWithholdingValue("0.5|603")).toEqual({
      withholding_rate: 0.5,
      withholding_code: "603",
    });
    expect(parseWithholdingValue("")).toEqual({ withholding_rate: 0, withholding_code: "" });
  });

  it("lists GİB codes including 603", () => {
    expect(WITHHOLDING_OPTIONS.some(([v]) => v === "0.5|603")).toBe(true);
  });
});

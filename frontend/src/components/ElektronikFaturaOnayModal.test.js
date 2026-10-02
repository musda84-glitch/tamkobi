import { describe, expect, it } from "@jest/globals";
import {
  buildIadeNote,
  isReturnInvoiceDoc,
  prefillReturnBillingRef,
} from "./ElektronikFaturaOnayModal";

describe("isReturnInvoiceDoc", () => {
  it("detects return types", () => {
    expect(isReturnInvoiceDoc({ invoice_type: "return" })).toBe(true);
    expect(isReturnInvoiceDoc({ invoice_type: "sales_return" })).toBe(true);
    expect(isReturnInvoiceDoc({ invoice_type: "İade" })).toBe(true);
    expect(isReturnInvoiceDoc({ invoice_type: "sales" })).toBe(false);
  });
});

describe("prefillReturnBillingRef", () => {
  it("uses original_invoice fields", () => {
    expect(
      prefillReturnBillingRef({
        original_invoice_number: "U052026000000065",
        original_issue_date: "2026-09-29",
      }),
    ).toEqual({ number: "U052026000000065", date: "2026-09-29" });
  });

  it("parses from notes when fields missing", () => {
    expect(
      prefillReturnBillingRef({
        notes: "29.09.2026 tarihli GHJ2026000002586 numaralı faturaya istinaden düzenlenen iade faturasıdır.",
      }),
    ).toEqual({ number: "GHJ2026000002586", date: "2026-09-29" });
  });
});

describe("buildIadeNote", () => {
  it("formats TR note for BillingReference fallback", () => {
    expect(buildIadeNote("u052026000000065", "2026-09-29")).toBe(
      "29.09.2026 tarihli U052026000000065 numaralı faturaya istinaden düzenlenen iade faturasıdır.",
    );
  });
});

import {
  buildIadeNote,
  efaturaOnayMessage,
  invoiceNeedsExemptionPrompt,
  invoiceNeedsWithholdingPrompt,
  isReturnInvoiceDoc,
  parseWithholdingValue,
  prefillReturnBillingRef,
} from "./efaturaOnay";
import { compareInvoiceActivity, invoiceActivityStamp } from "./invoiceSortStamp";
import { formatIssueStamp, nowIssueDateTime, showEfaturaStampNow } from "./invoiceIssueNow";

describe("efaturaOnay helpers", () => {
  it("builds mükellef messages", () => {
    expect(efaturaOnayMessage(true)).toMatch(/e-fatura mükellefidir/);
    expect(efaturaOnayMessage(false)).toMatch(/e-arşiv/);
  });

  it("detects exemption and withholding prompts for KDV %0", () => {
    expect(invoiceNeedsExemptionPrompt({ items: [{ vat_rate: 0 }] })).toBe(true);
    expect(invoiceNeedsExemptionPrompt({ tax_exemption_code: "351", items: [{ vat_rate: 0 }] })).toBe(false);
    expect(invoiceNeedsExemptionPrompt({ items: [{ vat_rate: 20 }] })).toBe(false);
    expect(invoiceNeedsWithholdingPrompt({ items: [{ vat_rate: 0 }] })).toBe(true);
    expect(invoiceNeedsWithholdingPrompt({ withholding_rate: 0.5, items: [{ vat_rate: 0 }] })).toBe(false);
    expect(invoiceNeedsWithholdingPrompt({ e_type: "e_export", items: [{ vat_rate: 0 }] })).toBe(false);
  });

  it("handles iade billing reference", () => {
    expect(isReturnInvoiceDoc({ invoice_type: "return" })).toBe(true);
    expect(isReturnInvoiceDoc({ invoice_type: "sales" })).toBe(false);
    expect(prefillReturnBillingRef({
      notes: "01.09.2026 tarihli ABC1234567890123 numaralı faturaya",
    })).toEqual({ number: "ABC1234567890123", date: "2026-09-01" });
    expect(buildIadeNote("ABC1", "2026-09-01")).toMatch(/01\.09\.2026 tarihli ABC1/);
    expect(parseWithholdingValue("0.5|603")).toEqual({ withholding_rate: 0.5, withholding_code: "603" });
  });
});

describe("invoiceIssueNow / sort stamp", () => {
  it("formats now stamp and list activity", () => {
    const now = new Date(2026, 9, 5, 16, 23, 7);
    expect(nowIssueDateTime(now)).toEqual({ issue_date: "2026-10-05", issue_time: "16:23:07" });
    expect(formatIssueStamp("2026-10-05", "16:23:07")).toBe("05.10.2026 16:23");
    expect(showEfaturaStampNow({})).toBe(true);
    expect(showEfaturaStampNow({ isBulk: true })).toBe(false);
    expect(invoiceActivityStamp({ issue_date: "2026-10-01", issue_time: "09:30:00" })).toContain("2026-10-01T09:30:00");
    expect(compareInvoiceActivity(
      { issue_date: "2026-10-01", issue_time: "10:00:00" },
      { issue_date: "2026-10-01", issue_time: "18:00:00" },
    )).toBeGreaterThan(0);
  });
});

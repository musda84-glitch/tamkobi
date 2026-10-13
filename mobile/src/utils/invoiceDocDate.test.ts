import {
  askInvoiceDatePrompt,
  docDocumentDate,
  docHasOldDocumentDate,
  INVOICE_DATE_PROMPT,
  shouldAskInvoiceDatePrompt,
} from "./invoiceDocDate";

describe("docDocumentDate", () => {
  it("prefers invoice_date then issue_date", () => {
    expect(docDocumentDate({ invoice_date: "2026-01-02", issue_date: "2026-01-01" })).toBe("2026-01-02");
    expect(docDocumentDate({ issue_date: "2026-03-04T12:00:00" })).toBe("2026-03-04");
    expect(docDocumentDate({ order_date: "2026-05-06", created_at: "2026-05-01" })).toBe("2026-05-06");
  });
});

describe("shouldAskInvoiceDatePrompt", () => {
  const today = "2026-10-13";

  it("asks when document date is older than today", () => {
    expect(shouldAskInvoiceDatePrompt({ issue_date: "2026-10-01" }, today)).toBe(true);
    expect(docHasOldDocumentDate({ issue_date: "2026-10-01" }, today)).toBe(true);
  });

  it("does not ask for today or future / missing dates", () => {
    expect(shouldAskInvoiceDatePrompt({ issue_date: "2026-10-13" }, today)).toBe(false);
    expect(shouldAskInvoiceDatePrompt({ issue_date: "2026-10-14" }, today)).toBe(false);
    expect(shouldAskInvoiceDatePrompt({ issue_date: "" }, today)).toBe(false);
    expect(shouldAskInvoiceDatePrompt(null, today)).toBe(false);
  });

  it("exposes Tarihi bugüne çek / Olduğu gibi gönder labels", () => {
    expect(INVOICE_DATE_PROMPT.stampNowLabel).toBe("Tarihi bugüne çek");
    expect(INVOICE_DATE_PROMPT.keepLabel).toBe("Olduğu gibi gönder");
  });

  it("askInvoiceDatePrompt wires stamp_now and keep buttons", () => {
    const choices: string[] = [];
    let buttons: { text?: string; onPress?: () => void }[] = [];
    askInvoiceDatePrompt((c) => choices.push(c), (_t, _m, b) => { buttons = b || []; });
    expect(buttons.map((b) => b.text)).toEqual([
      INVOICE_DATE_PROMPT.cancelLabel,
      INVOICE_DATE_PROMPT.keepLabel,
      INVOICE_DATE_PROMPT.stampNowLabel,
    ]);
    buttons.find((b) => b.text === INVOICE_DATE_PROMPT.keepLabel)?.onPress?.();
    buttons.find((b) => b.text === INVOICE_DATE_PROMPT.stampNowLabel)?.onPress?.();
    expect(choices).toEqual(["keep", "stamp_now"]);
  });
});

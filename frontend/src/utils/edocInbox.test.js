import {
  uniqueInboxItems, inboxKindFromQuery, inboxItemsOfKind, inboxStatusKey, processStockChoice, INBOX_STATUS_FILTERS,
  GIB_ACCEPT_CONFIRM, GIB_RED_OPTION_LABEL, DISPATCH_PROCESS_LABEL, DISPATCH_PROCESS_SUCCESS,
  canSendCommercialResponse, commercialBadge, commercialElapsedDays, commercialWindowOpen,
  inboxProcessLabel, inboxProcessSuccess, incomingCommercialStatusLabel,
} from "./edocInbox";

const NOW = new Date("2026-10-16T09:00:00Z");

describe("uniqueInboxItems", () => {
  it("keeps one row when the same invoice number appears twice", () => {
    const items = [
      { id: "a", kind: "invoice", number: "ALE2026000007781", uuid: "u-1", supplier: { name: "ALTIN" } },
      { id: "b", kind: "invoice", number: "ALE2026000007781", uuid: "", supplier: { name: "ALTIN" } },
    ];
    const out = uniqueInboxItems(items);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
  });

  it("collapses ETTN-only and number-only copies of the same invoice", () => {
    const items = [
      { id: "uuid-copy", kind: "invoice", number: "", uuid: "11111111-2222-3333-4444-555555555555" },
      { id: "num-copy", kind: "invoice", number: "ABC2026000000042", uuid: "11111111-2222-3333-4444-555555555555" },
    ];
    expect(uniqueInboxItems(items)).toHaveLength(1);
  });

  it("keeps invoice and despatch with the same number", () => {
    const items = [
      { id: "inv", kind: "invoice", number: "X2026000000001" },
      { id: "irs", kind: "dispatch", number: "X2026000000001" },
    ];
    expect(uniqueInboxItems(items).map((d) => d.id)).toEqual(["inv", "irs"]);
  });
});

describe("inbox pending-only filters", () => {
  it("defaults kind to invoice and drops all/invoice chips", () => {
    expect(inboxKindFromQuery()).toBe("invoice");
    expect(inboxKindFromQuery("all")).toBe("invoice");
    expect(inboxKindFromQuery("invoice")).toBe("invoice");
    expect(inboxKindFromQuery("dispatch")).toBe("dispatch");
    expect(INBOX_STATUS_FILTERS.map(([k]) => k)).toEqual(["pending", "rejected", "ignored"]);
    expect(inboxStatusKey("approved")).toBe("pending");
    expect(inboxStatusKey("")).toBe("pending");
  });

  it("lists pending invoices without mixing despatch", () => {
    const items = [
      { id: "inv", kind: "invoice", number: "A1" },
      { id: "irs", kind: "dispatch", number: "D1" },
    ];
    expect(inboxItemsOfKind(items, "all").map((d) => d.id)).toEqual(["inv"]);
    expect(inboxItemsOfKind(items, "dispatch").map((d) => d.id)).toEqual(["irs"]);
  });

  it("lets the user choose stock cards before posting to incoming invoices", () => {
    expect(processStockChoice(true)).toEqual({ auto_create_products: true, allow_unmatched: false });
    expect(processStockChoice(false)).toEqual({ auto_create_products: false, allow_unmatched: true });
  });
});

describe("commercial GİB response buttons", () => {
  const ticari = { kind: "invoice", profile: "TICARIFATURA", issue_date: "2026-10-16" };

  it("shows KABUL only for TICARI inside 8 days and hides TEMEL, expired and dispatch", () => {
    expect(commercialElapsedDays("2026-10-08", NOW)).toBe(8);
    expect(commercialElapsedDays("2026-10-07", NOW)).toBe(9);
    expect(canSendCommercialResponse(ticari, NOW)).toBe(true);
    expect(commercialWindowOpen({ ...ticari, issue_date: "2026-10-08" }, NOW)).toBe(true);
    expect(canSendCommercialResponse({ ...ticari, issue_date: "2026-10-07" }, NOW)).toBe(false);
    expect(canSendCommercialResponse({ ...ticari, profile: "TEMELFATURA" }, NOW)).toBe(false);
    expect(canSendCommercialResponse({ ...ticari, kind: "dispatch" }, NOW)).toBe(false);
    expect(canSendCommercialResponse({ ...ticari, commercial_response: "accepted" }, NOW)).toBe(false);
    expect(GIB_ACCEPT_CONFIRM).toBe("Bu yanıt GİB'e gider, geri alınamaz");
    expect(GIB_RED_OPTION_LABEL).toBe("GİB'e RED yanıtı gönder");
  });

  it("badges waiting days, accepted and rejected", () => {
    expect(commercialBadge(ticari, NOW).label).toBe("Yanıt bekliyor (8 gün)");
    expect(commercialBadge({ ...ticari, issue_date: "2026-10-08" }, NOW).label).toBe("Yanıt bekliyor (0 gün)");
    expect(commercialBadge({ ...ticari, commercial_response: "accepted" }, NOW).label).toBe("Kabul edildi");
    expect(commercialBadge({ ...ticari, commercial_response: "rejected" }, NOW).label).toBe("Reddedildi");
    expect(commercialBadge({ ...ticari, profile: "TEMELFATURA" }, NOW)).toBeNull();
    expect(commercialBadge({ kind: "dispatch", profile: "TICARIFATURA", issue_date: "2026-10-16" }, NOW)).toBeNull();
  });

  it("names the dispatch intake button without changing the invoice label", () => {
    expect(inboxProcessLabel({ kind: "dispatch" })).toBe(DISPATCH_PROCESS_LABEL);
    expect(inboxProcessLabel({ kind: "invoice" })).toBe("Gelen faturaya al");
    expect(inboxProcessSuccess({ kind: "dispatch" })).toBe(DISPATCH_PROCESS_SUCCESS);
    expect(inboxProcessSuccess({ kind: "invoice" })).toContain("Gelen faturaya alındı");
  });

  it("shows the same commercial status on an incoming invoice row", () => {
    const base = { invoice_type: "purchase", direction: "incoming", source: "edoc_inbox", issue_date: "2026-10-16" };
    expect(incomingCommercialStatusLabel({
      ...base,
      gib_status: "Gelen E-Fatura (Yanıt Bekleniyor)",
    }, NOW).label).toBe("Yanıt bekliyor (8 gün)");
    expect(incomingCommercialStatusLabel({
      ...base,
      gib_response: "accepted",
      gib_status: "Gelen E-Fatura Onaylandı",
      commercial_response: "accepted",
    }, NOW).label).toBe("Kabul edildi");
    expect(incomingCommercialStatusLabel({
      ...base,
      gib_response: "rejected",
      gib_status: "Gelen E-Fatura Reddedildi",
    }, NOW).label).toBe("Reddedildi");
    expect(incomingCommercialStatusLabel({
      ...base,
      gib_response: "accepted",
      gib_status: "Gelen E-Fatura Onaylandı",
      profile: "TEMELFATURA",
    }, NOW)).toBeNull();
  });
});

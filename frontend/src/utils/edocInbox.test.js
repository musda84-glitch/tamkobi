import { uniqueInboxItems, inboxKindFromQuery, inboxItemsOfKind, inboxStatusKey, processStockChoice, INBOX_STATUS_FILTERS } from "./edocInbox";

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

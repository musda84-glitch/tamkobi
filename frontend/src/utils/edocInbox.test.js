import { uniqueInboxItems } from "./edocInbox";

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

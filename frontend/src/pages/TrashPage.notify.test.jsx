import { trashNotifyScopes } from "./TrashPage";

describe("trashNotifyScopes", () => {
  it("maps bank/cash entities to cash scope", () => {
    expect(trashNotifyScopes("bank_transaction")).toEqual(["cash"]);
    expect(trashNotifyScopes("bank_account")).toEqual(["cash"]);
    expect(trashNotifyScopes("partner_transaction")).toEqual(["cash"]);
  });

  it("maps invoices and contacts", () => {
    expect(trashNotifyScopes("invoice")).toEqual(["invoices", "cash", "contacts"]);
    expect(trashNotifyScopes("contact")).toEqual(["contacts", "cash"]);
  });

  it("falls back to all for unknown types", () => {
    expect(trashNotifyScopes("recipe")).toEqual(["stock"]);
    expect(trashNotifyScopes("weird")).toEqual(["all"]);
  });
});

import { CONTACT_STATEMENT_MENU_ITEMS } from "./contactStatementMenu";

describe("contactStatementMenu", () => {
  it("matches the web Hesap Ekstresi labels", () => {
    expect(CONTACT_STATEMENT_MENU_ITEMS.map((i) => i.label)).toEqual([
      "Ekstre Linki",
      "Ekstre",
      "Detaylı Ekstre",
      "Mutabakat Mektubu",
    ]);
    expect(CONTACT_STATEMENT_MENU_ITEMS[0]).toMatchObject({ action: "link", badge: "yeni" });
    expect(CONTACT_STATEMENT_MENU_ITEMS.map((i) => i.action)).toEqual([
      "link",
      "statement",
      "detailed",
      "reconciliation",
    ]);
  });
});

import { CONTACT_TYPE_FILTERS, filterContacts, matchesContactSearch, matchesContactType } from "./contactFilters";

const rows = [
  { name: "Acme", type: "customer", city: "İstanbul", phone: "5330000000" },
  { name: "Beta Tedarik", type: "supplier", tax_number_or_id: "1234567890" },
  { name: "Gama Ltd", type: "both", company_title: "Gama Ticaret" },
  { name: "Delta", city: "Ankara" },
];

describe("contactFilters", () => {
  it("offers only the three type chips", () => {
    expect(CONTACT_TYPE_FILTERS.map((f) => f.key)).toEqual(["all", "customer", "supplier"]);
  });

  it("shows 'both' contacts under customer and supplier", () => {
    expect(matchesContactType("both", "customer")).toBe(true);
    expect(matchesContactType("both", "supplier")).toBe(true);
    expect(matchesContactType("supplier", "customer")).toBe(false);
    expect(matchesContactType(undefined, "customer")).toBe(true);
    expect(matchesContactType("supplier", "all")).toBe(true);
  });

  it("searches name, title, phone, tax number and city", () => {
    expect(matchesContactSearch(rows[0], "acme")).toBe(true);
    expect(matchesContactSearch(rows[1], "123456")).toBe(true);
    expect(matchesContactSearch(rows[2], "ticaret")).toBe(true);
    expect(matchesContactSearch(rows[3], "ankara")).toBe(true);
    expect(matchesContactSearch(rows[0], "  ")).toBe(true);
    expect(matchesContactSearch(rows[0], "yok")).toBe(false);
  });

  it("combines type and search and caps the list", () => {
    expect(filterContacts(rows, "supplier", "").map((c) => c.name)).toEqual(["Beta Tedarik", "Gama Ltd"]);
    expect(filterContacts(rows, "customer", "gama").map((c) => c.name)).toEqual(["Gama Ltd"]);
    expect(filterContacts(rows, "all", "", 2)).toHaveLength(2);
  });
});

import { CONTACT_SEARCH_DEBOUNCE_MS, CONTACT_SEARCH_PAGE_SIZE, contactSearchQuery } from "./contactSearch";

describe("contactSearchQuery", () => {
  it("debounces at 300ms and pages 20 rows", () => {
    expect(CONTACT_SEARCH_DEBOUNCE_MS).toBe(300);
    expect(CONTACT_SEARCH_PAGE_SIZE).toBe(20);
  });

  it("sends firma adı suggest, counterparty and exclude_type to the server", () => {
    expect(contactSearchQuery({
      companyId: "c1",
      q: "mor",
      page: 2,
      suggest: "Firma Adı: MOR PLASTIK ISTANBUL",
      counterparty: "MOR PLASTIK",
      excludeType: "customer",
    })).toEqual({
      company_id: "c1",
      q: "mor",
      page: 2,
      limit: 20,
      suggest: "Firma Adı: MOR PLASTIK ISTANBUL",
      counterparty: "MOR PLASTIK",
      exclude_type: "customer",
    });
  });

  it("omits blank suggest fields", () => {
    expect(contactSearchQuery({ companyId: "c1", q: "  ", suggest: "  ", counterparty: "" })).toEqual({
      company_id: "c1",
      q: "",
      page: 1,
      limit: 20,
    });
  });
});

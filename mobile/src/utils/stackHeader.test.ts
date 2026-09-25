import { headerBackAction, stackHeaderFallback } from "./stackHeader";

describe("headerBackAction", () => {
  it("goes back when the stack has history", () => {
    expect(headerBackAction(true, "/surveys")).toBe("back");
  });

  it("falls back to the list when there is no history", () => {
    expect(headerBackAction(false, "/surveys")).toBe("/surveys");
  });
});

describe("stackHeaderFallback", () => {
  it("sends list and root screens home", () => {
    expect(stackHeaderFallback("contacts/index")).toBe("/");
    expect(stackHeaderFallback("search")).toBe("/");
    expect(stackHeaderFallback("settings")).toBe("/");
    expect(stackHeaderFallback("edoc-inbox/index")).toBe("/");
  });

  it("sends detail and form screens to their list", () => {
    expect(stackHeaderFallback("contacts/[id]")).toBe("/contacts");
    expect(stackHeaderFallback("contacts/new")).toBe("/contacts");
    expect(stackHeaderFallback("contacts/edit/[id]")).toBe("/contacts");
    expect(stackHeaderFallback("contacts/statement/[id]")).toBe("/contacts");
    expect(stackHeaderFallback("invoices/[id]")).toBe("/invoices");
    expect(stackHeaderFallback("banking/virman")).toBe("/banking");
    expect(stackHeaderFallback("sayim/[id]")).toBe("/sayim");
  });

  it("sends stock cards to the Stok tab", () => {
    expect(stackHeaderFallback("stock/[id]")).toBe("/stok");
    expect(stackHeaderFallback("stock/new")).toBe("/stok");
  });
});

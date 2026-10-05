import { openChequeBalance } from "./chequeBalance";

describe("openChequeBalance", () => {
  it("ignores BizimHesap snapshot when there are no live cheques", () => {
    expect(openChequeBalance([])).toBe(0);
    expect(openChequeBalance(undefined)).toBe(0);
  });

  it("uses open received minus open issued", () => {
    expect(openChequeBalance([
      { status: "open", direction: "received", amount: 177924.83 },
      { status: "open", direction: "issued", amount: 1000 },
      { status: "collected", direction: "received", amount: 50000 },
    ])).toBe(176924.83);
  });

  it("treats missing status as open", () => {
    expect(openChequeBalance([{ direction: "received", amount: 250 }])).toBe(250);
  });
});

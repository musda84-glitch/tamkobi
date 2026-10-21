import { endorsedIncomingOpen, openChequeBalance } from "./chequeBalance";

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

  it("adds not-yet-due endorsed incoming cheques and skips overdue or bounced", () => {
    const rows = [
      { role: "endorsee", status: "endorsed", direction: "received", amount: 250000, due_date: "2026-11-30" },
      { role: "endorsee", status: "endorsed", direction: "received", amount: 120000, due_date: "2026-12-15" },
      { role: "endorsee", status: "endorsed", direction: "received", amount: 75000, due_date: "2020-01-01" },
      { role: "endorsee", status: "bounced", direction: "received", amount: 10, due_date: "2026-12-01" },
      { status: "endorsed", direction: "received", amount: 999, due_date: "2026-12-01" },
    ];
    expect(openChequeBalance(rows, "2026-10-21")).toBe(370000);
    expect(endorsedIncomingOpen(rows, "2026-10-21")).toHaveLength(2);
  });
});

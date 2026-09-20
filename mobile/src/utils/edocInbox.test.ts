import { edocKindTr, edocRowSubtitle, edocRowTitle, edocStatusTr, isEdocProcessable, pendingEdocCount } from "./edocInbox";

describe("edocInbox", () => {
  it("labels status and kind like the web inbox", () => {
    expect(edocStatusTr("pending")).toBe("Bekliyor");
    expect(edocStatusTr("approved")).toBe("İçeri alındı");
    expect(edocStatusTr("rejected")).toBe("Reddedildi");
    expect(edocKindTr("invoice")).toBe("e-Fatura");
    expect(edocKindTr("dispatch")).toBe("e-İrsaliye");
  });

  it("builds a list row from supplier, number and totals", () => {
    const doc = {
      status: "pending",
      kind: "invoice",
      number: "GIB20260009",
      issue_date: "2026-09-20",
      grand_total: 1250,
      supplier: { name: "Woks Mobilya", tax_id: "123" },
      lines: [{ name: "Raf" }, { name: "Klasör" }],
      matched_lines: 1,
    };
    expect(edocRowTitle(doc)).toBe("Woks Mobilya");
    expect(edocRowSubtitle(doc)).toContain("e-Fatura");
    expect(edocRowSubtitle(doc)).toContain("GIB20260009");
    expect(edocRowSubtitle(doc)).toContain("1/2 satır");
    expect(isEdocProcessable(doc)).toBe(true);
  });

  it("blocks blank pending docs from one-tap process", () => {
    expect(isEdocProcessable({ status: "pending" })).toBe(false);
    expect(isEdocProcessable({ status: "approved", grand_total: 10, supplier: { name: "A" }, lines: [{}] })).toBe(false);
    expect(pendingEdocCount({ pending: 4, approved: 2 })).toBe(4);
    expect(pendingEdocCount(null)).toBe(0);
  });
});

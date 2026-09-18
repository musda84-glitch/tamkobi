import { chequeAction, chequeStatusTr, chequeTitle, chequeTone, filterCheques, type Cheque } from "./cheques";

const rows: Cheque[] = [
  { id: "1", number: "CEK-2026-0001", instrument: "cheque", direction: "received", status: "open", contact_name: "Acme", bank_name: "Vakıf", amount: 1000, overdue: true },
  { id: "2", number: "SNT-2026-0002", instrument: "promissory", direction: "issued", status: "open", contact_name: "Beta", amount: 500, due_soon: true },
  { id: "3", number: "CEK-2026-0003", instrument: "cheque", direction: "received", status: "collected", status_label: "Tahsil edildi", contact_name: "Gama", amount: 250 },
  { id: "4", number: "CEK-2026-0004", instrument: "cheque", direction: "received", status: "bounced", contact_name: "Delta", amount: 900 },
];

describe("cheques", () => {
  it("names the record by instrument and direction", () => {
    expect(chequeTitle(rows[0])).toBe("CEK-2026-0001 · alınan çek");
    expect(chequeTitle(rows[1])).toBe("SNT-2026-0002 · verilen senet");
  });

  it("uses the server label when present", () => {
    expect(chequeStatusTr(rows[2])).toBe("Tahsil edildi");
    expect(chequeStatusTr({ status: "endorsed" })).toBe("Ciro edildi");
    expect(chequeStatusTr({ status: "open" })).toBe("Portföy / Açık");
  });

  it("offers collect for received and pay for issued, only while open", () => {
    expect(chequeAction(rows[0])).toEqual({ path: "collect", label: "Tahsil et" });
    expect(chequeAction(rows[1])).toEqual({ path: "pay", label: "Öde" });
    expect(chequeAction(rows[2])).toBeNull();
    expect(chequeAction(rows[3])).toBeNull();
  });

  it("tones rows by settlement and due state", () => {
    expect(chequeTone(rows[0])).toBe("red");
    expect(chequeTone(rows[1])).toBe("amber");
    expect(chequeTone(rows[2])).toBe("green");
    expect(chequeTone(rows[3])).toBe("red");
    expect(chequeTone({ status: "open" })).toBe("slate");
  });

  it("filters by direction, open state, overdue and free text", () => {
    expect(filterCheques(rows, "received", "").map((r) => r.id)).toEqual(["1", "3", "4"]);
    expect(filterCheques(rows, "issued", "").map((r) => r.id)).toEqual(["2"]);
    expect(filterCheques(rows, "open", "").map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterCheques(rows, "overdue", "").map((r) => r.id)).toEqual(["1"]);
    expect(filterCheques(rows, "all", "vakıf").map((r) => r.id)).toEqual(["1"]);
    expect(filterCheques(rows, "all", "beta").map((r) => r.id)).toEqual(["2"]);
  });
});

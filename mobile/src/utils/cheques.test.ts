import {
  applyChequePrefill,
  chequeAction,
  chequeReturnContact,
  chequeLedgerLocked,
  chequePayload,
  chequeReceiptKind,
  chequeReceiptLabel,
  chequeStatusTr,
  chequeTitle,
  chequeTone,
  draftFromCheque,
  emptyChequeDraft,
  filterCheques,
  validateChequeDraft,
  type Cheque,
} from "./cheques";

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

  it("validates a new cheque before posting", () => {
    const d = emptyChequeDraft("2026-09-18");
    expect(validateChequeDraft(d)).toBe("Cari seçin.");
    d.contact_id = "c1";
    expect(validateChequeDraft(d)).toBe("Tutar sıfırdan büyük olmalı.");
    d.amount = "1500,50";
    expect(validateChequeDraft(d)).toBeNull();
    expect(validateChequeDraft({ ...d, due_date: "18.09.2026" })).toMatch(/Vade/);
    expect(validateChequeDraft({ ...d, issue_date: "2026-09-20" })).toMatch(/keşide/);
  });

  it("builds the create payload the API expects", () => {
    const d = emptyChequeDraft("2026-09-18");
    const body = chequePayload(
      { ...d, contact_id: "c1", contact_name: "Acme", amount: "1500,50", due_date: "2026-10-18", instrument: "promissory", direction: "issued", serial_no: " snt-9 " },
      "comp1"
    );
    expect(body).toMatchObject({
      company_id: "comp1",
      direction: "issued",
      instrument: "promissory",
      contact_id: "c1",
      amount: 1500.5,
      due_date: "2026-10-18",
      serial_no: "snt-9",
    });
    expect(body.drawer_name).toBe("");
  });

  it("builds an edit draft from a saved cheque", () => {
    const d = draftFromCheque({
      ...rows[0],
      contact_id: "c1",
      serial_no: "123456",
      issue_date: "2026-09-21",
      due_date: "2026-10-21",
      notes: "portföy",
    }, "2026-09-21");
    expect(d.serial_no).toBe("123456");
    expect(d.amount).toBe("1000");
    expect(d.contact_id).toBe("c1");
    expect(d.due_date).toBe("2026-10-21");
    expect(chequeLedgerLocked(rows[0])).toBe(false);
    expect(chequeLedgerLocked(rows[2])).toBe(true);
    expect(chequeReceiptKind(rows[0])).toBe("collection");
    expect(chequeReceiptKind(rows[1])).toBe("payment");
    expect(chequeReceiptLabel(rows[0])).toBe("Tahsilat makbuzu");
    expect(chequeReceiptLabel(rows[1])).toBe("Tediye makbuzu");
  });

  it("filters by direction, open state, overdue and free text", () => {
    expect(filterCheques(rows, "received", "").map((r) => r.id)).toEqual(["1", "3", "4"]);
    expect(filterCheques(rows, "issued", "").map((r) => r.id)).toEqual(["2"]);
    expect(filterCheques(rows, "open", "").map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterCheques(rows, "overdue", "").map((r) => r.id)).toEqual(["1"]);
    expect(filterCheques(rows, "all", "vakıf").map((r) => r.id)).toEqual(["1"]);
    expect(filterCheques(rows, "all", "beta").map((r) => r.id)).toEqual(["2"]);
  });

  it("prefills a new cheque from the cari collect form", () => {
    const d = applyChequePrefill(emptyChequeDraft("2026-09-21"), {
      contact_id: "c9",
      contact_name: "Acme",
      instrument: "promissory",
      direction: "issued",
      amount: "250",
      notes: "Senet ödemesi",
    });
    expect(d).toMatchObject({
      contact_id: "c9",
      contact_name: "Acme",
      instrument: "promissory",
      direction: "issued",
      amount: "250",
      notes: "Senet ödemesi",
    });
    expect(chequeReturnContact({ contact_id: "c9", contact_name: "Acme" })).toEqual({ id: "c9", name: "Acme" });
    expect(chequeReturnContact({})).toBeNull();
  });
});

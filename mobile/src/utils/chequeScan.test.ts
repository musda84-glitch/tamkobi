import { emptyChequeDraft } from "./cheques";
import { applyChequeScan, CHEQUE_SCAN_IDLE_HINT, chequeAmountInput, chequeScanHint, chequeScanNavParams } from "./chequeScan";

describe("chequeScan", () => {
  it("formats amounts", () => {
    expect(chequeAmountInput(50000)).toBe("50000");
    expect(chequeAmountInput(1250.5)).toBe("1250,50");
  });

  it("applies a scan onto the new-cheque draft", () => {
    const next = applyChequeScan(emptyChequeDraft("2026-09-21"), {
      instrument: "cheque",
      direction: "received",
      amount: 50000,
      serial_no: "1234567",
      bank_name: "Garanti BBVA",
      due_date: "2026-09-21",
      drawer_name: "ERSAY HOME",
    });
    expect(next).toMatchObject({
      amount: "50000",
      serial_no: "1234567",
      bank_name: "Garanti BBVA",
      due_date: "2026-09-21",
      drawer_name: "ERSAY HOME",
      direction: "received",
    });
  });

  it("prefills matched contact and nav params", () => {
    const draft = { amount: 250, instrument: "promissory", direction: "issued", serial_no: "S-9" };
    const match = { id: "c9", name: "Acme" };
    expect(applyChequeScan(emptyChequeDraft("2026-09-21"), draft, match).contact_id).toBe("c9");
    expect(chequeScanNavParams(draft, match)).toMatchObject({
      contact_id: "c9",
      contact_name: "Acme",
      instrument: "promissory",
      direction: "issued",
      amount: "250",
      serial_no: "S-9",
    });
    expect(chequeScanHint(draft)).toBe("verilen senet okundu · 250 ₺");
    expect(CHEQUE_SCAN_IDLE_HINT).toMatch(/yapay zeka/i);
  });
});

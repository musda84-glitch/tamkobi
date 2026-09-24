import { applyChequeScan, CHEQUE_SCAN_IDLE_HINT, chequeAmountInput, chequeScanHint } from "./chequeScan";

describe("chequeScan", () => {
  it("applies scan fields onto the web cheque modal", () => {
    expect(chequeAmountInput(50000)).toBe("50000");
    expect(applyChequeScan(
      { direction: "received", instrument: "cheque", contact_id: "", amount: "", serial_no: "", bank_name: "" },
      { amount: 50000, serial_no: "1234567", bank_name: "Garanti", direction: "received" },
    )).toMatchObject({
      amount: "50000",
      serial_no: "1234567",
      bank_name: "Garanti",
    });
    expect(chequeScanHint({ amount: 250, instrument: "promissory", direction: "issued" }))
      .toBe("verilen senet okundu · 250 ₺");
    expect(CHEQUE_SCAN_IDLE_HINT).toMatch(/yapay zeka/i);
  });
});

import { chequeAsReceiptTx, receiptPrintHtml } from "./receiptPrint";

const cheque = {
  id: "chk-aa11bb22",
  number: "CEK-2026-0009",
  serial_no: "123456",
  instrument: "cheque",
  direction: "received",
  status: "open",
  contact_name: "Hatice YILDIRIM",
  amount: 50,
  issue_date: "2026-09-21",
  due_date: "2026-09-21",
};

describe("receiptPrint", () => {
  it("builds a tahsilat makbuzu from a received cheque", () => {
    const tx = chequeAsReceiptTx(cheque);
    expect(tx.type).toBe("inflow");
    expect(tx.account_name).toBe("Çek Portföyü");
    expect(tx.category).toBe("Alınan Çek");
    expect(tx.description).toContain("123456");
    expect(tx.description).toContain("CEK-2026-0009");
    const html = receiptPrintHtml(tx, { name: "Matek", tax_office: "Kadıköy", tax_number: "123", address: "Atölye", city: "İstanbul", phone: "0212" }, { name: "Hatice YILDIRIM", tax_number_or_id: "111" });
    expect(html).toContain("TAHSİLAT MAKBUZU");
    expect(html).toContain("MKB-CHKAA11B");
    expect(html).toContain("Hatice YILDIRIM");
    expect(html).toContain("Çek Portföyü");
    expect(html).toContain("Alınan Çek");
    expect(html).toContain("50,00");
    expect(html).toContain("Teslim Eden");
    expect(html).toContain("Teslim Alan");
    expect(html).toContain("Matek");
    expect(html).not.toContain("window.print");
  });

  it("uses tediye wording for an issued cheque", () => {
    const html = receiptPrintHtml(
      chequeAsReceiptTx({ ...cheque, direction: "issued", status: "paid", account_name: "Kasa" }),
      { name: "Matek" },
    );
    expect(html).toContain("TEDİYE MAKBUZU");
    expect(html).toContain("Çek/Senet Ödemesi");
    expect(html).toContain("Kasa");
  });
});

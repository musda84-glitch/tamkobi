import { balanceMessage, buildStatementRows, smsBalanceText, statementPrintHtml, statementText, waDigits } from "./contactStatement";

describe("contactStatement", () => {
  it("builds debit/credit rows and running balance like web", () => {
    const rows = buildStatementRows({
      invoices: [
        { invoice_number: "SF-1", invoice_type: "sales", issue_date: "2026-01-02", grand_total: 100, status: "approved" },
        { invoice_number: "AF-1", invoice_type: "purchase", issue_date: "2026-01-03", grand_total: 40, status: "approved" },
        { invoice_number: "X", invoice_type: "sales", issue_date: "2026-01-01", grand_total: 9, status: "cancelled" },
      ],
      payments: [
        { type: "inflow", date: "2026-01-04", amount: 30, account_name: "Kasa", description: "tahsilat" },
        { type: "transfer", date: "2026-01-04", amount: 1, account_name: "Virman" },
      ],
    });
    expect(rows.map((r) => r.kind)).toEqual(["invoice", "invoice", "payment"]);
    expect(rows[0].debit).toBe(100);
    expect(rows[1].credit).toBe(40);
    expect(rows[2].credit).toBe(30);
    expect(rows[2].balance).toBe(30);
  });

  it("writes share text and wa digits", () => {
    const rows = buildStatementRows({
      invoices: [{ invoice_number: "SF-1", invoice_type: "sales", issue_date: "2026-01-02", grand_total: 50, status: "approved" }],
    });
    const text = statementText({ name: "Acme", balance: 50 }, rows, "TamKobi");
    expect(text).toContain("TamKobi - Cari Hesap Ekstresi");
    expect(text).toContain("Sayın Acme");
    expect(text).toContain("02.01.2026");
    expect(text).not.toContain("2026-01-02");
    expect(text).toContain("SF-1");
    expect(smsBalanceText({ name: "Acme", balance: 50 })).toMatch(/borç/);
    expect(balanceMessage({ name: "Acme", balance: 50 })).toMatch(/cari hesap bakiyeniz/);
    expect(waDigits("0533 713 39 34")).toBe("905337133934");
  });

  it("prints the statement as a table, not only share text", () => {
    const rows = buildStatementRows({
      invoices: [{ invoice_number: "SF-1", invoice_type: "sales", issue_date: "2026-01-02", grand_total: 50, status: "approved" }],
    });
    const html = statementPrintHtml({ name: "Acme", tax_number_or_id: "123", balance: 50 }, rows, "TamKobi");
    expect(html).toContain("CARİ HESAP EKSTRESİ");
    expect(html).toContain("02.01.2026");
    expect(html).not.toContain("2026-01-02");
    expect(html).toContain("SF-1");
    expect(html).toContain("VKN/TCKN: 123");
    expect(html).toContain("TamKobi");
    expect(html).toContain("TOPLAM");
    expect(html).toContain("<table");
  });

  it("adds cheque lines only on the detailed ekstre", () => {
    const data = {
      invoices: [{ invoice_number: "SF-1", invoice_type: "sales" as const, issue_date: "2026-01-02", grand_total: 50, status: "approved" }],
      cheques: [{ instrument: "cheque", direction: "received", amount: 20, due_date: "2026-01-05", serial_no: "CK-1", bank_name: "Ziraat" }],
    };
    expect(buildStatementRows(data).map((r) => r.kind)).toEqual(["invoice"]);
    const detailed = buildStatementRows(data, { includeCheques: true });
    expect(detailed.map((r) => r.kind)).toEqual(["invoice", "cheque"]);
    expect(detailed[1].doc).toContain("Alınan Çek");
    expect(detailed[1].credit).toBe(20);
  });

  it("prints a mutabakat mektubu heading", () => {
    const html = statementPrintHtml({ name: "Acme" }, [], "TamKobi", { variant: "reconciliation" });
    expect(html).toContain("CARİ HESAP MUTABAKAT MEKTUBU");
    expect(html).toContain("mutabakatını rica ederiz");
    expect(html).toContain("mutabakat mektubu");
  });
});

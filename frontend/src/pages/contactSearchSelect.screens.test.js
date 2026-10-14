const fs = require("fs");
const path = require("path");

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");

describe("ContactSearchSelect ekranları", () => {
  test("teklif formu ContactSearchSelect kullanır", () => {
    const src = read("ProjectsPage.jsx");
    expect(src).toContain('from "../components/ContactSearchSelect"');
    expect(src).toMatch(/<ContactSearchSelect[\s\S]*testId="pf-contact"/);
    expect(src).toContain('form.kind === "quote"');
    expect(src).toContain("Yeni Teklif");
  });

  test("irsaliye (fatura) formu ContactSearchSelect kullanır", () => {
    const src = read("InvoicesPage.jsx");
    expect(src).toContain('from "../components/ContactSearchSelect"');
    expect(src).toMatch(/<ContactSearchSelect[\s\S]*testId="inv-contact-select"/);
    expect(src).toContain('invoice_type: "dispatch"');
    expect(src).toContain('e_type: "e_dispatch"');
  });

  test("çek, gelen belge ve saha cari seçicileri ContactSearchSelect", () => {
    const cheques = read("ChequesPage.jsx");
    expect(cheques).toContain('from "../components/ContactSearchSelect"');
    expect(cheques).toMatch(/<ContactSearchSelect[\s\S]*testId="cheque-contact"/);
    expect(cheques).toMatch(/<ContactSearchSelect[\s\S]*testId="cheque-endorse-contact"/);
    expect(cheques).not.toMatch(/<select[^>]*data-testid="cheque-contact"/);
    expect(cheques).not.toMatch(/<select[^>]*data-testid="cheque-endorse-contact"/);

    const inbox = read("EdocInboxPage.jsx");
    expect(inbox).toContain('from "../components/ContactSearchSelect"');
    expect(inbox).toMatch(/<ContactSearchSelect[\s\S]*testId="edoc-supplier-select"/);

    const saha = read("FieldSalesPage.jsx");
    expect(saha).toContain('from "../components/ContactSearchSelect"');
    expect(saha).toMatch(/<ContactSearchSelect[\s\S]*testId="saha-customer-search"/);
    expect(saha).not.toContain("custHits");
  });

  test("banka eşleşme, ekstre ve kural carisi ContactSearchSelect", () => {
    const modal = fs.readFileSync(path.join(__dirname, "../components/BankMatchModal.jsx"), "utf8");
    expect(modal).toContain('from "./ContactSearchSelect"');
    expect(modal).toContain('emptyLabel="Cari seçin (boş = sadece onayla)"');
    expect(modal).toContain("suggestText={tx.description");
    expect(modal).not.toMatch(/<select[^>]*tx-match-contact/);

    const row = fs.readFileSync(path.join(__dirname, "../components/BankMatchRow.jsx"), "utf8");
    expect(row).toContain("suggestText={tx.description");
    expect(row).toContain('emptyLabel="Cari seçin (boş = onayla)"');

    const stmt = fs.readFileSync(path.join(__dirname, "../components/CardStatementImport.jsx"), "utf8");
    expect(stmt).toContain('from "./ContactSearchSelect"');
    expect(stmt).toContain("suggestText={t.description");
    expect(stmt).not.toMatch(/<select[^>]*contact-/);

    const rules = fs.readFileSync(path.join(__dirname, "../components/BankConnectionsPanel.jsx"), "utf8");
    expect(rules).toContain('testId="rule-contact-select"');
    expect(rules).not.toMatch(/<select[^>]*rule-contact-select/);
  });
});

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
});

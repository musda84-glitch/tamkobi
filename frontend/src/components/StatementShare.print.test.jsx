/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { StatementPrint, StatementShareBar, buildStatementRows } from "./StatementShare";
import { StatementTxList, StatementViewProvider } from "./StatementTxList";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test",
  useAuth: () => ({ activeCompany: { name: "TamKobi", currency: "TRY", city: "İstanbul" } }),
}));
jest.mock("../utils/statementShare", () => ({
  downloadStatementPdf: jest.fn(),
  fetchStatementShare: jest.fn(),
  statementPdfFile: jest.fn(),
}));
jest.mock("./QuickMessageModal", () => ({ QuickMessageModal: () => null }));

const FULL = [
  { date: "2026-10-01", doc: "SF-1 • Satış Faturası", debit: 100, credit: 0, balance: 100, kind: "invoice", einvoice_state: "sent", e_type: "e_invoice" },
  { date: "2026-10-02", doc: "Tahsilat • Nakit", debit: 0, credit: 40, balance: 60, kind: "payment" },
  { date: "2026-10-03", doc: "AF-1 • Alış Faturası", debit: 0, credit: 25, balance: 35, kind: "invoice", einvoice_state: "received", e_type: "e_archive" },
];

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  host.remove();
});

function printRows() {
  return [...host.querySelectorAll('[data-testid^="statement-print-row-"]')].map((row) => row.textContent);
}

test("ekstre satırı ortak ödemesini Ortaklar Hesabı ve ortak adıyla gösterir", () => {
  const built = buildStatementRows({
    invoices: [{ invoice_number: "FYS2026000002251", invoice_type: "purchase", grand_total: 70000, issue_date: "2026-09-01", status: "approved" }],
    payments: [{ type: "outflow", amount: 70000, date: "2026-10-10", account_name: "Ortaklar Hesabı · Ali Veli", description: "Cari ödeme", source: "partner" }],
  });
  expect(built.some((row) => String(row.doc).includes("Ortaklar Hesabı · Ali Veli"))).toBe(true);
});

test("iade faturası İade Faturası yazar ve borç/alacak yönü türe göredir", () => {
  const supplier = buildStatementRows({
    contact: { type: "supplier" },
    invoices: [
      { invoice_number: "IF-1", invoice_type: "return", grand_total: 999.58, issue_date: "2026-05-01", status: "approved" },
      { invoice_number: "SF-1", invoice_type: "sales", grand_total: 10, issue_date: "2026-05-02", status: "approved" },
      { invoice_number: "AF-1", invoice_type: "purchase", grand_total: 20, issue_date: "2026-05-03", status: "approved" },
      { invoice_number: "SI-1", invoice_type: "sales_return", grand_total: 5, issue_date: "2026-05-04", status: "approved" },
      { invoice_number: "AI-1", invoice_type: "purchase_return", grand_total: 7, issue_date: "2026-05-05", status: "approved" },
    ],
    payments: [],
  });
  expect(supplier.map((row) => row.doc)).toEqual([
    "IF-1 • İade Faturası",
    "SF-1 • Satış Faturası",
    "AF-1 • Alış Faturası",
    "SI-1 • İade Faturası",
    "AI-1 • İade Faturası",
  ]);
  expect(supplier[0].debit).toBe(999.58);
  expect(supplier[0].credit).toBe(0);
  expect(supplier[1].debit).toBe(10);
  expect(supplier[1].credit).toBe(0);
  expect(supplier[2].debit).toBe(0);
  expect(supplier[2].credit).toBe(20);
  expect(supplier[3].debit).toBe(0);
  expect(supplier[3].credit).toBe(5);
  expect(supplier[4].debit).toBe(7);
  expect(supplier[4].credit).toBe(0);
  expect(supplier[4].balance).toBeCloseTo(999.58 + 10 - 20 - 5 + 7, 2);

  const customer = buildStatementRows({
    contact: { type: "customer" },
    invoices: [
      { invoice_number: "IF-2", invoice_type: "return", grand_total: 40, issue_date: "2026-05-01", status: "approved", direction: "incoming" },
    ],
    payments: [],
  });
  expect(customer[0].doc).toBe("IF-2 • İade Faturası");
  expect(customer[0].debit).toBe(0);
  expect(customer[0].credit).toBe(40);
  expect(customer[0].balance).toBe(-40);
});

test("buildStatementRows GİB alanlarını kopyalar, uuid ve bakiye hesabı aynı kalır", () => {
  const built = buildStatementRows({
    invoices: [
      { invoice_number: "SF-1", invoice_type: "sales", grand_total: 80, issue_date: "2026-05-01", status: "approved", einvoice_state: "sent", e_type: "e_invoice", gib_uuid: "uuid-1", gib_status: "İletildi" },
      { invoice_number: "IPTAL", invoice_type: "sales", grand_total: 5, issue_date: "2026-05-01", status: "cancelled", einvoice_state: "draft" },
    ],
    payments: [{ type: "inflow", amount: 30, date: "2026-05-02", account_name: "Kasa" }],
  });
  expect(built[0].einvoice_state).toBe("sent");
  expect(built[0].e_type).toBe("e_invoice");
  expect(built[0].has_gib_uuid).toBe(true);
  expect(built[0].gib_uuid).toBeUndefined();
  expect(built[0].gib_status).toBeUndefined();
  expect(built[0].balance).toBe(80);
  expect(built[1].balance).toBe(50);
  expect(built[1].kind).toBe("payment");
});

test("varsayılan baskı tam kronolojik liste, Filtreyi uygula yalnız görünen satırları basar", () => {
  root = createRoot(host);
  act(() => {
    root.render(
      <StatementViewProvider>
        <StatementShareBar contact={{ id: "c1", name: "Ada", balance: 35, currency: "TRY" }} rows={FULL} companyId="co" />
        <StatementTxList rows={FULL} tableTestId="statement-table" rowTestId={(_r, i) => `statement-row-${i}`} />
      </StatementViewProvider>,
    );
  });
  act(() => host.querySelector('[data-testid="statement-table-filter-side-credit"]').click());
  expect(host.querySelector('tr[data-testid="statement-row-0"]').textContent).toMatch(/Tahsilat/);
  act(() => host.querySelector('[data-testid="statement-print-btn"]').click());
  expect(printRows()).toHaveLength(3);
  expect(printRows()[0]).toMatch(/SF-1/);
  expect(printRows()[0]).toMatch(/100,00/);
  expect(printRows()[2]).toMatch(/35,00/);
  expect(host.querySelector('[data-testid="statement-print-filter-note"]')).toBeNull();
  expect(host.querySelector('[data-testid="statement-print-gib-0"]').textContent).toBe("GİB");
  expect(host.querySelector('[data-testid="statement-print-gib-2"]').getAttribute("title")).toBe("e-Arşiv");

  act(() => host.querySelector('[data-testid="statement-print-apply-filter"] input').click());
  expect(printRows()).toHaveLength(2);
  expect(printRows()[0]).toMatch(/Tahsilat/);
  expect(printRows()[0]).toMatch(/60,00/);
  expect(printRows()[1]).toMatch(/Alış Faturası/);
  expect(printRows()[1]).toMatch(/35,00/);
  expect(printRows().join(" ")).not.toMatch(/SF-1/);
  expect(host.querySelector('[data-testid="statement-print-filter-note"]').textContent).toMatch(/Filtre uygulandı/);
  expect(host.querySelector('[data-testid="statement-print-total-credit"]').textContent).toMatch(/65,00/);
  expect(host.querySelector('[data-testid="statement-print-total-debit"]').textContent).toMatch(/0,00/);
  expect(host.querySelector('[data-testid="statement-print-net"]').textContent).toMatch(/Filtrelenen net/);
  expect(host.querySelector('[data-testid="statement-print-net"]').textContent).toMatch(/-65,00/);
  expect(host.querySelector('[data-testid="statement-print-gib-1"]').textContent).toBe("GİB");
});

test("StatementPrint filtresiz toplamda son yürüyen bakiyeyi kullanır", () => {
  root = createRoot(host);
  act(() => {
    root.render(
      <StatementPrint contact={{ name: "Ada", balance: 35 }} company={{ name: "TamKobi" }} rows={FULL} onClose={() => {}} />,
    );
  });
  expect(host.querySelector('[data-testid="statement-print-apply-filter"]')).toBeNull();
  expect(printRows()).toHaveLength(3);
  expect(host.querySelector("#print-area").textContent).toMatch(/35,00/);
  expect(host.querySelector('[data-testid="statement-print-filter-note"]')).toBeNull();
});

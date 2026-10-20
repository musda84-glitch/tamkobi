/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { StatementTxList } from "./StatementTxList";
import { txMobileListGuards } from "../utils/txMobileOverflow";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  host.style.width = "375px";
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

test("cari ekstre 375px kartlarında belge açıklaması kırılır, masaüstü tablo durur", () => {
  const rows = [
    {
      kind: "invoice",
      date: "2026-10-01",
      doc: `FAT-2026-0001 ${"UzunBelgeAciklamasi".repeat(20)}`,
      debit: 15000,
      credit: 0,
      balance: 15000,
    },
    {
      kind: "payment",
      date: "2026-10-05",
      doc: "Tahsilat",
      debit: 0,
      credit: 4000,
      balance: 11000,
    },
  ];
  const root = createRoot(host);
  act(() => root.render(<StatementTxList rows={rows} tableTestId="statement-table" showKindDot />));
  expect(txMobileListGuards(host)).toEqual({ ok: true, reason: "" });
  expect(host.querySelector('[data-testid="statement-table-cards"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="statement-table"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="statement-table-cards"]').textContent).toMatch(/Borç|Alacak/);
  expect(host.querySelector('[data-testid="statement-table-cards"]').textContent).toMatch(/15/);
});

function setValue(el, value) {
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const ORDER = [
  { date: "2026-10-01", doc: "SF-1 • Satış Faturası", debit: 100, credit: 0, balance: 100, kind: "invoice", einvoice_state: "sent", e_type: "e_invoice" },
  { date: "2026-10-02", doc: "Tahsilat • Havale özel", debit: 0, credit: 40, balance: 60, kind: "payment" },
  { date: "2026-10-03", doc: "Ödeme • Kira", debit: 10, credit: 0, balance: 70, kind: "payment" },
  { date: "2026-10-04", doc: "AF-1 • Alış Faturası", debit: 0, credit: 15, balance: 55, kind: "invoice", einvoice_state: "draft", e_type: "e_archive" },
];

function renderList(props) {
  const root = createRoot(host);
  act(() => root.render(
    <StatementTxList rows={ORDER} tableTestId="statement-table" rowTestId={(_r, i) => `statement-row-${i}`} {...props} />,
  ));
  return root;
}

function cellText(row, index) {
  return host.querySelector(`[data-testid="statement-row-${row}"]`).querySelectorAll("td")[index].textContent;
}

test("varsayılan sıra kronolojik kalır, BAKİYE sıralaması aria-sort ve oku değiştirir", () => {
  const root = renderList();
  expect(cellText(0, 1)).toMatch(/SF-1/);
  expect(cellText(0, 4)).toMatch(/100,00/);
  expect(cellText(1, 4)).toMatch(/60,00/);
  const dateTh = host.querySelector('[data-testid="statement-table-sort-date"]').closest("th");
  expect(dateTh.getAttribute("aria-sort")).toBe("ascending");
  expect(host.querySelector('[data-testid="statement-table-sort-date"] svg').getAttribute("class")).toMatch(/arrow-up/);

  const balanceBtn = host.querySelector('[data-testid="statement-table-sort-balance"]');
  const balanceTh = balanceBtn.closest("th");
  expect(balanceTh.getAttribute("aria-sort")).toBe("none");
  act(() => balanceBtn.click());
  expect(balanceTh.getAttribute("aria-sort")).toBe("ascending");
  expect(balanceBtn.getAttribute("data-sort-dir")).toBe("asc");
  expect(balanceBtn.querySelector("svg").getAttribute("class")).toMatch(/arrow-up/);
  expect(cellText(0, 4)).toMatch(/55,00/);
  expect(cellText(0, 1)).toMatch(/Alış Faturası/);
  act(() => balanceBtn.click());
  expect(balanceTh.getAttribute("aria-sort")).toBe("descending");
  expect(balanceBtn.querySelector("svg").getAttribute("class")).toMatch(/arrow-down/);
  expect(cellText(0, 4)).toMatch(/100,00/);
  expect(cellText(0, 1)).toMatch(/SF-1/);
  root.unmount();
});

test("Yeni→Eski sırayı ters çevirir, BAKİYE hücresi satırında kalır", () => {
  const root = renderList();
  const toggle = host.querySelector('[data-testid="statement-table-order-toggle"]');
  expect(toggle.textContent).toMatch(/Eski→Yeni/);
  act(() => toggle.click());
  expect(toggle.textContent).toMatch(/Yeni→Eski/);
  expect(host.querySelector('[data-testid="statement-table-sort-date"]').closest("th").getAttribute("aria-sort")).toBe("descending");
  expect(cellText(0, 1)).toMatch(/Alış Faturası/);
  expect(cellText(0, 4)).toMatch(/55,00/);
  expect(cellText(3, 1)).toMatch(/SF-1/);
  expect(cellText(3, 4)).toMatch(/100,00/);
  expect(host.querySelector('[data-testid="statement-table-cards"]').textContent.indexOf("Alış Faturası"))
    .toBeLessThan(host.querySelector('[data-testid="statement-table-cards"]').textContent.indexOf("SF-1"));
  root.unmount();
});

test("Yalnız Alacak ve metin araması footer toplamını satır bakiyesinden ayırır", () => {
  const root = renderList();
  act(() => host.querySelector('[data-testid="statement-table-filter-side-credit"]').click());
  setValue(host.querySelector('[data-testid="statement-table-filter-q"]'), "havale");
  expect(host.querySelectorAll('tr[data-testid^="statement-row-"]')).toHaveLength(1);
  expect(cellText(0, 1)).toMatch(/Havale/);
  expect(cellText(0, 4)).toMatch(/60,00/);
  const footer = host.querySelector('[data-testid="statement-table-footer"]');
  expect(footer.textContent).toMatch(/1 \/ 4 satır/);
  expect(footer.textContent).toMatch(/Alacak/);
  expect(footer.textContent).toMatch(/40,00/);
  expect(footer.textContent).toMatch(/Filtrelenen net/);
  expect(footer.textContent).not.toMatch(/Bakiye/);
  expect(host.querySelector('[data-testid="statement-table-footer-net"]').textContent).toMatch(/-40,00/);
  const options = [...host.querySelector('[data-testid="statement-table-filter-type"]').options].map((o) => o.value);
  expect(options).toContain("Satış Faturası");
  expect(options).toContain("Tahsilat");
  expect(options).toContain("Alış Faturası");
  expect(options).not.toContain("Çek");
  root.unmount();
});

test("tek belge türünde seçim gizlenir, controls false çubuğu kaldırır, boş listede çubuk yok", () => {
  const root = createRoot(host);
  act(() => root.render(<StatementTxList rows={[ORDER[0]]} tableTestId="statement-table" />));
  expect(host.querySelector('[data-testid="statement-table-filter-type"]')).toBeNull();
  expect(host.querySelector('[data-testid="statement-table-filters"]')).not.toBeNull();
  act(() => root.render(<StatementTxList rows={ORDER} tableTestId="statement-table" controls={false} />));
  expect(host.querySelector('[data-testid="statement-table-filters"]')).toBeNull();
  expect(host.querySelector('[data-testid="statement-table-sort-date"]')).toBeNull();
  expect(host.querySelector('[data-testid="statement-table-order-toggle"]')).toBeNull();
  expect(host.querySelector('[data-testid="statement-table-footer"]')).toBeNull();
  expect(host.querySelector('[data-testid="statement-table"]').textContent).toMatch(/SF-1/);
  act(() => root.render(<StatementTxList rows={[]} tableTestId="statement-table" />));
  expect(host.querySelector('[data-testid="statement-table-filters"]')).toBeNull();
  expect(host.textContent).toMatch(/Hareket yok/);
  root.unmount();
});

test("GİB rozetleri ve Gönderilmedi filtresi", () => {
  const gibRows = [
    { date: "2026-10-01", doc: "A • Satış Faturası", debit: 10, credit: 0, balance: 10, kind: "invoice", einvoice_state: "sent", e_type: "e_invoice" },
    { date: "2026-10-02", doc: "B • Satış Faturası", debit: 20, credit: 0, balance: 30, kind: "invoice", einvoice_state: "accepted", e_type: "e_archive" },
    { date: "2026-10-03", doc: "C • Satış Faturası", debit: 5, credit: 0, balance: 35, kind: "invoice", einvoice_state: "", e_type: "e_invoice" },
    { date: "2026-10-04", doc: "D • Satış Faturası", debit: 7, credit: 0, balance: 42, kind: "invoice", einvoice_state: "pending", e_type: "e_invoice" },
    { date: "2026-10-05", doc: "E • Satış Faturası", debit: 8, credit: 0, balance: 50, kind: "invoice", einvoice_state: "error", e_type: "e_invoice" },
    { date: "2026-10-06", doc: "F • Satış Faturası", debit: 9, credit: 0, balance: 59, kind: "invoice", einvoice_state: "paper", e_type: "paper" },
    { date: "2026-10-07", doc: "Tahsilat", debit: 0, credit: 4, balance: 55, kind: "payment" },
  ];
  const root = createRoot(host);
  act(() => root.render(<StatementTxList rows={gibRows} tableTestId="gib-table" rowTestId={(_r, i) => `gib-row-${i}`} />));
  const badge = (i) => host.querySelector(`[data-testid="gib-table-gib-${i}"]`);
  expect(badge(0).textContent).toBe("GİB");
  expect(badge(0).className).toMatch(/emerald/);
  expect(badge(0).getAttribute("title")).toBe("e-Fatura");
  expect(badge(1).textContent).toBe("GİB");
  expect(badge(1).getAttribute("title")).toBe("e-Arşiv");
  expect(badge(2).textContent).toBe("Kesilmedi");
  expect(badge(2).className).toMatch(/slate/);
  expect(badge(3).textContent).toBe("Kuyrukta");
  expect(badge(3).className).toMatch(/amber/);
  expect(badge(4).textContent).toBe("Hata");
  expect(badge(4).className).toMatch(/rose/);
  expect(badge(5).textContent).toBe("Matbu");
  expect(badge(6)).toBeNull();
  act(() => host.querySelector('[data-testid="gib-table-filter-gib-unsent"]').click());
  const docs = [...host.querySelectorAll('tr[data-testid^="gib-row-"]')].map((row) => row.textContent);
  expect(docs).toHaveLength(3);
  expect(docs.join(" ")).toMatch(/C •/);
  expect(docs.join(" ")).toMatch(/D •/);
  expect(docs.join(" ")).toMatch(/E •/);
  expect(docs.join(" ")).not.toMatch(/Matbu|Tahsilat/);
  expect(host.querySelector('[data-testid="gib-row-0"]').textContent).toMatch(/35,00/);
  expect(host.querySelector('[data-testid="gib-table-filter-count"]').textContent).toBe("3 / 7 satır");
  const reactErrors = quiet.mock.calls.map((c) => String(c[0])).filter((line) => /Warning|Error/.test(line));
  expect(reactErrors).toEqual([]);
  root.unmount();
});

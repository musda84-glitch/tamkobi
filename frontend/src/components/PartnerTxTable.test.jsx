/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { PartnerTxTable } from "./PartnerTxTable";
import { txMobileListGuards } from "../utils/txMobileOverflow";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = { put: jest.fn(), delete: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("./PaymentTargetSelect", () => ({
  PaymentTargetSelect: ({ value, onChange, testId }) => (
    <select data-testid={testId} value={value || ""} onChange={(ev) => onChange(ev.target.value)}>
      <option value="a1">Kasa</option>
    </select>
  ),
}));

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  host.style.width = "375px";
  host.style.maxWidth = "375px";
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

const render = (node) => {
  const root = createRoot(host);
  act(() => root.render(node));
  return root;
};

const LONG = `Vadesiz TL Hesabı: BankaHareketiAciklamasi${"W".repeat(160)}`;

const TXS = [
  {
    id: "t1",
    date: "2026-10-12",
    partner_name: "Mustafa Bal",
    partner_id: "p1",
    type: "capital_in",
    account_name: "Vadesiz TL Hesabı",
    description: LONG,
    amount: 12500.5,
  },
  {
    id: "t2",
    date: "2026-10-11",
    partner_name: "Mustafa Bal",
    type: "withdrawal",
    account_name: "Merkez Kasa",
    description: "Nakit çekim",
    amount: 500,
  },
];

test("375px: ortak hareketleri kart görünümü, tablo kart listesinde yok, yatay taşma sınıfı yok", () => {
  render(<PartnerTxTable txs={TXS} accounts={[]} companyId="c1" />);
  expect(txMobileListGuards(host)).toEqual({ ok: true, reason: "" });
  const card = host.querySelector('[data-testid="partner-tx-card-t1"]');
  expect(card).not.toBeNull();
  expect(card.textContent).toContain("Mustafa Bal");
  expect(card.textContent).toMatch(/Ortak lehine/);
  expect(card.textContent).toMatch(/12\.500/);
  expect(host.querySelector('[data-testid="partner-tx-cards"]').querySelector("table")).toBeNull();
  expect(host.querySelector('[data-testid="partner-tx-table"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="partner-tx-table-wrap"]').className).toMatch(/hidden md:block/);
  expect(host.querySelector('[data-testid="partner-tx-row-t1"]')).not.toBeNull();
  const more = host.querySelector('[data-testid="partner-tx-card-t1-desc-more"]');
  expect(more).not.toBeNull();
  expect(more.textContent).toBe("Devamı");
  act(() => more.click());
  expect(host.querySelector('[data-testid="partner-tx-card-t1-desc-more"]').textContent).toBe("Kısalt");
  expect(host.querySelector('[data-testid="partner-tx-card-del-t1"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="partner-tx-del-t1"]')).not.toBeNull();
});

test("masaüstü tablo işaretleri ve sıralama korunur", () => {
  render(<PartnerTxTable txs={TXS} accounts={[]} companyId="c1" />);
  expect(host.querySelector('[data-testid="partner-tx-sort-date"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="partner-tx-sort-amount"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="partner-tx-table"]').querySelector("thead").textContent).toMatch(/Hesap \/ Açıklama/);
});

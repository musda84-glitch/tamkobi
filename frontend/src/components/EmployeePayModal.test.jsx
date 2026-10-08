import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { EmployeePayModal } from "./EmployeePayModal";

jest.mock("axios", () => {
  const impl = { get: jest.fn(() => Promise.resolve({ data: [] })), post: jest.fn(() => Promise.resolve({ data: { message: "ok" } })) };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/useEscape", () => ({ useEscape: () => {} }));
jest.mock("../utils/dataRefresh", () => ({ notifyDataChanged: jest.fn(() => Promise.resolve()) }));
jest.mock("./PaymentTargetSelect", () => ({
  PaymentTargetSelect: ({ value, onChange, testId }) => (
    <select data-testid={testId} value={value || ""} onChange={(ev) => onChange(ev.target.value)}>
      <option value="">—</option>
      <option value="acc1">Banka</option>
    </select>
  ),
  splitPaymentTarget: (id) => (id ? { account_id: id } : {}),
}));

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
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

const card = {
  balance: {
    unpaid_payroll: 28000,
    overtime_due: 1200,
    bonus_pending: 500,
    meal_due: 2500,
    transport_due: 1500,
    unpaid_expenses: 800,
    remaining: 33300,
    month: "2026-10",
  },
};

test("Öde modalı tüm bakiye / ayrı ayrı ve ödeme tarihini gösterir", () => {
  render(
    <EmployeePayModal
      employee={{ id: "e1", full_name: "Ali", pay_start_date: "2026-11-01", pay_recurring: true }}
      companyId="c1"
      accounts={[{ id: "acc1", type: "bank", account_name: "Banka" }]}
      card={card}
      onClose={() => {}}
    />,
  );
  expect(host.querySelector('[data-testid="emp-pay-modal"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="emp-pay-mode-all"]')?.textContent).toContain("Tüm bakiyeyi öde");
  expect(host.querySelector('[data-testid="emp-pay-mode-split"]')?.textContent).toContain("Ayrı ayrı öde");
  const dateInput = host.querySelector('[data-testid="emp-pay-date"]');
  expect(dateInput).not.toBeNull();
  expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // Hak ediş / her ay tekrarla ödeme ekranında yok
  expect(host.querySelector('[data-testid="emp-pay-recurring"]')).toBeNull();
  expect(host.textContent).not.toMatch(/Her ay tekrarla/);
  expect(host.textContent).not.toMatch(/Hak ediş tarihinde maaş/);
  expect(host.textContent).toContain("Ödeme tarihi");
  expect(host.textContent).toContain("Maaş");
  expect(host.textContent).toContain("Yemek");
  expect(host.textContent).toContain("Yol");
  expect(host.querySelector('[data-testid="emp-pay-advance"]')).not.toBeNull();
});

test("ayrı ayrı öde kalem kutularını açar", () => {
  render(
    <EmployeePayModal
      employee={{ id: "e1", full_name: "Ali" }}
      companyId="c1"
      accounts={[{ id: "acc1", type: "bank" }]}
      card={card}
      onClose={() => {}}
    />,
  );
  act(() => host.querySelector('[data-testid="emp-pay-mode-split"]').click());
  expect(host.querySelector('[data-testid="emp-pay-kind-salary"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="emp-pay-kind-meal"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="emp-pay-kind-overtime"]')).not.toBeNull();
});

test("Yemek butonu ayrı ayrı öde ve yemek kalemini açar", () => {
  render(
    <EmployeePayModal
      employee={{ id: "e1", full_name: "Ali" }}
      companyId="c1"
      accounts={[{ id: "acc1", type: "bank" }]}
      card={card}
      initialKind="meal"
      onClose={() => {}}
    />,
  );
  expect(host.textContent).toContain("Yemek — Ali");
  const meal = host.querySelector('[data-testid="emp-pay-kind-meal"]');
  expect(meal).not.toBeNull();
  expect(meal.checked).toBe(true);
});

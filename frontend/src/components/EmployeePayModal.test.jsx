import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
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
      <option value="bank1">Banka</option>
      <option value="cash1">Kasa</option>
      <option value="pos1">POS</option>
    </select>
  ),
  splitPaymentTarget: (id) => (id ? { account_id: id } : {}),
}));

let host;
let quiet;

beforeEach(() => {
  axios.get.mockImplementation(() => Promise.resolve({ data: {} }));
  axios.post.mockImplementation(() => Promise.resolve({ data: { message: "ok" } }));
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

function setNative(el, value) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}

const render = (node) => {
  const root = createRoot(host);
  act(() => root.render(node));
  return root;
};

const card = {
  balance: {
    unpaid_payroll: 28000,
    salary_earned: 28000,
    premium: 1700,
    deductions: 500,
    previous_payments: 1000,
    overtime_due: 1200,
    bonus_pending: 500,
    meal_due: 2500,
    transport_due: 1500,
    unpaid_expenses: 800,
    remaining: 33300,
    month: "2026-10",
  },
};

const accounts = [
  { id: "pos1", type: "pos", account_name: "POS", current_balance: 90000 },
  { id: "bank1", type: "bank", account_name: "Banka", current_balance: 90000 },
  { id: "cash1", type: "cash_box", account_name: "Kasa", current_balance: 100 },
];

test("Öde modalı dönem özetini ve kalan alacağı gösterir", () => {
  render(
    <EmployeePayModal
      employee={{ id: "e1", full_name: "Ali", pay_start_date: "2026-11-01" }}
      companyId="c1"
      accounts={accounts}
      card={card}
      onClose={() => {}}
    />,
  );
  expect(host.querySelector('[data-testid="emp-pay-modal"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="emp-pay-month"]').value).toBe("2026-10");
  expect(host.textContent).toContain("Hak edilen maaş");
  expect(host.textContent).toContain("Prim / mesai");
  expect(host.textContent).toContain("Kesintiler");
  expect(host.textContent).toContain("Önceki ödemeler");
  expect(host.querySelector('[data-testid="emp-pay-remaining"]').textContent).toContain("Kalan alacak");
  expect(host.querySelector('[data-testid="emp-pay-date"]').value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(host.querySelector('[data-testid="emp-pay-line-account-0"]').value).toBe("bank1");
  expect(host.textContent).not.toMatch(/Her ay tekrarla/);
});

test("Kalanı öde kalan tutarı ilk satıra yazar", () => {
  render(
    <EmployeePayModal employee={{ id: "e1", full_name: "Ali" }} companyId="c1" accounts={accounts} card={card} onClose={() => {}} />,
  );
  act(() => host.querySelector('[data-testid="emp-pay-fill-remaining"]').click());
  expect(host.querySelector('[data-testid="emp-pay-line-kind-0"]').value).toBe("salary");
  expect(host.querySelector('[data-testid="emp-pay-line-amount-0"]').value).toBe("33300");
  expect(host.querySelector('[data-testid="emp-pay-preview"]').textContent).toContain("Ödeme sonrası kalan");
});

test("tahakkuk yokken maaş elle girilir ve fazla ödeme uyarılır", () => {
  render(
    <EmployeePayModal
      employee={{ id: "e1", full_name: "Ali" }}
      companyId="c1"
      accounts={accounts}
      card={{ balance: { remaining: 0, unpaid_payroll: 0, month: "2026-10", salary_earned: 0 } }}
      onClose={() => {}}
    />,
  );
  const amount = host.querySelector('[data-testid="emp-pay-line-amount-0"]');
  act(() => setNative(amount, "2500"));
  expect(host.querySelector('[data-testid="emp-pay-manual-salary"]').textContent).toContain("tahakkuk yok");
  expect(host.querySelector('[data-testid="emp-pay-preview"]').textContent).toContain("sonraki maaştan düşülecek");
});

test("SGK'lı personelde kasa resmi maaşı engeller", () => {
  render(
    <EmployeePayModal
      employee={{ id: "e1", full_name: "Ali", sgk_insured: true, official_salary: 15000, salary: 28000 }}
      companyId="c1"
      accounts={accounts}
      card={card}
      sgkSalaryBankOnly
      onClose={() => {}}
    />,
  );
  const account = host.querySelector('[data-testid="emp-pay-line-account-0"]');
  const amount = host.querySelector('[data-testid="emp-pay-line-amount-0"]');
  act(() => {
    setNative(account, "cash1");
    setNative(amount, "15000");
  });
  expect(host.querySelector('[data-testid="emp-pay-sgk-warn"]').textContent).toBe("SGK'lı personelin resmi maaşı bankadan ödenmelidir");
});

test("ödeme açılışında uuid üretir ve Idempotency-Key gönderir", async () => {
  render(
    <EmployeePayModal employee={{ id: "e1", full_name: "Ali" }} companyId="c1" accounts={accounts} card={card} onClose={() => {}} />,
  );
  act(() => setNative(host.querySelector('[data-testid="emp-pay-line-amount-0"]'), "100"));
  await act(async () => {
    host.querySelector('[data-testid="emp-pay-submit"]').click();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(axios.post).toHaveBeenCalled();
  const [, body, cfg] = axios.post.mock.calls[0];
  expect(body.idempotency_key).toEqual(expect.any(String));
  expect(body.idempotency_key.length).toBeGreaterThan(8);
  expect(cfg.headers["Idempotency-Key"]).toBe(body.idempotency_key);
});

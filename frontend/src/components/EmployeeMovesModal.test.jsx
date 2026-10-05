import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { EmployeeMovesModal } from "./EmployeeMovesModal";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: { payrolls: [], bonuses: [] } })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: { message: "Maaş kaydı çöp kutusuna taşındı." } })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/useEscape", () => ({ useEscape: () => {} }));
jest.mock("../utils/modalBackdrop", () => ({ backdropDismissProps: () => ({}) }));
jest.mock("./AssignOvertimeModal", () => ({ AssignOvertimeModal: () => null }));
jest.mock("./EmployeePuantajPanel", () => ({ EmployeePuantajPanel: () => null }));

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockReset();
  axios.delete.mockReset();
  axios.delete.mockResolvedValue({ data: { message: "Maaş kaydı çöp kutusuna taşındı." } });
  window.confirm = jest.fn(() => true);
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
  payrolls: [{ id: "pay_cedeeef3", period: "2026-11", status: "pending", final_payable: 40000 }],
  bonuses: [{ id: "b1", type: "advance", status: "paid", period: "2026-09", amount: 2000, created_at: "2026-09-10" }],
};

test("ödeme hareketinde bekleyen maaşa Sil koyar ve siler", async () => {
  axios.get.mockResolvedValue({ data: card });
  render(<EmployeeMovesModal employee={{ id: "emp_1", full_name: "Ali" }} onClose={() => {}} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  act(() => host.querySelector('[data-testid="emp-pay-moves-period-all"]').click());
  const btn = host.querySelector('[data-testid="emp-pay-move-del-pay_cedeeef3"]');
  expect(btn).not.toBeNull();
  expect(btn.textContent).toContain("Sil");
  expect(host.querySelector('[data-testid="emp-pay-move-del-b1"]')).not.toBeNull();
  await act(async () => { btn.click(); await Promise.resolve(); await Promise.resolve(); });
  expect(window.confirm).toHaveBeenCalled();
  expect(axios.delete).toHaveBeenCalledWith("/api/personnel/payrolls/pay_cedeeef3");
});

test("düzenleme yoksa Sil göstermez", async () => {
  axios.get.mockResolvedValue({ data: card });
  render(<EmployeeMovesModal employee={{ id: "emp_1", full_name: "Ali" }} canEdit={false} onClose={() => {}} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  act(() => host.querySelector('[data-testid="emp-pay-moves-period-all"]').click());
  expect(host.querySelector('[data-testid="emp-pay-move-pay_cedeeef3"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="emp-pay-move-del-pay_cedeeef3"]')).toBeNull();
});

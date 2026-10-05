import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { LeaveRequestsPanel } from "./PersonnelExtras";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: { status: "cancelled" } })),
    delete: jest.fn(() => Promise.resolve({ data: { status: "success" } })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("./PaymentTargetSelect", () => ({
  PaymentTargetSelect: () => null,
  splitPaymentTarget: () => ({}),
}));

const rows = [
  { id: "lv-approved", employee_name: "Ali", type: "annual", start_date: "2026-09-26", end_date: "2026-09-30", days: 5, status: "approved" },
  { id: "lv-rejected", employee_name: "Veli", type: "sick", start_date: "2026-09-23", end_date: "2026-09-23", days: 1, status: "rejected" },
  { id: "lv-pending", employee_name: "Ayşe", type: "unpaid", start_date: "2026-10-01", end_date: "2026-10-02", days: 2, status: "pending" },
];

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockReset().mockResolvedValue({ data: rows });
  axios.post.mockReset().mockResolvedValue({ data: { status: "cancelled" } });
  axios.delete.mockReset().mockResolvedValue({ data: { status: "success" } });
  window.confirm = jest.fn(() => true);
});
afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

const flush = async () => {
  await act(async () => { await Promise.resolve(); });
};

test("izin satırlarında iptal ve silme butonları görünür", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<LeaveRequestsPanel companyId="c1" employees={[{ id: "e1", full_name: "Ali", annual_leave_days: 14, used_leave_days: 0 }]} />);
  });
  await flush();
  expect(host.querySelector('[data-testid="leave-requests-panel"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="cancel-leave-lv-approved"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="delete-leave-lv-approved"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="delete-leave-lv-rejected"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="cancel-leave-lv-rejected"]')).toBeNull();
  expect(host.querySelector('[data-testid="approve-leave-lv-pending"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="cancel-leave-lv-pending"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="delete-leave-lv-pending"]')).not.toBeNull();
  expect(host.textContent).toContain("Onaylandı");
  expect(host.textContent).toContain("Reddedildi");
});

test("iptal ve sil API çağırır", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<LeaveRequestsPanel companyId="c1" employees={[]} />);
  });
  await flush();
  await act(async () => {
    host.querySelector('[data-testid="cancel-leave-lv-approved"]').click();
  });
  expect(axios.post).toHaveBeenCalledWith("/api/personnel/leaves/lv-approved/cancel");
  await act(async () => {
    host.querySelector('[data-testid="delete-leave-lv-rejected"]').click();
  });
  expect(axios.delete).toHaveBeenCalledWith("/api/personnel/leaves/lv-rejected");
});

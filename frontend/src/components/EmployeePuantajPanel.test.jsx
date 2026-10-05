import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { EmployeePuantajPanel } from "./EmployeePuantajPanel";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(() => Promise.resolve({ data: { message: "Ücret kesilmedi. Yevmiye 1080 ₺." } })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/modalBackdrop", () => ({ backdropDismissProps: () => ({}) }));

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockResolvedValue({
    data: {
      month: "2026-10",
      summary: { days_present: 1, days_absent: 0, days_leave: 0, total_hours: 8, overtime_hours: 0, overtime_pay: 0 },
      leave_year: { year: 2026, annual: 14, used: 0, remaining: 14 },
      leave_archives: [],
      days: [{
        date: "2026-10-01",
        weekday: 3,
        weekday_label: "Per",
        status: "present",
        status_label: "Çalıştı",
        check_in: "09:10",
        check_out: "18:00",
        hours: 8,
        overtime_hours: 0,
        late_minutes: 10,
        attendance_id: "att-1",
        wage: 1058.66,
        wage_full: 1080,
        wage_proposed: 1058.66,
        wage_ask: true,
      }],
    },
  });
  axios.post.mockClear();
});
afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

const render = async (node) => {
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  await act(async () => { await Promise.resolve(); });
  return root;
};

test("geç ücret hücresi kes / kesme sorar", async () => {
  await render(<EmployeePuantajPanel employeeId="e1" initialMonth="2026-10" />);
  const wage = host.querySelector('[data-testid="emp-puantaj-wage-2026-10-01"]');
  expect(wage?.textContent).toContain("1.058,66");
  expect(host.querySelector('[data-testid="emp-puantaj-wage-open-2026-10-01"]')).not.toBeNull();
  expect(host.textContent).toContain("10 dk geç");
  await act(async () => {
    host.querySelector('[data-testid="emp-puantaj-wage-open-2026-10-01"]').click();
  });
  expect(host.querySelector('[data-testid="emp-puantaj-wage-ask-2026-10-01"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="emp-puantaj-wage-kes-2026-10-01"]')?.textContent).toBe("Ücret kes");
  expect(host.querySelector('[data-testid="emp-puantaj-wage-kesme-2026-10-01"]')?.textContent).toBe("Ücret kesme");
  await act(async () => {
    host.querySelector('[data-testid="emp-puantaj-wage-kesme-2026-10-01"]').click();
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(axios.post).toHaveBeenCalledWith(
    "/api/personnel/attendance/att-1/yevmiye-decision",
    { decision: "reject" },
    { withCredentials: true },
  );
});

test("gün satırı Düzenle ile giriş-çıkış kaydeder", async () => {
  await render(<EmployeePuantajPanel employeeId="e1" initialMonth="2026-10" />);
  expect(host.querySelector('[data-testid="emp-puantaj-edit-2026-10-01"]')).not.toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="emp-puantaj-edit-2026-10-01"]').click();
  });
  expect(host.querySelector('[data-testid="emp-puantaj-edit-modal-2026-10-01"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="emp-puantaj-edit-in"]')?.value).toBe("09:10");
  expect(host.querySelector('[data-testid="emp-puantaj-edit-out"]')?.value).toBe("18:00");
  axios.post.mockResolvedValueOnce({ data: { message: "Puantaj kaydı güncellendi." } });
  await act(async () => {
    host.querySelector('[data-testid="emp-puantaj-edit-save"]').click();
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(axios.post).toHaveBeenCalledWith("/api/personnel/attendance", expect.objectContaining({
    employee_id: "e1",
    date: "2026-10-01",
    status: "present",
    check_in: "09:10",
    check_out: "18:00",
  }));
});

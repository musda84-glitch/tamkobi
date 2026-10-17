import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BankMatchModal } from "./BankMatchModal";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: { match_status: "matched" } })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

const TX = {
  id: "tx1",
  date: "2026-10-11",
  amount: 1000,
  type: "outflow",
  description: "AYSE MASRAF",
  account_id: "a1",
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/expenses/categories")) {
      return Promise.resolve({ data: [{ name: "Yakıt" }, { name: "Personel Masrafı" }] });
    }
    if (u.includes("/personnel/employees/") && u.includes("/card")) {
      return Promise.resolve({
        data: {
          expenses: [
            {
              id: "ex1",
              expense_number: "MSR-2026-0007",
              description: "Market",
              date: "2026-10-01",
              total: 1000,
              paid_by_personnel: true,
              personnel_debt_status: "open",
              payment_status: "unpaid",
            },
            {
              id: "ex-closed",
              expense_number: "MSR-2026-0001",
              description: "Kapali",
              paid_by_personnel: true,
              personnel_debt_status: "closed",
            },
          ],
        },
      });
    }
    if (u.includes("/personnel/employees")) {
      return Promise.resolve({ data: [{ id: "e1", full_name: "Ayşe Yılmaz", is_active: true }] });
    }
    return Promise.resolve({ data: [] });
  });
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { match_status: "matched" } });
  toast.success.mockClear();
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.body.innerHTML = "";
});

async function renderModal() {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <BankMatchModal
        tx={TX}
        contacts={[]}
        accounts={[{ id: "a1", account_name: "Vadesiz" }]}
        companyId="comp1"
        onClose={() => {}}
      />
    );
  });
}

async function openPersonnel() {
  await renderModal();
  const mode = document.querySelector('[data-testid="tx-match-mode-tx1"]');
  await act(async () => {
    mode.value = "expense";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
  const cat = document.querySelector('[data-testid="tx-match-expense-cat-tx1"]');
  await act(async () => {
    cat.value = "Personel Masrafı";
    cat.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
}

test("varsayılan tür masraf iadesi ve seçilen MSR payload'a gider", async () => {
  await openPersonnel();
  const kind = document.querySelector('[data-testid="tx-match-pay-kind-tx1"]');
  expect(kind.value).toBe("reimburse");
  expect(kind.options[0].textContent).toBe("Masraf iadesi");

  const emp = document.querySelector('[data-testid="tx-match-employee-tx1"]');
  await act(async () => {
    emp.value = "e1";
    emp.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });

  const msr = document.querySelector('[data-testid="tx-match-msr-tx1"]');
  expect(msr).toBeTruthy();
  const labels = [...msr.options].map((o) => o.textContent);
  expect(labels.some((t) => t.includes("MSR-2026-0007"))).toBe(true);
  expect(labels.some((t) => t.includes("Kapali"))).toBe(false);

  await act(async () => {
    msr.value = "ex1";
    msr.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const form = document.querySelector('[data-testid="tx-match-modal-tx1"] form');
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });

  expect(axios.post).toHaveBeenCalled();
  const body = axios.post.mock.calls[0][1];
  expect(body.personnel_pay_kind).toBe("reimburse");
  expect(body.employee_id).toBe("e1");
  expect(body.expense_id).toBe("ex1");
  expect(body.as_expense).toBe(true);
  expect(toast.success).toHaveBeenCalled();
  expect(String(toast.success.mock.calls[0][0])).toContain("Ayşe Yılmaz");
  expect(String(toast.success.mock.calls[0][0])).toContain("Masraf iadesi");
});

test("sadece kategori personel uyarısı masraf moduna geçirir", async () => {
  await renderModal();
  const mode = document.querySelector('[data-testid="tx-match-mode-tx1"]');
  await act(async () => {
    mode.value = "category";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const input = document.querySelector('[data-testid="tx-match-category-tx1"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Personel Masrafı");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const warn = document.querySelector('[data-testid="tx-match-personnel-warn-tx1"]');
  expect(warn).toBeTruthy();
  expect(warn.textContent).toContain("Masraf modunda");
  const save = document.querySelector('[data-testid="tx-match-save-tx1"]');
  expect(save.disabled).toBe(true);

  await act(async () => {
    document.querySelector('[data-testid="tx-match-goto-expense-tx1"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  expect(document.querySelector('[data-testid="tx-match-mode-tx1"]').value).toBe("expense");
  expect(document.querySelector('[data-testid="tx-match-expense-cat-tx1"]').value).toBe("Personel Masrafı");
  expect(document.querySelector('[data-testid="tx-match-pay-kind-tx1"]').value).toBe("reimburse");
  expect(document.querySelector('[data-testid="tx-match-personnel-warn-tx1"]')).toBeFalsy();
});

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { BankMatchModal } from "./BankMatchModal";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
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
  amount: 3000,
  type: "outflow",
  description: "MATEK DEKORASYON",
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
    if (u.includes("/personnel/employees")) {
      return Promise.resolve({ data: [{ id: "e1", full_name: "Ayşe Yılmaz", is_active: true }] });
    }
    return Promise.resolve({ data: [] });
  });
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
        contacts={[{ id: "c1", name: "EREN" }]}
        accounts={[{ id: "a1", account_name: "Vadesiz" }]}
        companyId="comp1"
        onClose={() => {}}
      />
    );
  });
}

test("mode select has no Cari + Fatura; contact hidden until Cari", async () => {
  await renderModal();
  const mode = document.querySelector('[data-testid="tx-match-mode-tx1"]');
  expect(mode).toBeTruthy();
  const labels = [...mode.options].map((o) => o.textContent);
  expect(labels).not.toContain("Cari + Fatura");
  expect(labels).toEqual(["Cari", "Kasa / Hesap (Virman)", "Sadece Kategori", "Masraf"]);
  // default mode is contact → contact visible
  expect(document.querySelector('[data-testid="tx-match-contact-tx1"]')).toBeTruthy();
  expect(document.querySelector('[data-testid="tx-match-expense-cat-tx1"]')).toBeFalsy();

  await act(async () => {
    mode.value = "transfer";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(document.querySelector('[data-testid="tx-match-contact-tx1"]')).toBeFalsy();
  expect(document.querySelector('[data-testid="tx-match-expense-cat-tx1"]')).toBeFalsy();
});

test("expense category only for Masraf; Personel shows employee select", async () => {
  await renderModal();
  const mode = document.querySelector('[data-testid="tx-match-mode-tx1"]');
  await act(async () => {
    mode.value = "expense";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });

  expect(document.querySelector('[data-testid="tx-match-contact-tx1"]')).toBeFalsy();
  const cat = document.querySelector('[data-testid="tx-match-expense-cat-tx1"]');
  expect(cat).toBeTruthy();
  expect(document.querySelector('[data-testid="tx-match-employee-tx1"]')).toBeFalsy();

  await act(async () => {
    cat.value = "Personel Masrafı";
    cat.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });

  const emp = document.querySelector('[data-testid="tx-match-employee-tx1"]');
  expect(emp).toBeTruthy();
  expect([...emp.options].some((o) => o.textContent.includes("Ayşe"))).toBe(true);
});

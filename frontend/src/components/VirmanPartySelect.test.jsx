import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { VirmanPartySelect } from "./VirmanPartySelect";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: {} };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/dataRefresh", () => ({ useDataRefresh: () => ({}) }));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "" }));

let host;
let last;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  last = "";
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/banking/partners")) {
      return Promise.resolve({ data: [{ id: "p1", name: "Ortak A", share_percent: 50, balance: 0, is_active: true }] });
    }
    if (String(url).includes("/contacts")) {
      return Promise.resolve({
        data: [
          { id: "cnt-1", name: "Acme Ltd", type: "customer", balance: 1200, tax_number: "1234567890", phone: "05320000000" },
          { id: "cnt-2", name: "Beta Tedarik", type: "supplier", balance: -400, tax_number: "9876543210" },
        ],
      });
    }
    if (String(url).includes("/banking/accounts")) {
      return Promise.resolve({
        data: [
          { id: "cash-1", type: "cash_box", account_name: "Merkez Kasa", current_balance: 5000 },
          { id: "bank-1", type: "bank", bank_name: "Ziraat", account_name: "TL", current_balance: 8000 },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  host.remove();
});

const Harness = ({ initial = "" }) => {
  const [value, setValue] = useState(initial);
  last = value;
  return (
    <VirmanPartySelect
      companyId="c1"
      accounts={[]}
      value={value}
      onChange={(v) => { last = v; setValue(v); }}
      testId="virman-source"
      label="Kaynak"
    />
  );
};

test("source/target default to account mode without mixed cari optgroup", async () => {
  await act(async () => {
    createRoot(host).render(<Harness />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(host.querySelector('[data-testid="virman-source-mode-account"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="virman-source-account"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="virman-source-contact"]')).toBeNull();
  expect(host.innerHTML).not.toContain("<optgroup label=\"Cariler\">");
  expect(host.innerHTML).toContain("Merkez Kasa");
});

test("cari mode shows searchable contact select", async () => {
  await act(async () => {
    createRoot(host).render(<Harness />);
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    host.querySelector('[data-testid="virman-source-mode-contact"]').click();
  });
  expect(host.querySelector('[data-testid="virman-source-contact"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="virman-source-account"]')).toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="virman-source-contact-trigger"]').click();
  });
  // SearchSelect menüsü portal ile document.body'de açılır.
  const search = document.querySelector('[data-testid="virman-source-contact-search"]');
  expect(search).not.toBeNull();
  expect(search?.getAttribute("placeholder") || "").toMatch(/Cari/i);
  await act(async () => {
    document.querySelector('[data-testid="virman-source-contact-option-cnt-1"]').click();
  });
  expect(last).toBe("contact:cnt-1");
});

test("contact: value opens in cari mode", async () => {
  await act(async () => {
    createRoot(host).render(<Harness initial="contact:cnt-2" />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(host.querySelector('[data-testid="virman-source-contact"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="virman-source-mode-contact"]')?.className).toMatch(/bg-indigo-600/);
});

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

const ACCOUNTS = [
  { id: "bank1", account_name: "Vadesiz", type: "bank", current_balance: 1000 },
  { id: "pos1", account_name: "Sanal POS", type: "pos", current_balance: 49000 },
  { id: "okc1", account_name: "Yazar Kasa POS", type: "okc_pos", current_balance: 1200 },
  { id: "cash1", account_name: "Kasa", type: "cash", current_balance: 50 },
];

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/expenses/categories")) {
      return Promise.resolve({ data: [{ name: "Yakıt" }, { name: "POS Komisyonu" }] });
    }
    return Promise.resolve({ data: [] });
  });
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { match_status: "matched" } });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.body.innerHTML = "";
});

async function render(tx) {
  if (root) {
    await act(async () => { root.unmount(); });
    root = null;
  }
  root = createRoot(host);
  await act(async () => {
    root.render(
      <BankMatchModal
        tx={tx}
        contacts={[]}
        accounts={ACCOUNTS}
        companyId="comp1"
        onClose={() => {}}
      />
    );
  });
}

function modeSelect() {
  return document.querySelector('[data-testid="tx-match-mode-tx1"]');
}

async function chooseMode(value) {
  const mode = modeSelect();
  await act(async () => {
    mode.value = value;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
}

test("POS bloke çözümü yalnız giriş hareketinde listelenir", async () => {
  await render({
    id: "tx1",
    date: "2026-10-11",
    amount: 100,
    type: "outflow",
    description: "GIDEN",
    account_id: "bank1",
  });
  expect([...modeSelect().options].map((o) => o.textContent)).not.toContain("POS bloke çözümü");

  await render({
    id: "tx1",
    date: "2026-10-11",
    amount: 47168.38,
    type: "inflow",
    description: "POS BLOKE",
    account_id: "bank1",
  });
  expect([...modeSelect().options].map((o) => o.value)).toContain("pos_settlement");
  expect([...modeSelect().options].map((o) => o.textContent)).toContain("POS bloke çözümü");
});

test("POS select yalnız pos ve okc_pos hesaplarını gösterir", async () => {
  await render({
    id: "tx1",
    date: "2026-10-11",
    amount: 47168.38,
    type: "inflow",
    description: "POS BLOKE",
    account_id: "bank1",
  });
  await chooseMode("pos_settlement");
  const select = document.querySelector('[data-testid="tx-match-pos-account-tx1"]');
  const labels = [...select.options].map((o) => o.textContent);
  const values = [...select.options].map((o) => o.value);
  expect(labels.some((l) => l.includes("Sanal POS"))).toBe(true);
  expect(labels.some((l) => l.includes("Yazar Kasa POS"))).toBe(true);
  expect(values).toEqual(expect.arrayContaining(["pos1", "okc1"]));
  expect(values).not.toContain("bank1");
  expect(values).not.toContain("cash1");
  expect(labels.some((l) => l.includes("bloke bakiye"))).toBe(true);
});

test("brüt girilince komisyon ve oran ipucu dolar; hata varken eşleştir kapalıdır", async () => {
  await render({
    id: "tx1",
    date: "2026-10-11",
    amount: 47168.38,
    type: "inflow",
    description: "POS BLOKE",
    account_id: "bank1",
  });
  await chooseMode("pos_settlement");
  const account = document.querySelector('[data-testid="tx-match-pos-account-tx1"]');
  await act(async () => {
    account.value = "pos1";
    account.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const gross = document.querySelector('[data-testid="tx-match-pos-gross-tx1"]');
  const commission = document.querySelector('[data-testid="tx-match-pos-commission-tx1"]');
  const net = document.querySelector('[data-testid="tx-match-pos-net-tx1"]');
  expect(net.value).toBe("47168.38");
  expect(net.readOnly).toBe(true);
  expect(Number(gross.value)).toBe(49000);
  expect(Number(commission.value)).toBe(1831.62);
  expect(document.querySelector('[data-testid="tx-match-pos-rate-tx1"]').textContent).toMatch(/%/);
  expect(document.querySelector('[data-testid="tx-match-pos-bsmv-tx1"]').textContent).toBe("BSMV dahil");
  expect(document.querySelector('[data-testid="tx-match-pos-summary-tx1"]').textContent).toContain("Sanal POS");
  expect(document.querySelector('[data-testid="tx-match-pos-summary-tx1"]').textContent).toContain("Masraf komisyon");
  expect(document.querySelector('[data-testid="tx-match-pos-summary-tx1"]').textContent).toContain("Banka");

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(gross, "60000");
    gross.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const save = document.querySelector('[data-testid="tx-match-save-tx1"]');
  expect(save.disabled).toBe(true);
  expect(document.querySelector('[data-testid="tx-match-pos-errors-tx1"]').textContent).toContain("Brüt tutar POS bakiyesini aşıyor.");
  expect(gross.className).toMatch(/rose/);
  expect(commission.className).toMatch(/rose/);
});

test("öneri gelince oran ile brüt dolar ve istek pos_settlement gövdesi taşır", async () => {
  await render({
    id: "tx1",
    date: "2026-10-11",
    amount: 47168.38,
    type: "inflow",
    description: "YAPI KREDI POS BLOKE",
    account_id: "bank1",
    suggested_match_kind: "pos_settlement",
    suggested_pos_commission_rate: 0.03738,
    suggested_target_account_id: "pos1",
    suggested_target_account_name: "Sanal POS",
    suggested_category: "POS Komisyonu",
  });
  expect(modeSelect().value).toBe("pos_settlement");
  const gross = document.querySelector('[data-testid="tx-match-pos-gross-tx1"]');
  const commission = document.querySelector('[data-testid="tx-match-pos-commission-tx1"]');
  expect(document.querySelector('[data-testid="tx-match-pos-account-tx1"]').value).toBe("pos1");
  expect(Number(gross.value)).toBe(49000);
  expect(Number(commission.value)).toBeCloseTo(1831.62, 2);

  await act(async () => {
    document.querySelector('[data-testid="tx-match-save-tx1"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  expect(axios.post).toHaveBeenCalled();
  const [url, body] = axios.post.mock.calls[0];
  expect(String(url)).toContain("/banking/transactions/tx1/match");
  expect(body).toMatchObject({
    mode: "pos_settlement",
    target_account_id: "pos1",
    pos_gross: 49000,
    category: "POS Komisyonu",
    learn: true,
  });
  expect(body.pos_commission).toBeCloseTo(1831.62, 2);
  expect(body.contact_id).toBeUndefined();
  expect(body.as_expense).toBeUndefined();
  expect(body.invoice_id).toBeUndefined();
});

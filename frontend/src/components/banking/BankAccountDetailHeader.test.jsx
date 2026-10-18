/**
 * @jest-environment jsdom
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { BankAccountDetailHeader } from "./BankAccountDetailHeader";
import { formatTrAmount } from "../../utils/money";
import { accountDisplayLabel } from "../../utils/accountLabel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: { message: "Senkron tamam" } })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "/api" }));

const integrated = {
  id: "a1",
  type: "bank",
  bank_name: "Kuveyt Türk",
  account_name: "Vadesiz",
  iban: "TR330006100519786457841326",
  is_integrated: true,
  connection_id: "c9",
  integration_provider: "kuveyt",
  current_balance: 6716.58,
  month_in: 1500.5,
  month_out: 25,
  unmatched_count: 4,
};

const manual = {
  id: "a2",
  type: "cash_box",
  bank_name: "Merkez",
  account_name: "Kasa",
  is_integrated: false,
  current_balance: 80,
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.post.mockClear();
  axios.post.mockResolvedValue({ data: { message: "Senkron tamam" } });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.body.innerHTML = "";
});

async function render(props) {
  root = createRoot(host);
  await act(async () => {
    root.render(<BankAccountDetailHeader groupLabel="Banka" groupType="bank" canEdit {...props} />);
  });
}

test("entegre hesapta Senkronize görünür ve bağlantı senkronunu çağırır", async () => {
  const onSynced = jest.fn(async () => {});
  await render({ account: integrated, onSynced });
  const btn = host.querySelector('[data-testid="account-sync-btn"]');
  expect(btn?.textContent).toContain("Senkronize et");
  await act(async () => { btn.click(); });
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
  expect(axios.post).toHaveBeenCalledWith("/api/banking/connections/c9/sync");
  expect(onSynced).toHaveBeenCalled();
});

test("entegre olmayan hesapta Senkronize görünmez", async () => {
  await render({ account: manual });
  expect(host.querySelector('[data-testid="account-sync-btn"]')).toBeNull();
  expect(host.querySelector('[data-testid="account-detail-subtitle"]').textContent).not.toContain("ENTEGRE");
  expect(host.querySelector('[data-testid="account-detail-subtitle"]').textContent).not.toContain("CANLI");
});

test("Sil entegrede pasif", async () => {
  await render({ account: integrated });
  const del = host.querySelector('[data-testid="account-detail-delete"]');
  expect(del).toBeTruthy();
  expect(del.disabled).toBe(true);
  expect(del.textContent).toContain("Sil");
});

test("last_synced_at yoksa son senkron —", async () => {
  await render({ account: { ...integrated, last_synced_at: undefined } });
  expect(host.querySelector('[data-testid="account-detail-subtitle"]').textContent).toContain("son senkron —");
});

test("KPI alanları yoksa tire, varsa ay giriş çıkış ve eşleşmemiş biçimlenir", async () => {
  await render({ account: { ...manual } });
  expect(host.querySelector('[data-testid="account-kpi-month-in-value"]').textContent).toBe("—");
  expect(host.querySelector('[data-testid="account-kpi-month-out-value"]').textContent).toBe("—");
  expect(host.querySelector('[data-testid="account-kpi-unmatched-value"]').textContent).toBe("—");

  await act(async () => { root.unmount(); });
  root = null;
  await render({
    account: {
      ...integrated,
      is_customer_card_pool: true,
      current_balance: 900,
    },
  });
  expect(host.querySelector('[data-testid="account-kpi-balance-value"]').textContent).toContain(formatTrAmount(0));
  expect(host.querySelector('[data-testid="account-kpi-month-in-value"]').textContent).toContain(formatTrAmount(1500.5));
  expect(host.querySelector('[data-testid="account-kpi-month-out-value"]').textContent).toContain(formatTrAmount(25));
  expect(host.querySelector('[data-testid="account-kpi-unmatched-value"]').textContent).toContain(
    Number(4).toLocaleString("tr-TR", { maximumFractionDigits: 0 }),
  );
});

test("Eşleşmemiş KPI tıklanınca filtre açılır", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <span data-testid="unmatched-state">{open ? "on" : "off"}</span>
        <button type="button" data-testid="tx-filter-unmatched" onClick={() => setOpen((v) => !v)}>Eşleşmemiş</button>
        <BankAccountDetailHeader
          account={integrated}
          groupLabel="Banka"
          groupType="bank"
          canEdit
          unmatchedActive={open}
          onUnmatched={() => setOpen(true)}
        />
      </div>
    );
  }
  root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
  expect(host.querySelector('[data-testid="unmatched-state"]').textContent).toBe("off");
  await act(async () => { host.querySelector('[data-testid="account-kpi-unmatched"]').click(); });
  expect(host.querySelector('[data-testid="unmatched-state"]').textContent).toBe("on");
  expect(host.querySelector('[data-testid="account-kpi-unmatched"]').className).toMatch(/amber/);
});

test("breadcrumb grup tıklanınca seçim temizlenir", async () => {
  function Harness() {
    const [accountId, setAccountId] = useState(integrated.id);
    const [group, setGroup] = useState(null);
    return (
      <div>
        <div data-testid="selection">{accountId || "none"}|{group || "none"}</div>
        {accountId && (
          <BankAccountDetailHeader
            account={integrated}
            groupLabel="Banka"
            groupType="bank"
            canEdit
            onGroupClick={(type) => {
              setAccountId(null);
              setGroup(type);
            }}
          />
        )}
      </div>
    );
  }
  root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
  expect(host.querySelector('[data-testid="account-detail-crumb"]').textContent).toContain("Banka, Kasa & POS");
  expect(host.querySelector('[data-testid="account-detail-crumb"]').textContent).toContain(accountDisplayLabel(integrated));
  await act(async () => { host.querySelector('[data-testid="account-detail-crumb-group"]').click(); });
  expect(host.querySelector('[data-testid="selection"]').textContent).toBe("none|bank");
  expect(host.querySelector('[data-testid="bank-account-detail-header"]')).toBeNull();
});

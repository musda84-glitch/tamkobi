/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { ReconciliationPanel } from "./ReconciliationPanel";
import { formatTrAmount } from "../utils/money";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: { status: "ok" } })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let host;
let root;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockResolvedValue({
    data: {
      read_only: true,
      summary: { account_count: 0, account_drift: 0, partner_count: 1, partner_drift: 1, contact_count: 0, contact_drift: 0 },
      accounts: [],
      contacts: [],
      partners: [{
        id: "ali",
        ad: "Ali BAL",
        kart_bakiyesi: -716189.78,
        kayitli_bakiye: 716189.78,
        liste_giris: 278400,
        liste_cikis: 994589.78,
        liste_net: -716189.78,
        fark: 1432379.56,
      }],
    },
  });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  quiet.mockRestore();
  host.remove();
});

test("partner table uses Giriş / Çıkış and kayıtlı bakiye, not lehine / aleyhine", async () => {
  root = createRoot(host);
  await act(async () => {
    root.render(<ReconciliationPanel companyId="co" />);
  });
  const row = host.querySelector('[data-testid="recon-partner-ali"]');
  expect(row).toBeTruthy();
  expect(host.textContent).toMatch(/Giriş/);
  expect(host.textContent).toMatch(/Çıkış/);
  expect(host.textContent).toMatch(/Kayıtlı/);
  expect(host.textContent).not.toMatch(/Lehine/);
  expect(host.textContent).not.toMatch(/Aleyhine/);
  expect(row.textContent).toContain(formatTrAmount(-716189.78));
  expect(row.textContent).toContain(formatTrAmount(278400));
  expect(row.textContent).toContain(formatTrAmount(994589.78));
});

const ACCOUNT_REPORT = {
  read_only: true,
  summary: { account_count: 3, account_drift: 2, partner_count: 0, partner_drift: 0, contact_count: 0, contact_drift: 0 },
  partners: [],
  contacts: [],
  uyarilar: [{ tur: "cift_iban", anahtar: "…1326:a1,a2", mesaj: "Aynı IBAN 2 hesaba bağlı: Enpara · …1326, Kuveyt Türk · …1326." }],
  accounts: [
    {
      id: "bank75",
      ad: "Vadesiz TL Hesabı",
      tur: "bank",
      bank_name: "Kuveyt Türk",
      masked_ref: "…1234",
      entegre_mi: true,
      gosterilen: 75,
      hareket_toplami: 0,
      banka_bildirdigi: 75,
      fark: 75,
      eslesmemis_adet: 2,
      eslesmemis_tutar: 150.5,
      banka_farki: 75,
      acilis_var: false,
    },
    {
      id: "bank0",
      ad: "Kasa",
      tur: "cash_box",
      entegre_mi: false,
      gosterilen: 10,
      hareket_toplami: 10,
      banka_bildirdigi: null,
      fark: 0,
      eslesmemis_adet: 0,
      eslesmemis_tutar: 0,
      banka_farki: null,
      acilis_var: false,
    },
    {
      id: "hasopen",
      ad: "Ziraat",
      tur: "bank",
      entegre_mi: true,
      gosterilen: 200,
      hareket_toplami: 100,
      banka_bildirdigi: 180,
      fark: 100,
      eslesmemis_adet: 1,
      eslesmemis_tutar: -20,
      banka_farki: 80,
      acilis_var: true,
    },
  ],
};

test("shows unmatched and bank-diff columns, and opening action only when fark remains without an opening tx", async () => {
  axios.get.mockResolvedValue({ data: ACCOUNT_REPORT });
  root = createRoot(host);
  await act(async () => {
    root.render(<ReconciliationPanel companyId="co" />);
  });
  expect(host.textContent).toMatch(/Eşleşmemiş banka hareketi/);
  expect(host.textContent).toMatch(/Banka farkı/);
  expect(host.textContent).toMatch(/Eşleşmemiş banka hareketleri bakiyeye dahildir/);
  const warn = host.querySelector('[data-testid="recon-duplicate-warning"]').textContent;
  expect(warn).toMatch(/Aynı IBAN/);
  expect(warn).toMatch(/Kuveyt Türk/);
  expect(warn).toMatch(/…1326/);
  expect(warn).not.toMatch(/TR330006100519786457841326/);
  const bankRow = host.querySelector('[data-testid="recon-account-bank75"]');
  expect(bankRow.textContent).toContain("Kuveyt Türk · Vadesiz TL Hesabı · …1234 · entegre");
  expect(bankRow.textContent).toContain("Banka hesabı");
  expect(host.querySelector('[data-testid="recon-account-bank0"]').textContent).toContain("Kasa");
  const open = host.querySelector('[data-testid="recon-unmatched-bank75"]');
  expect(open.textContent).toContain("2");
  expect(open.textContent).toContain(formatTrAmount(150.5));
  expect(host.querySelector('[data-testid="recon-bank-diff-bank75"]').textContent).toContain(formatTrAmount(75));
  expect(host.querySelector('[data-testid="recon-unmatched-bank0"]').textContent).toBe("0");
  expect(host.querySelector('[data-testid="recon-bank-diff-bank0"]').textContent).toBe("—");
  expect(host.querySelector('[data-testid="recon-save-opening-bank75"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="recon-save-opening-bank0"]')).toBeNull();
  expect(host.querySelector('[data-testid="recon-save-opening-hasopen"]')).toBeNull();
  expect(host.querySelector('[data-testid="recon-repair-all"]')).toBeNull();
  expect(host.querySelector('[data-testid="recon-repair-balance-bank75"]')).toBeNull();
  expect(host.querySelector('[data-testid="recon-drift-note"]').textContent).toMatch(/önerilmez/);
  expect(host.querySelector('[data-testid="recon-unmatched-hasopen"]').textContent).toContain(formatTrAmount(-20));

  await act(async () => {
    host.querySelector('[data-testid="recon-save-opening-bank75"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(host.querySelector('[data-testid="recon-opening-modal"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="recon-opening-modal"]').textContent).toContain(formatTrAmount(75));
  axios.get.mockResolvedValue({
    data: {
      ...ACCOUNT_REPORT,
      accounts: ACCOUNT_REPORT.accounts.map((row) => (
        row.id === "bank75" ? { ...row, fark: 0, acilis_var: true, hareket_toplami: 75 } : row
      )),
    },
  });
  await act(async () => {
    host.querySelector('[data-testid="recon-opening-confirm"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(axios.post).toHaveBeenCalledWith("/api/banking/accounts/bank75/opening-balance");
  expect(host.querySelector('[data-testid="recon-save-opening-bank75"]')).toBeNull();
  expect(host.querySelector('[data-testid="recon-opening-modal"]')).toBeNull();
});

test("admin previews stored-balance repair and confirms; opening stays but is not the repair", async () => {
  axios.get.mockResolvedValue({
    data: {
      ...ACCOUNT_REPORT,
      accounts: [
        ...ACCOUNT_REPORT.accounts,
        {
          id: "card1",
          ad: "Şirket Kart",
          tur: "credit_card",
          gosterilen: -10,
          hareket_toplami: 0,
          banka_bildirdigi: null,
          fark: -10,
          eslesmemis_adet: 0,
          eslesmemis_tutar: 0,
          banka_farki: null,
          acilis_var: false,
        },
      ],
    },
  });
  root = createRoot(host);
  await act(async () => {
    root.render(<ReconciliationPanel companyId="co" canRepairBalances />);
  });
  expect(host.querySelector('[data-testid="recon-repair-all"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="recon-repair-balance-bank75"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="recon-repair-balance-hasopen"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="recon-repair-balance-bank0"]')).toBeNull();
  expect(host.querySelector('[data-testid="recon-repair-balance-card1"]')).toBeNull();
  expect(host.querySelector('[data-testid="recon-save-opening-bank75"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="recon-save-opening-card1"]')).toBeTruthy();

  axios.post.mockResolvedValueOnce({
    data: {
      dry_run: true,
      affected_count: 2,
      accounts: [
        { id: "bank75", name: "Vadesiz TL Hesabı", type: "bank", stored: 75, ledger: 0, diff: -75, movement_count: 2, integrated: true, bank_reported_balance: 80 },
        { id: "hasopen", name: "Ziraat", type: "bank", stored: 200, ledger: 100, diff: -100, movement_count: 4 },
      ],
    },
  });
  await act(async () => {
    host.querySelector('[data-testid="recon-repair-all"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(axios.post).toHaveBeenCalledWith("/api/banking/accounts/recalculate-balances", {
    company_id: "co",
    dry_run: true,
    account_ids: ["bank75", "hasopen"],
  });
  const modal = host.querySelector('[data-testid="recon-repair-modal"]');
  expect(modal).toBeTruthy();
  expect(host.querySelector('[data-testid="recon-repair-warning"]').textContent).toBe(
    "Kayıtlı bakiye hareket toplamına eşitlenir; hareketler değişmez.",
  );
  expect(host.querySelector('[data-testid="recon-repair-row-bank75"]').textContent).toContain("2");
  expect(host.querySelector('[data-testid="recon-repair-table"]').textContent).toMatch(/Banka bildirdiği/);
  expect(modal.textContent).toContain(formatTrAmount(80));

  axios.post.mockResolvedValueOnce({
    data: {
      dry_run: false,
      affected_count: 2,
      results: [
        { id: "bank75", label: "Vadesiz TL Hesabı", outcome: "ok", reason: "75.00 → 0.00" },
        { id: "hasopen", label: "Ziraat", outcome: "error", reason: "Bakiye değişti, tekrar önizleyin." },
      ],
    },
  });
  await act(async () => {
    host.querySelector('[data-testid="recon-repair-confirm"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(axios.post).toHaveBeenLastCalledWith("/api/banking/accounts/recalculate-balances", {
    company_id: "co",
    dry_run: false,
    account_ids: ["bank75", "hasopen"],
    expected_stored: { bank75: 75, hasopen: 200 },
  });
  const result = host.querySelector('[data-testid="bulk-result-modal"]');
  expect(result).toBeTruthy();
  expect(result.textContent).toContain("Vadesiz TL Hesabı");
  expect(result.textContent).toContain("Bakiye değişti, tekrar önizleyin.");
  expect(host.querySelector('[data-testid="recon-repair-modal"]')).toBeNull();
});

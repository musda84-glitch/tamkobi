import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import axios from "axios";
import { toast } from "sonner";
import { TenantNotifyPanel } from "./TenantNotifyPanel";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test/api",
}));

beforeEach(() => {
  axios.get.mockReset();
  axios.put.mockReset();
  toast.success.mockClear();
  toast.error.mockClear();
});

const EVENT_ORDER = [
  "einvoice_incoming",
  "order_new",
  "gib_credits_low",
  "receivable_overdue",
  "bank_sync",
  "cash_approval",
  "pos_approval",
  "pos_daily_summary",
  "order_pick_production",
  "attendance_alert",
  "leave_request",
  "advance_request",
  "overtime_request",
];

const APPROVAL = new Set([
  "cash_approval",
  "pos_approval",
  "leave_request",
  "advance_request",
  "overtime_request",
]);

const LEGACY = new Set(["einvoice_incoming", "order_new", "gib_credits_low", "receivable_overdue"]);

const GROUPS = {
  einvoice_incoming: "sales_invoice",
  order_new: "sales_invoice",
  gib_credits_low: "sales_invoice",
  receivable_overdue: "sales_invoice",
  bank_sync: "bank_cash_pos",
  cash_approval: "bank_cash_pos",
  pos_approval: "bank_cash_pos",
  pos_daily_summary: "bank_cash_pos",
  order_pick_production: "production_warehouse",
  attendance_alert: "personnel",
  leave_request: "personnel",
  advance_request: "personnel",
  overtime_request: "personnel",
};

const LABELS = {
  einvoice_incoming: "Gelen e-Fatura",
  order_new: "Yeni sipariş",
  gib_credits_low: "GİB kontör düşük",
  receivable_overdue: "Vadesi geçmiş alacak",
  bank_sync: "Banka hareketi (senkron)",
  cash_approval: "Kasa/banka onayı",
  pos_approval: "POS onayı",
  pos_daily_summary: "Günlük POS özeti",
  order_pick_production: "Üretime gönderildi (sipariş hazırlama)",
  attendance_alert: "Mesai uyarısı (geç/eksik giriş, konum)",
  leave_request: "İzin talebi",
  advance_request: "Avans talebi",
  overtime_request: "Fazla mesai / yevmiye onayı",
};

function channel(platform, tenant, { locked = false, lock_reason = null } = {}) {
  return { platform, tenant, effective: platform && tenant, locked, lock_reason };
}

function view(overrides = {}) {
  const events = {};
  for (const key of EVENT_ORDER) {
    const emailOn = LEGACY.has(key);
    const inappLocked = APPROVAL.has(key);
    events[key] = {
      group: GROUPS[key],
      inapp: channel(true, true, inappLocked ? { locked: true, lock_reason: "approval" } : {}),
      email: emailOn
        ? channel(true, true)
        : channel(false, true, { locked: true, lock_reason: "platform" }),
    };
  }
  events.einvoice_incoming.email = channel(false, true, { locked: true, lock_reason: "platform" });
  return {
    labels: LABELS,
    events: { ...events, ...overrides },
  };
}

async function renderPanel(props) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<TenantNotifyPanel companyId="comp1" {...props} />);
  });
  await act(async () => {});
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

test("grup başlıkları ve on üç olay satırı", async () => {
  axios.get.mockResolvedValue({ data: view() });
  const { host, cleanup } = await renderPanel({ canEdit: true });
  expect(host.querySelector('[data-testid="tenant-notify-table"]')).toBeTruthy();
  expect(host.querySelectorAll("[data-testid^='tenant-notify-event-']")).toHaveLength(13);
  const text = host.textContent;
  const sales = text.indexOf("Satış / Fatura");
  const bank = text.indexOf("Banka / Kasa / POS");
  const prod = text.indexOf("Üretim / Depo");
  const staff = text.indexOf("Personel");
  expect(sales).toBeGreaterThanOrEqual(0);
  expect(sales).toBeLessThan(bank);
  expect(bank).toBeLessThan(prod);
  expect(prod).toBeLessThan(staff);
  expect(host.querySelector('[data-testid="tenant-notify-group-sales_invoice"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tenant-notify-group-bank_cash_pos"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tenant-notify-group-production_warehouse"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tenant-notify-group-personnel"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tenant-notify-event-einvoice_incoming"]')?.textContent).toMatch(/Gelen e-Fatura/);
  expect(host.querySelector('[data-testid="tenant-notify-event-bank_sync"]')?.textContent).toMatch(/Banka hareketi/);
  expect(host.querySelector('[data-testid="tenant-notify-event-order_pick_production"]')?.textContent).toMatch(/Üretime gönderildi/);
  expect(host.querySelector('[data-testid="tenant-notify-event-leave_request"]')?.textContent).toMatch(/İzin talebi/);
  expect(text).toMatch(/Uygulama/);
  expect(text).toMatch(/E-posta/);
  expect(text).not.toMatch(/SMS/);
  expect(host.querySelector('[data-testid="notify-extra-emails"]')).toBeNull();
  cleanup();
});

test("sunucu grubu satırı sabit listenin ilgili başlığına taşır", async () => {
  const data = view();
  data.events.order_pick_production = {
    ...data.events.order_pick_production,
    group: "personnel",
  };
  axios.get.mockResolvedValue({ data });
  const { host, cleanup } = await renderPanel({ canEdit: true });
  expect(host.querySelector('[data-testid="tenant-notify-group-production_warehouse"]')).toBeNull();
  const staff = host.querySelector('[data-testid="tenant-notify-group-personnel"]');
  const row = host.querySelector('[data-testid="tenant-notify-event-order_pick_production"]');
  expect(staff.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  cleanup();
});

test("kilitli kanallar pasif ve notlu", async () => {
  axios.get.mockResolvedValue({ data: view() });
  const { host, cleanup } = await renderPanel({ canEdit: true });
  const email = host.querySelector('[data-testid="tenant-notify-einvoice_incoming-email"]');
  expect(email.disabled).toBe(true);
  expect(email.title).toMatch(/Platform Yönetimi'nden kapalı/);
  expect(host.querySelector('[data-testid="tenant-notify-einvoice_incoming-email-lock"]')?.textContent).toMatch(
    /Platform Yönetimi'nden kapalı/,
  );
  const bankEmail = host.querySelector('[data-testid="tenant-notify-bank_sync-email"]');
  expect(bankEmail.disabled).toBe(true);
  expect(host.querySelector('[data-testid="tenant-notify-bank_sync-email-lock"]')?.textContent).toMatch(
    /Platform Yönetimi'nden kapalı/,
  );
  const approval = host.querySelector('[data-testid="tenant-notify-leave_request-inapp"]');
  expect(approval.disabled).toBe(true);
  expect(approval.checked).toBe(true);
  expect(approval.title).toMatch(/Onay bildirimi, kapatılamaz/);
  expect(host.querySelector('[data-testid="tenant-notify-cash_approval-inapp"]').disabled).toBe(true);
  const inapp = host.querySelector('[data-testid="tenant-notify-einvoice_incoming-inapp"]');
  expect(inapp.disabled).toBe(false);
  const bankInapp = host.querySelector('[data-testid="tenant-notify-bank_sync-inapp"]');
  expect(bankInapp.disabled).toBe(false);
  cleanup();
});

test("kayıt gövdesi yalnız değişen olay ve kanal", async () => {
  axios.get.mockResolvedValue({ data: view() });
  axios.put.mockResolvedValue({ data: view() });
  const { host, cleanup } = await renderPanel({ canEdit: true });
  const orderEmail = host.querySelector('[data-testid="tenant-notify-order_new-email"]');
  const bankInapp = host.querySelector('[data-testid="tenant-notify-bank_sync-inapp"]');
  await act(async () => {
    orderEmail.click();
    bankInapp.click();
  });
  await act(async () => {
    host.querySelector('[data-testid="tenant-notify-save"]').click();
  });
  expect(axios.put).toHaveBeenCalledWith(
    "http://test/api/notify/tenant-prefs",
    {
      events: {
        order_new: { email: false },
        bank_sync: { inapp: false },
      },
    },
    expect.objectContaining({ params: { company_id: "comp1" } }),
  );
  const body = axios.put.mock.calls[0][1];
  expect(Object.keys(body)).toEqual(["events"]);
  expect(Object.keys(body.events).sort()).toEqual(["bank_sync", "order_new"]);
  for (const row of Object.values(body.events)) {
    expect(Object.values(row).every((v) => typeof v === "boolean")).toBe(true);
  }
  expect(toast.success).toHaveBeenCalled();
  cleanup();
});

test("422 mesajı toast olarak görünür", async () => {
  axios.get.mockResolvedValue({ data: view() });
  axios.put.mockRejectedValue({
    response: { data: { detail: "Bu kanal Platform Yönetimi'nden kapatıldı." } },
  });
  const { host, cleanup } = await renderPanel({ canEdit: true });
  await act(async () => {
    host.querySelector('[data-testid="tenant-notify-order_new-inapp"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="tenant-notify-save"]').click();
  });
  expect(toast.error).toHaveBeenCalledWith("Bu kanal Platform Yönetimi'nden kapatıldı.");
  cleanup();
});

test("etiket sunucuda yoksa yedek Türkçe metin", async () => {
  const data = view();
  delete data.labels.bank_sync;
  axios.get.mockResolvedValue({ data });
  const { host, cleanup } = await renderPanel({ canEdit: true });
  expect(host.querySelector('[data-testid="tenant-notify-event-bank_sync"]')?.textContent).toMatch(
    /Banka hareketi \(senkron\)/,
  );
  cleanup();
});

test("firma admini olmayan salt okur", async () => {
  axios.get.mockResolvedValue({ data: view() });
  const { host, cleanup } = await renderPanel({ canEdit: false });
  expect(host.querySelector('[data-testid="tenant-notify-readonly"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tenant-notify-save"]')).toBeNull();
  for (const key of EVENT_ORDER) {
    expect(host.querySelector(`[data-testid="tenant-notify-${key}-inapp"]`).disabled).toBe(true);
    expect(host.querySelector(`[data-testid="tenant-notify-${key}-email"]`).disabled).toBe(true);
  }
  const box = host.querySelector('[data-testid="tenant-notify-order_new-inapp"]');
  await act(async () => {
    box.click();
  });
  expect(axios.put).not.toHaveBeenCalled();
  cleanup();
});

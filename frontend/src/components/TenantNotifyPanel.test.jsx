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

const EVENTS = ["einvoice_incoming", "order_new", "gib_credits_low", "receivable_overdue"];

function channel(platform, tenant) {
  return { platform, tenant, effective: platform && tenant };
}

function view(overrides = {}) {
  const events = {};
  for (const key of EVENTS) {
    events[key] = {
      inapp: channel(true, true),
      email: channel(true, true),
    };
  }
  events.einvoice_incoming.email = channel(false, true);
  return {
    labels: {
      einvoice_incoming: "Gelen e-Fatura",
      order_new: "Yeni sipariş",
      gib_credits_low: "GİB kontör düşük",
      receivable_overdue: "Vadesi geçmiş alacak",
    },
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

test("dört olay ve uygulama/e-posta sütunları görünür", async () => {
  axios.get.mockResolvedValue({ data: view() });
  const { host, cleanup } = await renderPanel({ canEdit: true });
  expect(host.querySelector('[data-testid="tenant-notify-table"]')).toBeTruthy();
  expect(host.querySelectorAll("[data-testid^='tenant-notify-event-']")).toHaveLength(4);
  expect(host.querySelector('[data-testid="tenant-notify-event-bank_sync"]')).toBeNull();
  expect(host.querySelector('[data-testid="tenant-notify-event-einvoice_incoming"]')?.textContent).toMatch(/Gelen e-Fatura/);
  expect(host.querySelector('[data-testid="tenant-notify-event-order_new"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tenant-notify-event-gib_credits_low"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tenant-notify-event-receivable_overdue"]')).toBeTruthy();
  expect(host.textContent).toMatch(/Uygulama/);
  expect(host.textContent).toMatch(/E-posta/);
  expect(host.textContent).not.toMatch(/SMS/);
  expect(host.querySelector('[data-testid="notify-extra-emails"]')).toBeNull();
  expect(host.querySelector('[data-testid="notify-order-batch-minutes"]')).toBeNull();
  cleanup();
});

test("platform kapalı kanal pasif ve notlu", async () => {
  axios.get.mockResolvedValue({ data: view() });
  const { host, cleanup } = await renderPanel({ canEdit: true });
  const email = host.querySelector('[data-testid="tenant-notify-einvoice_incoming-email"]');
  expect(email.disabled).toBe(true);
  expect(host.querySelector('[data-testid="tenant-notify-einvoice_incoming-email-platform-off"]')?.textContent).toMatch(
    /Platform tarafından kapalı/,
  );
  const inapp = host.querySelector('[data-testid="tenant-notify-einvoice_incoming-inapp"]');
  expect(inapp.disabled).toBe(false);
  cleanup();
});

test("kayıt gövdesi yalnız sekiz boolean", async () => {
  axios.get.mockResolvedValue({ data: view() });
  axios.put.mockResolvedValue({ data: view() });
  const { host, cleanup } = await renderPanel({ canEdit: true });
  const orderEmail = host.querySelector('[data-testid="tenant-notify-order_new-email"]');
  await act(async () => {
    orderEmail.click();
  });
  await act(async () => {
    host.querySelector('[data-testid="tenant-notify-save"]').click();
  });
  expect(axios.put).toHaveBeenCalledWith(
    "http://test/api/notify/tenant-prefs",
    {
      events: {
        einvoice_incoming: { inapp: true, email: true },
        order_new: { inapp: true, email: false },
        gib_credits_low: { inapp: true, email: true },
        receivable_overdue: { inapp: true, email: true },
      },
    },
    expect.objectContaining({ params: { company_id: "comp1" } }),
  );
  const body = axios.put.mock.calls[0][1];
  const flags = [];
  for (const row of Object.values(body.events)) {
    flags.push(row.inapp, row.email);
    expect(Object.keys(row).sort()).toEqual(["email", "inapp"]);
  }
  expect(flags).toHaveLength(8);
  expect(flags.every((v) => typeof v === "boolean")).toBe(true);
  expect(Object.keys(body)).toEqual(["events"]);
  expect(toast.success).toHaveBeenCalled();
  cleanup();
});

test("firma admini olmayan salt okur", async () => {
  axios.get.mockResolvedValue({ data: view() });
  const { host, cleanup } = await renderPanel({ canEdit: false });
  expect(host.querySelector('[data-testid="tenant-notify-readonly"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="tenant-notify-save"]')).toBeNull();
  for (const key of EVENTS) {
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

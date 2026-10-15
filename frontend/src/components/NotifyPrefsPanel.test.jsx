import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import axios from "axios";
import { NotifyPrefsPanel } from "./NotifyPrefsPanel";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test/api",
}));

const SAMPLE = {
  company_id: "comp1",
  events: {
    einvoice_incoming: { inapp: true, email: true, sms: false, digest: "instant" },
    order_new: { inapp: true, email: true, sms: false, digest: "instant" },
    gib_credits_low: { inapp: true, email: true, sms: false, digest: "instant" },
    receivable_overdue: { inapp: true, email: true, sms: false, digest: "instant" },
  },
  extra_emails: [],
  email_from: "platform",
  gib_credits_threshold: 20,
  event_labels: {
    einvoice_incoming: "Gelen e-Fatura",
    order_new: "Yeni sipariş",
    gib_credits_low: "GİB kontör düşük",
    receivable_overdue: "Vadesi geçmiş alacak",
  },
};

test("Bildirimler paneli olayları ve kaydetmeyi gösterir", async () => {
  axios.get.mockResolvedValue({ data: SAMPLE });
  axios.put.mockResolvedValue({ data: { ...SAMPLE, extra_emails: ["a@b.com"] } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<NotifyPrefsPanel companyId="comp1" />);
  });
  await act(async () => {});
  expect(host.querySelector('[data-testid="notify-prefs-panel"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="notify-event-einvoice_incoming"]')?.textContent).toMatch(/Gelen e-Fatura/);
  expect(host.querySelector('[data-testid="notify-event-order_new"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="notify-email-from"]')).toBeTruthy();
  const emailOff = host.querySelector('[data-testid="notify-order_new-email"]');
  expect(emailOff).toBeTruthy();
  await act(async () => {
    emailOff.click();
  });
  await act(async () => {
    host.querySelector('[data-testid="notify-prefs-save"]').click();
  });
  expect(axios.put).toHaveBeenCalledWith(
    "http://test/api/notify/prefs",
    expect.objectContaining({
      company_id: "comp1",
      events: expect.objectContaining({
        order_new: expect.objectContaining({ email: false }),
      }),
    }),
  );
  root.unmount();
  host.remove();
});

test("Gruplama süresi seçilir ve kayda gider", async () => {
  axios.get.mockResolvedValue({
    data: {
      ...SAMPLE,
      events: {
        ...SAMPLE.events,
        order_new: { inapp: true, email: true, sms: false, digest: "batch", batch_minutes: 10 },
      },
    },
  });
  axios.put.mockResolvedValue({
    data: {
      ...SAMPLE,
      events: {
        ...SAMPLE.events,
        order_new: { inapp: true, email: true, sms: false, digest: "batch", batch_minutes: 30 },
      },
    },
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<NotifyPrefsPanel companyId="comp1" />);
  });
  await act(async () => {});
  const sel = host.querySelector('[data-testid="notify-order-batch-minutes"]');
  expect(sel).toBeTruthy();
  expect(sel.value).toBe("10");
  expect(sel.textContent).toMatch(/Hemen/);
  expect(sel.textContent).toMatch(/60 dk/);
  expect(host.querySelector('[data-testid="notify-order-batch-note"]')?.textContent).toMatch(
    /Uygulama içi bildirim ve push her zaman anında gelir/,
  );
  expect(host.querySelector('[data-testid="notify-order_new-digest"]')?.textContent).toMatch(/Grupla/);
  expect(host.querySelector('[data-testid="notify-order_new-digest"]')?.textContent).toMatch(/Saatlik özet/);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  await act(async () => {
    setter.call(sel, "30");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector('[data-testid="notify-prefs-save"]').click();
  });
  expect(axios.put).toHaveBeenCalledWith(
    "http://test/api/notify/prefs",
    expect.objectContaining({
      company_id: "comp1",
      events: expect.objectContaining({
        order_new: expect.objectContaining({ batch_minutes: 30, digest: "batch" }),
      }),
    }),
  );
  root.unmount();
  host.remove();
});

test("platform mode PUT yeni uç noktaya gider, limit ve sayaçlar görünür", async () => {
  axios.get.mockResolvedValue({
    data: {
      ...SAMPLE,
      daily_email_cap: 20,
      notify_daily_email_cap_default: 50,
      email_usage: { sent_24h: 3, sent_30d: 11, deferred_24h: 1, deferred_30d: 2, deferred: 1 },
    },
  });
  axios.put.mockResolvedValue({
    data: {
      ...SAMPLE,
      daily_email_cap: 20,
      extra_emails: [],
      email_usage: { sent_24h: 3, sent_30d: 11, deferred_24h: 1, deferred_30d: 2, deferred: 1 },
    },
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<NotifyPrefsPanel mode="platform" companyId="comp1" />);
  });
  await act(async () => {});
  expect(axios.get).toHaveBeenCalledWith(
    "http://test/api/saas/companies/comp1/notify-prefs",
    expect.objectContaining({ withCredentials: true }),
  );
  expect(host.querySelector('[data-testid="notify-daily-email-cap"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="notify-daily-email-cap"]').value).toBe("20");
  expect(host.querySelector('[data-testid="notify-email-usage"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="notify-sent-24h"]')?.textContent).toMatch(/3/);
  expect(host.querySelector('[data-testid="notify-sent-30d"]')?.textContent).toMatch(/11/);
  expect(host.querySelector('[data-testid="notify-deferred"]')?.textContent).toMatch(/1/);
  await act(async () => {
    host.querySelector('[data-testid="notify-prefs-save"]').click();
  });
  expect(axios.put).toHaveBeenCalledWith(
    "http://test/api/saas/companies/comp1/notify-prefs",
    expect.objectContaining({ daily_email_cap: 20 }),
    expect.objectContaining({ withCredentials: true }),
  );
  root.unmount();
  host.remove();
});

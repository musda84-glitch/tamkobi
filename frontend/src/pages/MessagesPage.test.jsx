import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import axios from "axios";
import MessagesPage from "./MessagesPage";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

let host;
let root;

const panel = {
  unread_total: 1,
  self_user_id: "me",
  next_cursor: null,
  mode: "manager",
  managers: [{ id: "u2", name: "Ayşe Yönetici" }],
  directory: [{ id: "e1", full_name: "Mehmet Kaya", position: "Usta" }],
  chats: [
    { key: "m:u2", kind: "manager", id: "u2", name: "Ayşe Yönetici", preview: "selam", unread: 1, at: "2026-10-23T14:32:00", own: false, last: { id: "m1", body: "selam", created_at: "2026-10-23T14:32:00", from_user_id: "u2" } },
    { key: "e:e9", kind: "emp", id: "e9", name: "Okunmuş Kişi", preview: "eski", unread: 0, at: "2026-10-20T10:00:00", own: true, last: { id: "m0", body: "eski", created_at: "2026-10-20T10:00:00", from_user_id: "me" } },
  ],
};

const thread = {
  mode: "thread",
  self_user_id: "me",
  to_user: { id: "u2", name: "Ayşe Yönetici" },
  thread: [
    { id: "m1", body: "selam", created_at: "2026-10-23T14:32:00", from_user_id: "u2", from_name: "Ayşe", read_at: null },
  ],
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.post.mockReset();
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/personnel/messages/panel")) return Promise.resolve({ data: panel });
    if (u.includes("/personnel/messages")) return Promise.resolve({ data: thread });
    return Promise.resolve({ data: {} });
  });
  axios.post.mockResolvedValue({ data: { status: "success" } });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderPage(entry = "/mesajlar") {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <MessagesPage />
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function setValue(el, value) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

test("Enter ile mesaj gönderir", async () => {
  await renderPage();
  await act(async () => {
    host.querySelector("[data-testid='messages-row-u2']").click();
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  expect(host.querySelector("[data-testid='messages-title']").textContent).toContain("Ayşe Yönetici");
  expect(host.textContent).toContain("selam");
  const draft = host.querySelector("[data-testid='messages-draft']");
  await act(async () => { setValue(draft, "merhaba"); });
  await act(async () => {
    draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  const sent = axios.post.mock.calls.find((call) => String(call[0]).endsWith("/personnel/messages"));
  expect(sent).toBeTruthy();
  expect(sent[1]).toEqual({ body: "merhaba", to_user_id: "u2" });
});

test("yeni mesaj kişi seçiminde yöneticiler ve personel gruplanır", async () => {
  await renderPage();
  await act(async () => {
    host.querySelector("[data-testid='messages-new']").click();
  });
  const picker = host.querySelector("[data-testid='messages-picker']");
  expect(picker).toBeTruthy();
  const text = picker.textContent;
  expect(text.indexOf("Yöneticiler")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("Personel")).toBeGreaterThan(text.indexOf("Yöneticiler"));
  expect(host.querySelector("[data-testid='messages-pick-m:u2']")).toBeTruthy();
  expect(host.querySelector("[data-testid='messages-pick-e:e1']")).toBeTruthy();
  await act(async () => {
    host.querySelector("[data-testid='messages-pick-e:e1']").click();
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  const opened = axios.get.mock.calls.find((call) => {
    const u = String(call[0]);
    return u.includes("/personnel/messages") && !u.includes("/panel") && call[1]?.params?.employee_id === "e1";
  });
  expect(opened).toBeTruthy();
});

test("403 yetki mesajını gösterir", async () => {
  axios.get.mockRejectedValue({ response: { status: 403, data: { detail: "Mesajları görmek için personel kartı veya yönetici yetkisi gerekir." } } });
  await renderPage();
  expect(host.querySelector("[data-testid='messages-denied']")).toBeTruthy();
  expect(host.querySelector("[data-testid='messages-forbidden']").textContent).toContain("yetkisi gerekir");
});

test("okunmamış filtresi okunmuş sohbeti listeden çıkarır", async () => {
  await renderPage();
  expect(host.textContent).toContain("Okunmuş Kişi");
  await act(async () => {
    host.querySelector("[data-testid='messages-filter-unread']").click();
  });
  expect(host.textContent).not.toContain("Okunmuş Kişi");
  expect(host.textContent).toContain("Ayşe Yönetici");
});

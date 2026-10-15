import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import axios from "axios";
import { toast } from "sonner";
import { PlatformMailInbox } from "./PlatformMailInbox";
import { PlatformMailPanel } from "./PlatformMailPanel";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "/api" }));

const mailboxes = [
  { id: "pmb1", email: "destek@tamkobi.com", display_name: "Destek", is_active: true },
];

const listBody = {
  page: 1,
  page_size: 50,
  total: 2,
  messages: [
    { uid: "5", from: "Ada <ada@ex.com>", subject: "Yeni", date: "2026-10-15T09:00:00+00:00", seen: false, has_attachments: true },
    { uid: "4", from: "Bea <bea@ex.com>", subject: "Eski", date: "2026-10-14T09:00:00+00:00", seen: true, has_attachments: false },
  ],
};

const messageBody = {
  uid: "5",
  from: "Ada <ada@ex.com>",
  subject: "Yeni",
  date: "2026-10-15T09:00:00+00:00",
  seen: false,
  has_attachments: true,
  text: "duz metin",
  html: "<p>Merhaba</p>",
  images_blocked: true,
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  axios.get.mockReset();
  axios.post.mockReset();
  axios.get.mockImplementation((url) => {
    const target = String(url);
    if (target.includes("/messages/")) return Promise.resolve({ data: messageBody });
    if (target.includes("/messages")) return Promise.resolve({ data: listBody });
    if (target.includes("/system/mail")) {
      return Promise.resolve({
        data: {
          servers: [],
          mailboxes,
          admins: [],
          purposes: [],
          presets: [],
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
});

async function render(node) {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

test("lists unread mail in bold and reads without a password field", async () => {
  await render(<PlatformMailInbox mailboxes={mailboxes} />);
  const rootEl = host.querySelector("[data-testid='platform-mail-inbox']");
  expect(rootEl).toBeTruthy();
  expect(rootEl.className).toContain("max-md:hidden");
  expect(host.querySelector("[data-testid='mail-inbox-mailbox']").value).toBe("pmb1");
  const unread = host.querySelector("[data-testid='mail-inbox-row-5']");
  const read = host.querySelector("[data-testid='mail-inbox-row-4']");
  expect(unread.className).toContain("font-bold");
  expect(unread.getAttribute("data-seen")).toBe("0");
  expect(read.className).not.toContain("font-bold");
  expect(read.getAttribute("data-seen")).toBe("1");
  expect(host.querySelector("input[type='password']")).toBeNull();
  expect(host.textContent).not.toMatch(/Yanıtla/);

  await act(async () => {
    unread.click();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(axios.post).not.toHaveBeenCalled();
  const frame = host.querySelector("[data-testid='mail-inbox-html']");
  expect(frame.getAttribute("srcdoc")).toContain("Merhaba");
  expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
  expect(host.querySelector("[data-testid='mail-inbox-show-images']").textContent).toContain("Resimleri göster");
  expect(host.querySelector("[data-testid='mail-inbox-toggle-seen']").textContent).toContain("Okundu işaretle");
});

test("toggles seen, refreshes, and can show images", async () => {
  axios.post.mockResolvedValue({ data: { uid: "5", seen: true } });
  axios.get.mockImplementation((url, config) => {
    const target = String(url);
    if (config && config.params && config.params.images === 1) {
      return Promise.resolve({
        data: { ...messageBody, html: "<p>Merhaba</p><img src=\"https://cdn.example/a.png\" alt=\"a\">", images_blocked: false },
      });
    }
    if (target.includes("/messages/")) return Promise.resolve({ data: messageBody });
    if (target.includes("/messages")) return Promise.resolve({ data: listBody });
    return Promise.resolve({ data: {} });
  });
  await render(<PlatformMailInbox mailboxes={mailboxes} />);
  await act(async () => {
    host.querySelector("[data-testid='mail-inbox-row-5']").click();
    await Promise.resolve();
  });
  await act(async () => {
    host.querySelector("[data-testid='mail-inbox-toggle-seen']").click();
    await Promise.resolve();
  });
  expect(axios.post).toHaveBeenCalledWith(
    "/api/system/mail/mailboxes/pmb1/messages/5/seen",
    { seen: true },
    { withCredentials: true },
  );
  expect(host.querySelector("[data-testid='mail-inbox-row-5']").className).not.toContain("font-bold");
  expect(host.querySelector("[data-testid='mail-inbox-toggle-seen']").textContent).toContain("Okunmadı işaretle");

  const before = axios.get.mock.calls.length;
  await act(async () => {
    host.querySelector("[data-testid='mail-inbox-refresh']").click();
    await Promise.resolve();
  });
  expect(axios.get.mock.calls.length).toBeGreaterThan(before);

  await act(async () => {
    host.querySelector("[data-testid='mail-inbox-show-images']").click();
    await Promise.resolve();
  });
  const imageCall = axios.get.mock.calls.find((call) => call[1] && call[1].params && call[1].params.images === 1);
  expect(imageCall[0]).toBe("/api/system/mail/mailboxes/pmb1/messages/5");
  expect(host.querySelector("[data-testid='mail-inbox-show-images']")).toBeNull();
  expect(host.querySelector("[data-testid='mail-inbox-html']").getAttribute("srcdoc")).toContain("https://cdn.example/a.png");
});

test("posta paneli gelen kutusunu mevcut formların yanında gösterir", async () => {
  await render(<PlatformMailPanel />);
  expect(host.querySelector("[data-testid='mail-server-form']")).toBeTruthy();
  expect(host.querySelector("[data-testid='mail-box-form']")).toBeTruthy();
  expect(host.querySelector("[data-testid='platform-mail-inbox']")).toBeTruthy();
  expect(host.querySelector("[data-testid='platform-mail-inbox']").className).toContain("max-md:hidden");
  expect(host.querySelector("[data-testid='mail-inbox-password-hint']")).toBeNull();
});

test("şifresi olmayan kutu hata mesajını, yönlendirmeyi ve düzenle düğmesini gösterir", async () => {
  toast.error.mockClear();
  const onEdit = jest.fn();
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/messages")) {
      return Promise.reject({ response: { data: { detail: "Bu kutunun şifresi tanımlı değil." } } });
    }
    return Promise.resolve({ data: {} });
  });
  await render(<PlatformMailInbox mailboxes={mailboxes} onEdit={onEdit} />);
  const section = host.querySelector("[data-testid='platform-mail-inbox']");
  const hint = host.querySelector("[data-testid='mail-inbox-password-hint']");
  expect(section.className).toContain("max-md:hidden");
  expect(section.contains(hint)).toBe(true);
  expect(hint.textContent).toContain("Bu kutunun şifresi tanımlı değil.");
  expect(hint.textContent).toContain("Kutuyu düzenleyip şifre girin.");
  expect(host.querySelector("[data-testid='mail-inbox-edit-password']").textContent).toContain("Düzenle");
  expect(host.querySelector("[data-testid='mail-inbox-empty']")).toBeNull();
  expect(toast.error).toHaveBeenCalledWith("Bu kutunun şifresi tanımlı değil.");
  expect(host.textContent).not.toMatch(/password_enc|box-mail-secret|server-smtp-secret/);
  await act(async () => {
    host.querySelector("[data-testid='mail-inbox-edit-password']").click();
  });
  expect(onEdit).toHaveBeenCalledWith("pmb1");
});

test("gönderim şifre hatasında aynı yönlendirme ve düzenle düğmesi açılır", async () => {
  toast.error.mockClear();
  axios.post.mockRejectedValue({
    response: { data: { detail: "SMTP şifresi tanımlı değil (sunucu veya kutu)." } },
  });
  await render(<PlatformMailPanel />);
  expect(host.querySelector("[data-testid='mail-inbox-row-5']")).toBeTruthy();
  expect(host.querySelector("[data-testid='mail-inbox-password-hint']")).toBeNull();
  await act(async () => {
    host.querySelector("[data-testid='mail-box-test-pmb1']").click();
    await Promise.resolve();
    await Promise.resolve();
  });
  const section = host.querySelector("[data-testid='platform-mail-inbox']");
  const hint = host.querySelector("[data-testid='mail-inbox-password-hint']");
  expect(section.className).toContain("max-md:hidden");
  expect(section.contains(hint)).toBe(true);
  expect(hint.textContent).toContain("SMTP şifresi tanımlı değil (sunucu veya kutu).");
  expect(hint.textContent).toContain("Kutuyu düzenleyip şifre girin.");
  expect(toast.error).toHaveBeenCalledWith("SMTP şifresi tanımlı değil (sunucu veya kutu).");
  await act(async () => {
    host.querySelector("[data-testid='mail-inbox-edit-password']").click();
  });
  expect(host.querySelector("[data-testid='mail-box-email']").value).toBe("destek@tamkobi.com");
  expect(host.querySelector("[data-testid='mail-box-password']").value).toBe("");
  expect(host.textContent).toContain("Gönderen kimliğini düzenle");
});

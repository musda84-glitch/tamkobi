import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { StaffMessagesPanel } from "./StaffMessagesPanel";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}), { virtual: true });

let host;
let root;

const sample = {
  unread_total: 2,
  self_user_id: "me",
  chats: [
    { key: "m:u2", kind: "manager", id: "u2", name: "Ayşe Yılmaz", preview: "Yarınki toplantı", unread: 1, at: "2026-10-23T14:32:00", own: false, last: { body: "Yarınki toplantı notlarını paylaşır mısın?", created_at: "2026-10-23T14:32:00", from_user_id: "u2" } },
    { key: "e:e1", kind: "emp", id: "e1", name: "Mehmet Kaya", preview: "Raporu inceledim", unread: 0, at: "2026-10-23T11:15:00", own: true, last: { body: "Raporu inceledim, harika görünüyor.", created_at: "2026-10-23T11:15:00", from_user_id: "me" } },
    { key: "e:e2", kind: "emp", id: "e2", name: "Zeynep Demir", preview: "İzin formunu imzaladım", unread: 1, at: "2026-10-22T18:45:00", own: false, last: { body: "İzin formunu imzaladım.", created_at: "2026-10-22T18:45:00", from_user_id: "z" } },
    { key: "e:e3", kind: "emp", id: "e3", name: "Dördüncü Kişi", preview: "gizli", unread: 0, at: "2026-10-20T10:00:00", own: false, last: { body: "gizli", created_at: "2026-10-20T10:00:00", from_user_id: "x" } },
  ],
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.post.mockReset();
  axios.get.mockResolvedValue({ data: { unread_total: 0, chats: [], self_user_id: "me" } });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderCard(props) {
  root = createRoot(host);
  await act(async () => {
    root.render(<StaffMessagesPanel variant="overview" testId="dashboard-messages" {...props} />);
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

test("boş kart /mesajlar linki ve boş durum metnini gösterir", async () => {
  await renderCard();
  expect(host.textContent).toContain("Yeni mesaj yok · Ekibinizle panel içinden yazışın.");
  expect(host.querySelector("[data-testid='dashboard-messages-all']")?.getAttribute("href")).toBe("/mesajlar");
  expect(host.querySelector("[data-testid='dashboard-messages-new']")?.getAttribute("href")).toBe("/mesajlar?yeni=1");
  expect(host.textContent).not.toContain("/personelim");
});

test("kart son 3 sohbeti, rozeti, Siz: önekini ve okunmamış noktasını gösterir", async () => {
  axios.get.mockResolvedValue({ data: sample });
  await renderCard();
  expect(host.querySelector("[data-testid='dashboard-messages-unread']").textContent).toBe("2");
  expect(host.textContent).toContain("Ayşe Yılmaz");
  expect(host.textContent).toContain("Mehmet Kaya");
  expect(host.textContent).toContain("Zeynep Demir");
  expect(host.textContent).not.toContain("Dördüncü Kişi");
  expect(host.textContent).toContain("Siz: Raporu inceledim");
  expect(host.querySelector("[data-testid='dashboard-messages-dot-u2']")).toBeTruthy();
  expect(host.querySelector("[data-testid='dashboard-messages-dot-e1']")).toBeNull();
  expect(host.querySelector("[data-testid='dashboard-messages-row-u2']")?.getAttribute("href")).toBe("/mesajlar?c=m%3Au2");
});

test("403 kartı gizlemez, yetki mesajı gösterir", async () => {
  axios.get.mockRejectedValue({ response: { status: 403, data: { detail: "Mesajları görmek için personel kartı veya yönetici yetkisi gerekir." } } });
  await renderCard();
  expect(host.querySelector("[data-testid='dashboard-messages']")).toBeTruthy();
  expect(host.querySelector("[data-testid='dashboard-messages-forbidden']").textContent).toContain("yetkisi gerekir");
});

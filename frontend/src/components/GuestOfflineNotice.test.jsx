/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import GuestOfflineNotice from "./GuestOfflineNotice";
import { setOnlineForTests } from "../offline/policy";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => setOnlineForTests(null));

async function renderNotice() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<GuestOfflineNotice />);
  });
  return {
    host,
    async cleanup() {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

test("çevrimiçiyken uyarı çizilmez", async () => {
  setOnlineForTests(true);
  const { host, cleanup } = await renderNotice();
  expect(host.querySelector('[data-testid="guest-offline-notice"]')).toBeNull();
  expect(host.textContent).not.toMatch(/Çevrimiçi|Bekleyen|Son senkron/);
  await cleanup();
});

test("gerçekten çevrimdışıyken kısa uyarı görünür ve bağlantı gelince kalkar", async () => {
  setOnlineForTests(false);
  const { host, cleanup } = await renderNotice();
  const notice = host.querySelector('[data-testid="guest-offline-notice"]');
  expect(notice).toBeTruthy();
  expect(notice.textContent).toBe("İnternet bağlantısı yok. Giriş için bağlantı gerekir.");
  expect(notice.className).toContain("text-center");
  expect(notice.className).toContain("text-xs");
  expect(notice.className).toContain("w-full");
  expect(notice.className).toContain("safe-area-inset-top");
  expect(host.textContent).not.toMatch(/Bekleyen|Son senkron/);

  setOnlineForTests(true);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  expect(host.querySelector('[data-testid="guest-offline-notice"]')).toBeNull();
  await cleanup();
});

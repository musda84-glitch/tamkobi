import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import fs from "fs";
import path from "path";
import { DesktopAppPanel } from "./DesktopAppPanel";

jest.mock("axios");
jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test/api",
}));

async function renderPanel() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<DesktopAppPanel />);
  });
  await act(async () => {});
  return {
    host,
    cleanup() {
      root.unmount();
      host.remove();
    },
  };
}

test("sürüm varsa indirme butonu, yayın tarihi ve sürüm notu gösterilir", async () => {
  axios.get.mockResolvedValue({
    data: {
      available: true,
      version: "1.2.3",
      download_url: "https://github.com/musda84-glitch/tamkobi/releases/download/desktop-v1.2.3/setup.msi",
      published_at: "2026-10-14T12:00:00Z",
      notes: "Atölye kiosk",
    },
  });
  const { host, cleanup } = await renderPanel();
  expect(host.querySelector('[data-testid="desktop-app-description"]')?.textContent).toMatch(
    /Atölye ve panel ekranlarını bilgisayarınızda kiosk modunda çalıştırın/,
  );
  const button = host.querySelector('[data-testid="desktop-download"]');
  expect(button?.tagName).toBe("A");
  expect(button.textContent).toMatch(/Windows için indir \(v1\.2\.3\)/);
  expect(button.getAttribute("href")).toMatch(/setup\.msi$/);
  expect(button.hasAttribute("disabled")).toBe(false);
  expect(host.querySelector('[data-testid="desktop-published-at"]')?.textContent).toMatch(/14 Ekim 2026/);
  expect(host.querySelector('[data-testid="desktop-notes"]')?.textContent).toMatch(/Atölye kiosk/);
  expect(axios.get).toHaveBeenCalledWith("http://test/api/desktop/latest");
  cleanup();
});

test("sürüm yoksa hazırlanıyor yazar ve buton pasiftir", async () => {
  axios.get.mockResolvedValue({ data: { available: false } });
  const { host, cleanup } = await renderPanel();
  expect(host.querySelector('[data-testid="desktop-unavailable"]')?.textContent).toMatch(
    /Masaüstü uygulaması hazırlanıyor, yakında buradan indirebileceksiniz/,
  );
  const button = host.querySelector('[data-testid="desktop-download"]');
  expect(button?.tagName).toBe("BUTTON");
  expect(button.disabled).toBe(true);
  expect(host.querySelector('[data-testid="desktop-published-at"]')).toBeNull();
  expect(host.querySelector('[data-testid="desktop-notes"]')).toBeNull();
  cleanup();
});

test("istek hata verirse hazırlanıyor yazar ve buton pasiftir", async () => {
  axios.get.mockRejectedValue(new Error("network"));
  const { host, cleanup } = await renderPanel();
  expect(host.querySelector('[data-testid="desktop-unavailable"]')?.textContent).toMatch(
    /Masaüstü uygulaması hazırlanıyor, yakında buradan indirebileceksiniz/,
  );
  expect(host.querySelector('[data-testid="desktop-download"]').disabled).toBe(true);
  cleanup();
});

test("firma ayarları sekmesi ve profil bağlantısı masaüstü bölümünü açar", () => {
  const settings = fs.readFileSync(path.join(__dirname, "../pages/SettingsPage.jsx"), "utf8");
  const nav = fs.readFileSync(path.join(__dirname, "../navGroups.js"), "utf8");
  const account = fs.readFileSync(path.join(__dirname, "../pages/AccountPage.jsx"), "utf8");
  const layout = fs.readFileSync(path.join(__dirname, "../components/MainLayout.jsx"), "utf8");
  expect(settings).toMatch(/Masaüstü Uygulaması/);
  expect(settings).toMatch(/DesktopAppPanel/);
  expect(settings).toMatch(/shownTab === "desktop"/);
  expect(nav).toMatch(/"desktop"/);
  expect(account).toMatch(/\/settings\?tab=desktop/);
  expect(layout).toMatch(/tab=desktop|get\("tab"\) === "desktop"/);
});

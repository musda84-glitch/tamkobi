/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ShopfloorDevicesPanel } from "./ShopfloorDevicesPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }) => <svg data-testid="shopfloor-device-qr-svg" data-value={value} />,
}));

const mockAuth = { user: { role: "admin", is_super_admin: false } };
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => mockAuth,
}));

const DEVICE = {
  id: "dev-1",
  label: "Kesim tableti",
  status: "active",
  last_seen: "2026-10-21T09:30:00.000Z",
  station_mode: "one",
  stations: ["CNC"],
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  mockAuth.user = { role: "admin", is_super_admin: false };
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/shopfloor/devices")) return Promise.resolve({ data: [DEVICE] });
    if (String(url).includes("/stations")) return Promise.resolve({ data: ["CNC", "Kesim"] });
    return Promise.resolve({ data: [] });
  });
  axios.post.mockResolvedValue({ data: { code: "K4M7NP", expires_at: "2026-10-21T10:00:00.000Z", label: "Kesim tableti" } });
  axios.put.mockResolvedValue({ data: { status: "success" } });
  window.confirm = jest.fn(() => true);
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  jest.clearAllMocks();
});

async function renderPanel(companyId = "co-1") {
  root = createRoot(host);
  await act(async () => { root.render(<ShopfloorDevicesPanel companyId={companyId} />); });
  await act(async () => { await Promise.resolve(); });
}

test("satış rolü cihaz listesini görmez", async () => {
  mockAuth.user = { role: "sales" };
  await renderPanel();
  expect(host.querySelector("[data-testid='shopfloor-devices-denied']")).not.toBeNull();
  expect(axios.get).not.toHaveBeenCalled();
});

test("yönetici cihazı, son görülmeyi ve durumu görür; kod üretince QR düz koddur", async () => {
  await renderPanel();
  expect(host.querySelector("[data-testid='shopfloor-device-row-dev-1']").textContent).toContain("Aktif");
  expect(host.querySelector("[data-testid='shopfloor-device-seen-dev-1']").textContent).toContain("Son görülme");
  expect(host.querySelector("[data-testid='shopfloor-device-name-dev-1']").value).toBe("Kesim tableti");

  const label = host.querySelector("[data-testid='shopfloor-device-label']");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(label, "Yeni tablet");
    label.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("[data-testid='shopfloor-device-create']").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => { await Promise.resolve(); });

  const body = axios.post.mock.calls.find((call) => String(call[0]).includes("pairing-codes"))[1];
  expect(body).toEqual({ company_id: "co-1", label: "Yeni tablet", station_mode: "all", stations: [] });
  expect(body.code).toBeUndefined();
  const shown = host.querySelector("[data-testid='shopfloor-device-code-value']");
  expect(shown.textContent).toBe("K4M7NP");
  const qr = host.querySelector("[data-testid='shopfloor-device-qr-svg']");
  expect(qr.getAttribute("data-value")).toBe("K4M7NP");
  expect(qr.getAttribute("data-value")).not.toContain("/");
  expect(toast.success).toHaveBeenCalledWith("Eşleştirme kodu üretildi.");
  expect(JSON.stringify(toast.success.mock.calls)).not.toContain("K4M7NP");

  await act(async () => { host.querySelector("[data-testid='shopfloor-device-code-close']").click(); });
  expect(host.querySelector("[data-testid='shopfloor-device-code']")).toBeNull();
  expect(host.textContent).not.toContain("K4M7NP");
});

test("yeniden adlandırma ve iptal kod veya token yazmaz", async () => {
  await renderPanel();
  const name = host.querySelector("[data-testid='shopfloor-device-name-dev-1']");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(name, "Lazer tableti");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { host.querySelector("[data-testid='shopfloor-device-rename-dev-1']").click(); });
  await act(async () => { await Promise.resolve(); });
  expect(axios.put).toHaveBeenCalledWith("/api/shopfloor/devices/dev-1", {
    company_id: "co-1",
    label: "Lazer tableti",
  });

  await act(async () => { host.querySelector("[data-testid='shopfloor-device-revoke-dev-1']").click(); });
  await act(async () => { await Promise.resolve(); });
  expect(axios.post).toHaveBeenCalledWith(
    "/api/shopfloor/devices/dev-1/revoke",
    null,
    { params: { company_id: "co-1" } },
  );
});

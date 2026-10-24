/**
 * @jest-environment jsdom
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import axios from "axios";

const CODE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const SECRET = "QRSECRETQRSECRETQRSECRETQRSECRETQRSECRETQRSE";
const EXP = "2099-01-01T00:02:00.000Z";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn(), info: jest.fn() } }));
jest.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }) => <svg data-testid="login-qr-svg" data-value={value} />,
}));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({
    login: jest.fn(),
    applySession: jest.fn(),
  }),
}));

import QrLoginPanel from "./QrLoginPanel";
import LoginPage from "../pages/LoginPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function startPayload() {
  return { data: { code: CODE, poll_secret: SECRET, expires_at: EXP, ttl_seconds: 120 } };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render(node) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
  await flush();
  return {
    host,
    async cleanup() {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

beforeEach(() => {
  axios.post.mockReset();
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: {} });
});

test("giriş sayfası QR seçeneğini açar ve kodu yalnız karekodda gösterir", async () => {
  axios.post.mockResolvedValue(startPayload());
  const view = await render(<LoginPage />);
  expect(view.host.querySelector('[data-testid="login-qr-open"]')).toBeTruthy();
  expect(view.host.querySelector('[data-testid="tamkobi-mark"]')).toBeTruthy();
  await act(async () => {
    view.host.querySelector('[data-testid="login-qr-open"]').click();
  });
  await flush();
  const svg = view.host.querySelector('[data-testid="login-qr-svg"]');
  expect(svg.getAttribute("data-value")).toBe(CODE);
  expect(view.host.textContent).toContain("Onay bekleniyor");
  expect(view.host.textContent).not.toContain(SECRET);
  expect(view.host.textContent).not.toContain(CODE);
  const startCall = axios.post.mock.calls.find((c) => String(c[0]).endsWith("/auth/qr-login/start"));
  expect(startCall[1]).toEqual({ remember: false });
  expect(startCall[2]).toEqual({ withCredentials: true });
  await view.cleanup();
});

test("süre dolunca yenile yeni oturum ister", async () => {
  axios.post.mockImplementation((url) => {
    if (String(url).endsWith("/auth/qr-login/status")) {
      return Promise.resolve({ data: { status: "expired" } });
    }
    return Promise.resolve(startPayload());
  });
  const view = await render(<QrLoginPanel remember onSuccess={jest.fn()} onBack={jest.fn()} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  await flush();
  expect(view.host.textContent).toContain("Süre doldu");
  const before = axios.post.mock.calls.filter((c) => String(c[0]).endsWith("/auth/qr-login/start")).length;
  await act(async () => {
    view.host.querySelector('[data-testid="login-qr-refresh-again"]').click();
  });
  await flush();
  const after = axios.post.mock.calls.filter((c) => String(c[0]).endsWith("/auth/qr-login/start")).length;
  expect(after).toBe(before + 1);
  await view.cleanup();
});

test("onay cevabı oturumu bir kez uygular", async () => {
  const onSuccess = jest.fn();
  axios.post.mockImplementation((url) => {
    if (String(url).endsWith("/auth/qr-login/status")) {
      return Promise.resolve({
        data: { status: "approved", token: "oturum", user: { id: "u1", name: "Ada", active_company_id: "c1" } },
      });
    }
    return Promise.resolve(startPayload());
  });
  const view = await render(<QrLoginPanel remember onSuccess={onSuccess} onBack={jest.fn()} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  await flush();
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(onSuccess.mock.calls[0][0].user.active_company_id).toBe("c1");
  expect(onSuccess.mock.calls[0][0].token).toBe("oturum");
  await view.cleanup();
});

test("reddedilen giriş yenileme durumunu gösterir", async () => {
  axios.post.mockImplementation((url) => {
    if (String(url).endsWith("/auth/qr-login/status")) {
      return Promise.resolve({ data: { status: "rejected" } });
    }
    return Promise.resolve(startPayload());
  });
  const view = await render(<QrLoginPanel remember={false} onSuccess={jest.fn()} onBack={jest.fn()} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  await flush();
  expect(view.host.textContent).toContain("Giriş reddedildi");
  expect(view.host.querySelector('[data-testid="login-qr-refresh-again"]')).toBeTruthy();
  await view.cleanup();
});

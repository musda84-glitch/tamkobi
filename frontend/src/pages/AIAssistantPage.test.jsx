/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import AIAssistantPage from "./AIAssistantPage";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "comp-1" } }),
}));

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  AreaChart: ({ children }) => <div>{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/ai/status")) {
      return Promise.resolve({
        data: {
          enabled: true,
          configured: true,
          ready: true,
          badge: "Emergent GPT-4o",
          extract_label: "Fatura modeli",
        },
      });
    }
    return Promise.resolve({ data: null });
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function show() {
  await act(async () => {
    root.render(<AIAssistantPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("karşılama balonu kalın yazar, yıldızları göstermez", async () => {
  await show();
  const bubble = host.querySelector("[data-testid='ai-chat-msg-0']");
  const strong = bubble.querySelector("strong");
  expect(strong).not.toBeNull();
  expect(strong.textContent).toContain("TamKobi");
  expect(bubble.textContent).not.toContain("**");
  expect(bubble.textContent).toContain("Merhaba!");
});

function setInput(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

test("yedek yanıtta AI yanıt veremedi etiketi görünür", async () => {
  axios.post.mockResolvedValue({
    data: {
      advice: "1. **Kasa/Banka:** 1,250.50 TL\n8. AI sağlayıcı geçici yanıt veremedi",
      source: "fallback",
      fallback: true,
    },
  });
  await show();
  const input = host.querySelector("[data-testid='ai-chat-input']");
  await act(async () => {
    setInput(input, "nakit");
  });
  const send = host.querySelector("[data-testid='ai-chat-send-btn']");
  await act(async () => {
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
  const label = host.querySelector("[data-testid='ai-chat-unavailable-2']");
  expect(label).not.toBeNull();
  expect(label.textContent).toBe("AI şu an yanıt veremedi");
  const bubble = host.querySelector("[data-testid='ai-chat-msg-2']");
  expect(bubble.textContent).toContain("1,250.50");
  expect(host.querySelector("[data-testid='ai-chat-unavailable-0']")).toBeNull();
});

test("gerçek AI yanıtında yedek etiketi yoktur", async () => {
  axios.post.mockResolvedValue({
    data: { advice: "Tahsilatı hızlandırın.", source: "ai", fallback: false },
  });
  await show();
  const input = host.querySelector("[data-testid='ai-chat-input']");
  await act(async () => {
    setInput(input, "nakit");
  });
  await act(async () => {
    host.querySelector("[data-testid='ai-chat-send-btn']").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(host.querySelector("[data-testid='ai-chat-unavailable-2']")).toBeNull();
  expect(host.querySelector("[data-testid='ai-chat-msg-2']").textContent).toContain("Tahsilatı hızlandırın.");
});

test("sayfa rozeti sağlayıcı adı göstermez", async () => {
  await show();
  const badge = host.querySelector("[data-testid='ai-assistant-model-badge']");
  expect(badge.textContent).toBe("Yapay zekâ");
  expect(badge.textContent).not.toContain("Emergent");
  expect(badge.textContent).not.toContain("GPT");
  expect(badge.textContent).not.toContain("Destekli");
});

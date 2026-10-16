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

test("sayfa rozeti /ai/status badge değerini gösterir", async () => {
  await show();
  const badge = host.querySelector("[data-testid='ai-assistant-model-badge']");
  expect(badge.textContent).toContain("Emergent GPT-4o");
  expect(badge.textContent).not.toContain("GPT-5.4");
  const statusCalls = axios.get.mock.calls.filter((c) => String(c[0]).includes("/ai/status"));
  expect(statusCalls.length).toBeGreaterThan(0);
});

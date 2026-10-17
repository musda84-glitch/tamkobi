/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { QuestionsPanel } from "./MarketplacePanels";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [globalThis.__questionParams || new URLSearchParams(), jest.fn()],
}), { virtual: true });

const ROW = {
  id: "q9",
  external_id: "ext-9",
  channel: "trendyol",
  status: "WAITING_FOR_ANSWER",
  product_name: "Kulaklık",
  question: "Stok var mı?",
  asked_at: "2026-03-07T10:00:00Z",
};

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  toast.error.mockClear();
  globalThis.__questionParams = new URLSearchParams();
});

afterEach(() => {
  host.remove();
});

async function renderPanel() {
  const root = createRoot(host);
  await act(async () => {
    root.render(<QuestionsPanel companyId="c1" />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return root;
}

test("question param highlights the matching row", async () => {
  globalThis.__questionParams = new URLSearchParams("question=q9");
  axios.get.mockResolvedValue({ data: [ROW, { ...ROW, id: "other", external_id: "ext-other", question: "Başka" }] });
  await renderPanel();
  const hit = host.querySelector('[data-question-id="q9"]');
  expect(hit).not.toBeNull();
  expect(hit.getAttribute("data-open-focus")).toBe("1");
  expect(hit.className).toMatch(/ring-amber-300/);
  expect(host.querySelector('[data-question-id="other"]').getAttribute("data-open-focus")).toBe("0");
  expect(toast.error).not.toHaveBeenCalled();
});

test("missing question id toasts and the list still renders", async () => {
  globalThis.__questionParams = new URLSearchParams("question=gone");
  axios.get.mockResolvedValue({ data: [ROW] });
  await renderPanel();
  expect(toast.error).toHaveBeenCalledWith("Kayıt bulunamadı");
  expect(host.querySelector("[data-testid='questions-panel']")).not.toBeNull();
  expect(host.textContent).toContain("Kulaklık");
  expect(host.querySelector('[data-question-id="q9"]').getAttribute("data-open-focus")).toBe("0");
});

/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { ProductionAiAdvisor } from "./ProductionAiAdvisor";

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
  useAuth: () => ({
    user: { role: "admin" },
    addonOn: () => true,
    feature: () => true,
  }),
}));

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("üretim önerisi AiMessageText ile kalın ve liste gösterir", async () => {
  axios.get.mockResolvedValue({
    data: { advice: "**Darboğaz**\n\n- istasyon\n- hammadde", metrics: { recipes: 2, open_orders: 1 } },
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ProductionAiAdvisor companyId="c1" />);
  });
  const btn = host.querySelector("[data-testid='production-ai-analyze']");
  await act(async () => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
  const advice = host.querySelector("[data-testid='production-ai-advice']");
  expect(advice).not.toBeNull();
  expect(advice.className).toContain("whitespace-pre-wrap");
  expect(advice.querySelector("strong").textContent).toBe("Darboğaz");
  expect(advice.textContent).not.toContain("**");
  expect([...advice.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["istasyon", "hammadde"]);
  act(() => root.unmount());
  host.remove();
});

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MarketplaceQuestionsInbox } from "./MarketplaceQuestionsInbox";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/dataRefresh", () => ({ useDataRefresh: () => ({}) }));
jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}), { virtual: true });

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
});
afterEach(() => {
  host.remove();
});

test("shows waiting marketplace questions preview", async () => {
  axios.get.mockResolvedValueOnce({
    data: [
      {
        id: "q1",
        channel: "trendyol",
        status: "WAITING_FOR_ANSWER",
        product_name: "Kulaklık Pro",
        question: "Kargo ne zaman çıkar?",
        asked_at: "2026-03-07T10:00:00Z",
      },
    ],
  });

  await act(async () => {
    createRoot(host).render(<MarketplaceQuestionsInbox companyId="c1" />);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(host.querySelector("[data-testid='marketplace-questions-inbox']")).toBeTruthy();
  expect(host.textContent).toContain("Sipariş Soruları");
  expect(host.textContent).toContain("Kulaklık Pro");
  expect(host.textContent).toContain("Kargo ne zaman çıkar?");
  expect(host.querySelector("[data-testid='marketplace-questions-see-all']")?.getAttribute("href")).toBe("/orders?tab=questions");
});

test("empty state", async () => {
  axios.get.mockResolvedValueOnce({ data: [] });

  await act(async () => {
    createRoot(host).render(<MarketplaceQuestionsInbox companyId="c1" />);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(host.querySelector("[data-testid='marketplace-questions-empty']")).toBeTruthy();
});

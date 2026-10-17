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

const renderInbox = async () => {
  await act(async () => {
    createRoot(host).render(<MarketplaceQuestionsInbox companyId="c1" />);
    await Promise.resolve();
    await Promise.resolve();
  });
};

const question = (overrides) => ({
  id: "q",
  channel: "trendyol",
  status: "WAITING_FOR_ANSWER",
  product_name: "Ürün",
  question: "Soru metni",
  asked_at: "2026-03-01T10:00:00Z",
  ...overrides,
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
});
afterEach(() => {
  host.remove();
});

test("requests only waiting questions for the company", async () => {
  axios.get.mockResolvedValueOnce({ data: [] });

  await renderInbox();

  expect(axios.get).toHaveBeenCalledWith("/api/marketplace/questions", {
    params: { company_id: "c1", status: "WAITING_FOR_ANSWER" },
  });
});

test("renders only the waiting row when other statuses are returned", async () => {
  axios.get.mockResolvedValueOnce({
    data: [
      question({ id: "wait", status: "WAITING_FOR_ANSWER", product_name: "Bekleyen Ürün", question: "Kargo ne zaman?" }),
      question({ id: "ans", status: "ANSWERED", product_name: "Cevaplanan Ürün", answer: "Yarın çıkar." }),
      question({ id: "exp", status: "ANSWER_EXPIRED", product_name: "Süresi Dolan Ürün" }),
      question({ id: "rej", status: "REJECTED", product_name: "Reddedilen Ürün" }),
    ],
  });

  await renderInbox();

  expect(host.querySelector("[data-testid='marketplace-question-wait']")).toBeTruthy();
  expect(host.textContent).toContain("Bekleyen Ürün");
  expect(host.textContent).not.toContain("Cevaplanan Ürün");
  expect(host.textContent).not.toContain("Süresi Dolan Ürün");
  expect(host.textContent).not.toContain("Reddedilen Ürün");
  expect(host.querySelector("[data-testid='marketplace-questions-count']")?.textContent).toBe("1");
  expect(host.textContent).not.toContain("Cevap bekliyor");
});

test("shows the waiting-empty state when every row is answered", async () => {
  axios.get.mockResolvedValueOnce({
    data: [
      question({ id: "a1", status: "ANSWERED", product_name: "Cevaplı Bir", answer: "Gönderildi." }),
      question({ id: "a2", status: "ANSWERED", product_name: "Cevaplı İki", answer: "Yolda." }),
    ],
  });

  await renderInbox();

  const empty = host.querySelector("[data-testid='marketplace-questions-empty']");
  expect(empty).toBeTruthy();
  expect(empty.textContent).toContain("Cevap bekleyen soru yok.");
  expect(host.querySelector("[data-testid='marketplace-questions-list']")).toBeNull();
  expect(host.querySelector("[data-testid='marketplace-questions-count']")).toBeNull();
  expect(host.textContent).not.toContain("Cevap bekliyor");
  expect(host.textContent).not.toContain("Cevaplı Bir");
});

test("hides a waiting row once an answer or answered_at is present", async () => {
  axios.get.mockResolvedValueOnce({
    data: [
      question({
        id: "text",
        status: "WAITING_FOR_ANSWER",
        product_name: "Cevap Metinli",
        answer: "Kargoya verildi",
      }),
      question({
        id: "time",
        status: "WAITING_FOR_ANSWER",
        product_name: "Cevap Zamanlı",
        answer: "",
        answered_at: "2026-03-07T12:00:00Z",
      }),
    ],
  });

  await renderInbox();

  expect(host.querySelector("[data-testid='marketplace-questions-empty']")).toBeTruthy();
  expect(host.textContent).not.toContain("Cevap Metinli");
  expect(host.textContent).not.toContain("Cevap Zamanlı");
  expect(host.querySelector("[data-testid='marketplace-questions-count']")).toBeNull();
});

test("shows the six newest waiting questions and the full waiting count", async () => {
  const rows = [3, 8, 1, 5, 2, 7, 4, 6].map((n) => question({
    id: `q${n}`,
    product_name: `Sıra ${n}`,
    question: `Soru ${n}`,
    asked_at: `2026-03-${String(n).padStart(2, "0")}T10:00:00Z`,
  }));
  axios.get.mockResolvedValueOnce({ data: rows });

  await renderInbox();

  const rendered = [...host.querySelectorAll("[data-testid^='marketplace-question-']")];
  expect(rendered.map((el) => el.getAttribute("data-testid"))).toEqual([
    "marketplace-question-q8",
    "marketplace-question-q7",
    "marketplace-question-q6",
    "marketplace-question-q5",
    "marketplace-question-q4",
    "marketplace-question-q3",
  ]);
  expect(host.textContent).not.toContain("Sıra 1");
  expect(host.textContent).not.toContain("Sıra 2");
  expect(host.querySelector("[data-testid='marketplace-questions-count']")?.textContent).toBe("8");
});

test("links to the full questions tab", async () => {
  axios.get.mockResolvedValueOnce({ data: [question({ id: "q1", product_name: "Kulaklık" })] });

  await renderInbox();

  expect(host.querySelector("[data-testid='marketplace-questions-see-all']")?.getAttribute("href")).toBe("/orders?tab=questions");
  const open = [...host.querySelectorAll("a")].find((el) => el.textContent.includes("Aç"));
  expect(open?.getAttribute("href")).toBe("/orders?tab=questions");
});

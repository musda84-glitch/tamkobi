import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { EdocPendingInbox } from "./EdocPendingInbox";

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

test("shows pending e-docs and empty state", async () => {
  axios.get.mockResolvedValueOnce({
    data: {
      items: [
        {
          id: "ed1",
          status: "pending",
          kind: "invoice",
          number: "ABC2026001",
          issue_date: "2026-03-01",
          grand_total: 1200,
          supplier: { name: "Örnek A.Ş." },
        },
      ],
      counts: { pending: 1 },
    },
  });

  await act(async () => {
    createRoot(host).render(<EdocPendingInbox companyId="c1" />);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(host.querySelector("[data-testid='edoc-pending-inbox']")).toBeTruthy();
  expect(host.textContent).toContain("e Belgeler (bekleyen)");
  expect(host.textContent).toContain("Örnek A.Ş.");
  expect(host.textContent).toContain("ABC2026001");
  expect(host.querySelector("[data-testid='edoc-pending-see-all']")?.getAttribute("href")).toBe("/edoc-inbox");
});

test("empty pending list", async () => {
  axios.get.mockResolvedValueOnce({ data: { items: [], counts: { pending: 0 } } });

  await act(async () => {
    createRoot(host).render(<EdocPendingInbox companyId="c1" />);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(host.querySelector("[data-testid='edoc-pending-empty']")).toBeTruthy();
  expect(host.textContent).toContain("Bekleyen e-belge yok");
});

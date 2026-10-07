import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { PersonnelRequestsInbox } from "./PersonnelRequestsInbox";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/dataRefresh", () => ({ useDataRefresh: () => ({}) }));
jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn() }), { virtual: true });

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: { items: [], count: 0 } });
});
afterEach(() => {
  host.remove();
});

test("compact empty copy is shorter", async () => {
  await act(async () => {
    createRoot(host).render(<PersonnelRequestsInbox companyId="c1" compact />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(host.textContent).toContain("Onay bekleyen personel talebi yok.");
  expect(host.textContent).not.toContain("puantaj itirazı");
});

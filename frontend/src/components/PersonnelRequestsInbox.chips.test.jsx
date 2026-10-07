import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { EmployeeRequestChips } from "./PersonnelRequestsInbox";

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
});
afterEach(() => {
  host.remove();
});

test("compact chips keep talep summary in the identity column", () => {
  act(() => {
    createRoot(host).render(<EmployeeRequestChips items={[]} compact testId="employee-card-requests-1" />);
  });
  expect(host.textContent).toContain("Talepler (0)");
  expect(host.textContent).toContain("Talep yok");
  const el = host.querySelector("[data-testid='employee-card-requests-1']");
  expect(el.className).toContain("py-1");
  expect(el.className).toMatch(/w-fit/);
  expect(el.className).toMatch(/max-w-\[14rem\]/);
  expect(el.className).toMatch(/self-start/);
});

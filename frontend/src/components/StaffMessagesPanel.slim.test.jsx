import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { StaffMessagesPanel } from "./StaffMessagesPanel";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}), { virtual: true });

let host;
let root;

const emptyInbox = {
  mode: "manager",
  self_user_id: "u1",
  managers: [],
  manager_inbox: [],
  inbox: [],
  directory: [],
  thread: [],
  announcements: [],
  groups: [],
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.post.mockReset();
  axios.get.mockResolvedValue({ data: emptyInbox });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

test("slim empty messages row links to messages", async () => {
  root = createRoot(host);
  await act(async () => {
    root.render(<StaffMessagesPanel slimWhenEmpty testId="dashboard-messages" />);
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  expect(host.textContent).toContain("Yeni mesaj yok · Mesajlara git ›");
  expect(host.querySelector("[data-testid='dashboard-messages']")?.getAttribute("href")).toBe("/personelim");
});

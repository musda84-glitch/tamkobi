/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import fs from "fs";
import path from "path";
import { MemoryRouter } from "react-router-dom";
import axios from "axios";
import AppSidebarNav from "./AppSidebarNav";

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
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const STATUS_BADGE = "Emergent GPT-4o";
const STALE = ["GPT", "5.4"].join("-");

function Icon(props) {
  return <svg className={props.className} />;
}

let host;
let root;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  axios.get.mockReset();
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/ai/status")) {
      return Promise.resolve({
        data: { enabled: true, configured: true, ready: true, badge: STATUS_BADGE, extract_label: "Başka" },
      });
    }
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function show(items) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/ai-advisor"]}>
        <AppSidebarNav
          items={items}
        />
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("AI rozeti /ai/status ile aynıdır ve sabit model adı yoktur", async () => {
  await show([
    { label: "Genel Bakış", path: "/panel", icon: Icon },
    { label: "Faturalar", path: "/invoices", badge: "GİB", icon: Icon },
    { label: "TamKobi AI Danışman", path: "/ai-advisor", aiBadge: true, isAi: true, icon: Icon },
    { label: "Destek", path: "/support", badge: "Talep", icon: Icon },
  ]);

  const ai = host.querySelector("[data-testid='nav-item-ai-advisor']");
  expect(ai).not.toBeNull();
  const badge = host.querySelector("[data-testid='nav-ai-badge']");
  expect(badge).not.toBeNull();
  expect(badge.textContent).toBe("Yapay zekâ");
  expect(ai.textContent).not.toContain(STATUS_BADGE);
  expect(host.textContent).not.toContain(STALE);

  const statusCalls = axios.get.mock.calls.filter((c) => String(c[0]).includes("/ai/status"));
  expect(statusCalls).toHaveLength(1);

  const authSrc = fs.readFileSync(path.join(__dirname, "../context/AuthContext.jsx"), "utf8");
  const navSrc = fs.readFileSync(path.join(__dirname, "AppSidebarNav.jsx"), "utf8");
  expect(authSrc).not.toContain(STALE);
  expect(navSrc).not.toContain(STALE);
  expect(authSrc).toContain("aiBadge: true");
});

test("boş rozet çizilmez", async () => {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/ai/status")) return Promise.resolve({ data: { badge: "", enabled: false, configured: false, ready: false } });
    return Promise.resolve({ data: {} });
  });
  await show([
    { label: "TamKobi AI Danışman", path: "/ai-advisor", aiBadge: true, isAi: true, icon: Icon },
  ]);
  expect(host.querySelector("[data-testid='nav-ai-badge']")).toBeNull();
  expect(host.textContent).not.toContain(STALE);
  expect(axios.get.mock.calls.filter((c) => String(c[0]).includes("/ai/status"))).toHaveLength(1);
});

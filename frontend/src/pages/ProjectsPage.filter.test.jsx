import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: {},
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "co-1" }, loading: false }),
}));
jest.mock("../components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => children,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, disabled, ...rest }) => (
    <button type="button" disabled={!!disabled} onClick={() => !disabled && onSelect?.()} {...rest}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children, ...rest }) => <button type="button" {...rest}>{children}</button>,
  DropdownMenuSubContent: ({ children, ...rest }) => <div {...rest}>{children}</div>,
}));

import axios from "axios";
import ProjectsPage from "./ProjectsPage";

const KEY = "tamkobi_qp_show_completed_projects";
const STAGES = [
  { key: "planning", label: "Planlama" },
  { key: "active", label: "Devam Ediyor" },
  { key: "completed", label: "Tamamlandı", is_final: true },
];
const PROJECTS = [
  { id: "a", project_number: "PRJ-1", name: "Aktif İş", status: "active", contact_name: "Ali" },
  { id: "b", project_number: "PRJ-2", name: "Biten İş", status: "completed", contact_name: "Veli" },
];

let host;
let root;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url) => {
    const value = String(url);
    if (value.includes("/projects")) return Promise.resolve({ data: PROJECTS });
    if (value.includes("/project-stages")) return Promise.resolve({ data: { stages: STAGES } });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  if (root) act(() => { root.unmount(); });
  root = null;
  host.remove();
  localStorage.clear();
  sessionStorage.clear();
});

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderPage() {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectsPage section="projects" />
      </MemoryRouter>,
    );
  });
  await flush();
}

function chip(name) {
  return host.querySelector(`[data-testid="project-filter-${name}"]`);
}

test("Aktif, Tamamlanan ve Tümü sayıları ve listeleri doğru", async () => {
  await renderPage();
  expect(chip("active").textContent).toBe("Aktif (1)");
  expect(chip("completed").textContent).toBe("Tamamlanan (1)");
  expect(chip("all").textContent).toBe("Tümü (2)");
  expect(chip("active").getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector('[data-testid="project-card-PRJ-1"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="project-card-PRJ-2"]')).toBeNull();
  expect(host.querySelector('[data-testid="completed-projects-hint"]')).toBeTruthy();

  act(() => { chip("completed").click(); });
  expect(host.querySelector('[data-testid="project-card-PRJ-1"]')).toBeNull();
  expect(host.querySelector('[data-testid="project-card-PRJ-2"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="completed-projects-hint"]')).toBeNull();

  act(() => { chip("all").click(); });
  expect(host.querySelector('[data-testid="project-card-PRJ-1"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="project-card-PRJ-2"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="completed-projects-hint"]')).toBeNull();

  act(() => { chip("active").click(); });
  expect(host.querySelector('[data-testid="project-card-PRJ-2"]')).toBeNull();
  expect(host.querySelector('[data-testid="completed-projects-hint"]')).toBeTruthy();
});

test("localStorage eski true değeri Tümü açar", async () => {
  localStorage.setItem(KEY, "1");
  await renderPage();
  expect(chip("all").getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector('[data-testid="project-card-PRJ-1"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="project-card-PRJ-2"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="completed-projects-hint"]')).toBeNull();
});

/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { mesaimExclusiveUntilCheckIn } from "../utils/attendanceSelf";
import IkLayout from "./IkLayout";

const mockState = {
  user: null,
  locked: false,
  ready: true,
};

jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: mockState.user, logout: jest.fn(), activeCompany: null }),
}));

jest.mock("../context/MesaimGateContext", () => ({
  useMesaimGate: () => ({
    locked: mockState.locked,
    ready: mockState.ready,
    today: null,
    refresh: jest.fn(),
  }),
}));

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: {},
    interceptors: { response: { use: jest.fn(() => 1), eject: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount(entry) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/atolye" element={<IkLayout><div data-testid="atolye-page">atolye</div></IkLayout>} />
          <Route path="/mesai" element={<IkLayout><div data-testid="mesai-page">mesai</div></IkLayout>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return {
    host,
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function labels(host) {
  const desktop = host.querySelector("[data-testid='ik-nav']");
  return [...desktop.querySelectorAll("a")].map((a) => a.getAttribute("aria-label"));
}

function applyGate(user, today, ready = true) {
  mockState.user = user;
  mockState.ready = ready;
  mockState.locked = ready ? mesaimExclusiveUntilCheckIn(user, today) : false;
}

describe("IkLayout mesaim lock", () => {
  afterEach(() => {
    mockState.user = null;
    mockState.locked = false;
    mockState.ready = true;
  });

  test("locked staff on /atolye is sent to /mesai and sees the banner", async () => {
    applyGate(
      { role: "personel", employee_id: "e1", name: "Ali", features: { portal_atolye: true } },
      { check_in: "08:00", check_out: "17:00" },
    );
    const view = await mount("/atolye");
    expect(view.host.querySelector("[data-testid='atolye-page']")).toBeNull();
    expect(view.host.querySelector("[data-testid='mesai-page']")).not.toBeNull();
    expect(view.host.querySelector("[data-testid='mesaim-locked-banner']").textContent).toMatch(/Mesai çıkışı yapıldı/);
    expect(labels(view.host)).toEqual(["Mesaim"]);
    expect(view.host.querySelector("[data-testid='ik-nav-personelim']")).toBeNull();
    expect(view.host.querySelector("[data-testid='ik-nav-atolye']")).toBeNull();
    await view.cleanup();
  });

  test("open shift renders Atölye", async () => {
    applyGate(
      { role: "personel", employee_id: "e1", name: "Ali", features: { portal_atolye: true } },
      { check_in: "08:00" },
    );
    const view = await mount("/atolye");
    expect(view.host.querySelector("[data-testid='atolye-page']")).not.toBeNull();
    expect(view.host.querySelector("[data-testid='mesaim-locked-banner']")).toBeNull();
    expect(labels(view.host)).toEqual(["Personelim", "Mesaim", "Atölye"]);
    await view.cleanup();
  });

  test("admin is not redirected after checkout", async () => {
    applyGate(
      { role: "admin", employee_id: "e1", name: "Ayşe" },
      { check_in: "08:00", check_out: "17:00" },
    );
    const view = await mount("/atolye");
    expect(view.host.querySelector("[data-testid='atolye-page']")).not.toBeNull();
    expect(view.host.querySelector("[data-testid='mesaim-locked-banner']")).toBeNull();
    expect(labels(view.host)).toContain("Atölye");
    await view.cleanup();
  });

  test("waits for the gate when the user has an employee card", async () => {
    applyGate({ role: "personel", employee_id: "e1", name: "Ali" }, null, false);
    const view = await mount("/atolye");
    expect(view.host.querySelector("[data-testid='ik-auth-loading']").textContent).toMatch(/Yükleniyor/);
    expect(view.host.querySelector("[data-testid='atolye-page']")).toBeNull();
    await view.cleanup();
  });
});

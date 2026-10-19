/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter, useLocation } from "react-router-dom";
import { PosSessionProvider } from "./PosSessionContext";
import { PosPinPad } from "../components/PosPinPad";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
  };
  return { __esModule: true, default: impl, ...impl };
});

jest.mock("./AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ authenticated: true, activeCompany: { id: "c1" }, user: { id: "admin" } }),
}));

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{`${loc.pathname}${loc.search}`}</div>;
}

let host;
let root;
let quiet;

const PIN_CASHIER = { id: "u1", name: "Ayşe", has_cashier_pin: true };

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
  axios.get.mockReset();
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  quiet.mockRestore();
  host.remove();
});

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function where() {
  return host.querySelector("[data-testid='where']").textContent;
}

async function pressEscape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

async function renderGate(path, { session, cashiers }) {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/pos/session")) {
      return Promise.resolve({ data: { session, my_rules: session?.rules || {}, pending_approvals: [], can_approve: false } });
    }
    if (u.includes("/pos/cashiers")) return Promise.resolve({ data: cashiers });
    return Promise.resolve({ data: [] });
  });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <PosSessionProvider>
          <Where />
        </PosSessionProvider>
      </MemoryRouter>,
    );
  });
  await flush();
}

async function pressPin(digits) {
  await act(async () => {
    String(digits).split("").forEach((d) => {
      host.querySelector(`[data-testid='pos-pin-${d}']`).click();
    });
  });
}

test("giriş kapısında çıkış düğmesi ve Escape /panel'e döner", async () => {
  await renderGate("/hizli-satis", { session: {}, cashiers: [PIN_CASHIER] });
  const exit = host.querySelector("[data-testid='pos-pin-exit']");
  expect(host.querySelector("[data-testid='pos-login-pad']")).not.toBeNull();
  expect(exit).not.toBeNull();
  expect(exit.textContent).toContain("Çık / Panele dön");
  expect(host.querySelector("[data-testid='pos-pin-cancel']")).toBeNull();
  await act(async () => { exit.click(); });
  expect(where()).toBe("/panel");

  await renderGate("/hizli-satis", { session: {}, cashiers: [PIN_CASHIER] });
  await pressEscape();
  expect(where()).toBe("/panel");
});

test("PIN'li kasiyer yokken kurulum bağlantısı görünür ve giriş pasiftir", async () => {
  await renderGate("/hizli-satis", {
    session: {},
    cashiers: [{ id: "u2", name: "Ali", has_cashier_pin: false }, { id: "u3", name: "Veli" }],
  });
  const box = host.querySelector("[data-testid='pos-no-cashiers']");
  expect(box).not.toBeNull();
  expect(box.textContent).toContain("Tanımlı kasiyer (PIN'li) yok");
  const link = box.querySelector("a");
  expect(link).not.toBeNull();
  expect(link.getAttribute("href")).toBe("/settings?tab=pos_rules");
  expect(link.textContent).toContain("Kasiyer tanımla");
  expect(host.querySelector("[data-testid='pos-pin-submit']").disabled).toBe(true);
  expect(host.querySelector("[data-testid='pos-pin-1']")).toBeNull();
  expect(host.querySelector("[data-testid='pos-pin-exit']")).not.toBeNull();
  await act(async () => { link.click(); });
  expect(where()).toBe("/settings?tab=pos_rules");
});

test("PIN'li kasiyer varken seçim, PIN ve giriş çalışır", async () => {
  const live = { session: {} };
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/pos/session")) {
      return Promise.resolve({ data: { session: live.session, pending_approvals: [] } });
    }
    if (u.includes("/pos/cashiers")) return Promise.resolve({ data: [PIN_CASHIER] });
    return Promise.resolve({ data: [] });
  });
  axios.post.mockImplementation((url, body) => {
    if (String(url).includes("/pos/session/login")) {
      live.session = {
        cashier_user_id: body.cashier_user_id,
        cashier_name: "Ayşe",
        locked: false,
        rules: { can_exit: true },
        last_activity: new Date().toISOString(),
        idle_timeout_sec: 600,
      };
      return Promise.resolve({ data: { session: live.session } });
    }
    return Promise.resolve({ data: {} });
  });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/hizli-satis"]}>
        <PosSessionProvider>
          <Where />
        </PosSessionProvider>
      </MemoryRouter>,
    );
  });
  await flush();
  expect(host.querySelector("[data-testid='pos-no-cashiers']")).toBeNull();
  expect(host.querySelector("[data-testid='pos-cashier-u1']").textContent).toContain("Ayşe");
  expect(host.querySelector("[data-testid='pos-pin-submit']").disabled).toBe(true);
  await act(async () => { host.querySelector("[data-testid='pos-cashier-u1']").click(); });
  await pressPin("1234");
  expect(host.querySelector("[data-testid='pos-pin-dots']").textContent).toBe("••••");
  expect(host.querySelector("[data-testid='pos-pin-submit']").disabled).toBe(false);
  await act(async () => { host.querySelector("[data-testid='pos-pin-submit']").click(); });
  await flush();
  expect(axios.post).toHaveBeenCalledWith(
    "/api/pos/session/login",
    expect.objectContaining({ pin: "1234", cashier_user_id: "u1", company_id: "c1" }),
    expect.any(Object),
  );
  expect(host.querySelector("[data-testid='pos-login-pad']")).toBeNull();
  expect(where()).toBe("/hizli-satis");
});

test("kilitli ve idle oturumda çıkış düğmesi yoktur, Escape kilidi açmaz", async () => {
  await renderGate("/hizli-satis", {
    session: {
      cashier_user_id: "u1",
      cashier_name: "Ayşe",
      locked: true,
      rules: { can_exit: false },
      last_activity: new Date().toISOString(),
      idle_timeout_sec: 120,
    },
    cashiers: [PIN_CASHIER],
  });
  expect(host.querySelector("[data-testid='pos-unlock-pad']")).not.toBeNull();
  expect(host.textContent).toContain("Ekran kilitli");
  expect(host.querySelector("[data-testid='pos-pin-exit']")).toBeNull();
  expect(host.querySelector("[data-testid='pos-no-cashiers']")).toBeNull();
  await pressPin("1234");
  await act(async () => { host.querySelector("[data-testid='pos-pin-submit']").click(); });
  await flush();
  expect(axios.post).toHaveBeenCalledWith(
    "/api/pos/session/unlock",
    expect.objectContaining({ pin: "1234", company_id: "c1" }),
    expect.any(Object),
  );
  await pressEscape();
  expect(where()).toBe("/hizli-satis");

  await renderGate("/hizli-satis", {
    session: {
      cashier_user_id: "u1",
      cashier_name: "Ayşe",
      locked: false,
      rules: { can_exit: true },
      last_activity: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      idle_timeout_sec: 120,
    },
    cashiers: [PIN_CASHIER],
  });
  expect(host.querySelector("[data-testid='pos-unlock-pad']")).not.toBeNull();
  expect(host.querySelector("[data-testid='pos-pin-exit']")).toBeNull();
  await pressEscape();
  expect(where()).toBe("/hizli-satis");
});

test("aktif kasiyerin çıkış kilidi panele serbest dönüş vermez", async () => {
  await renderGate("/panel", {
    session: {
      cashier_user_id: "u1",
      cashier_name: "Ayşe",
      locked: false,
      exit_granted: false,
      rules: { can_exit: false },
      last_activity: new Date().toISOString(),
      idle_timeout_sec: 600,
    },
    cashiers: [PIN_CASHIER],
  });
  expect(where()).toBe("/hizli-satis");
  expect(host.querySelector("[data-testid='pos-pin-exit']")).toBeNull();
  expect(host.querySelector("[data-testid='pos-login-pad']")).toBeNull();
  expect(host.querySelector("[data-testid='pos-unlock-pad']")).toBeNull();
});

test("PosPinPad Escape onExit'i, yoksa onCancel'ı çağırır", async () => {
  const onExit = jest.fn();
  const onCancel = jest.fn();
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <PosPinPad onExit={onExit} onCancel={onCancel} cashiers={[PIN_CASHIER]} selectedId="u1" />
      </MemoryRouter>,
    );
  });
  expect(host.querySelector("[data-testid='pos-pin-exit']").textContent).toContain("Çık / Panele dön");
  expect(host.querySelector("[data-testid='pos-pin-cancel']").textContent).toContain("Vazgeç");
  await pressEscape();
  expect(onExit).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();

  onExit.mockClear();
  await act(async () => {
    root.render(
      <MemoryRouter>
        <PosPinPad onCancel={onCancel} cashiers={[PIN_CASHIER]} />
      </MemoryRouter>,
    );
  });
  expect(host.querySelector("[data-testid='pos-pin-exit']")).toBeNull();
  await pressEscape();
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onExit).not.toHaveBeenCalled();

  onCancel.mockClear();
  await act(async () => {
    root.render(
      <MemoryRouter>
        <PosPinPad cashiers={[]} />
      </MemoryRouter>,
    );
  });
  expect(host.querySelector("[data-testid='pos-no-cashiers']")).toBeNull();
  expect(host.querySelector("[data-testid='pos-pin-dots']")).not.toBeNull();
  await pressEscape();
  expect(onCancel).not.toHaveBeenCalled();
  expect(onExit).not.toHaveBeenCalled();
});

/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { PlatformNoticesHost } from "./PlatformNoticesHost";
import { resetTransportOutageForTests } from "../utils/transportOutage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({ activeCompany: { id: "c1", name: "Test" } }),
}));

const realGet = axios.get.bind(axios);

function networkErr(message = "Network Error") {
  const err = new Error(message);
  err.code = message === "Network Error" ? "ERR_NETWORK" : undefined;
  if (!err.code && /failed to fetch/i.test(message)) err.code = "ERR_NETWORK";
  return err;
}

function gatewayErr(status) {
  const err = new Error(`status ${status}`);
  err.response = { status };
  return err;
}

function versionCalls(fetchMock) {
  return fetchMock.mock.calls.filter((args) => String(args[0]).includes("/api/version"));
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("PlatformNoticesHost transport flash", () => {
  let host;
  let root;
  let fetchMock;
  let noticesCalls;
  let apiErrors;

  beforeEach(() => {
    resetTransportOutageForTests();
    noticesCalls = 0;
    apiErrors = [];
    if (typeof global.fetch !== "function") {
      global.fetch = () => Promise.reject(new Error("fetch missing"));
    }
    fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200 });
    jest.spyOn(window, "dispatchEvent").mockImplementation((ev) => {
      if (ev?.type === "tamkobi:api-error") apiErrors.push(ev);
      return EventTarget.prototype.dispatchEvent.call(window, ev);
    });
    jest.spyOn(axios, "get").mockImplementation((url, config) => {
      if (String(url).includes("/platform/notices")) {
        noticesCalls += 1;
        if (noticesCalls > 1) {
          const err = new Error("notices down");
          err.response = { status: 400 };
          return Promise.reject(err);
        }
        return Promise.resolve({ data: { announcements: [] } });
      }
      return realGet(url, config);
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    host.remove();
    jest.restoreAllMocks();
    resetTransportOutageForTests();
  });

  async function mount() {
    await act(async () => { root.render(<PlatformNoticesHost />); });
    await flush();
  }

  function modal() {
    return document.querySelector("[data-testid='platform-notice-modal']");
  }

  async function failGet(err) {
    await act(async () => {
      await axios.get("/api/orders", {
        adapter: () => Promise.reject(err),
      }).catch(() => {});
    });
    await flush();
  }

  test("pagehide sonrası ağ hatası modal açmaz; iptal edilen istek modal açmaz", async () => {
    await mount();
    window.dispatchEvent(new Event("pagehide"));
    await failGet(networkErr());
    expect(apiErrors).toHaveLength(0);
    expect(versionCalls(fetchMock)).toHaveLength(0);
    expect(modal()).toBeNull();

    resetTransportOutageForTests();
    apiErrors.length = 0;
    await failGet(new axios.CanceledError("canceled"));
    expect(apiErrors).toHaveLength(0);
    expect(versionCalls(fetchMock)).toHaveLength(0);
    expect(modal()).toBeNull();
  });

  test("ağ hatası sağlık kontrolüne bakar; 503 hemen açılır; eşzamanlı hatalar tek istek", async () => {
    await mount();

    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await failGet(networkErr("Failed to fetch"));
    expect(versionCalls(fetchMock)).toHaveLength(1);
    expect(modal()).toBeNull();

    fetchMock.mockRejectedValue(new Error("offline"));
    await failGet(networkErr());
    expect(versionCalls(fetchMock)).toHaveLength(2);
    expect(modal()).not.toBeNull();
    expect(modal().textContent).toContain("Sistem Güncellemesi Yapılıyor");

    act(() => { root.unmount(); });
    resetTransportOutageForTests();
    fetchMock.mockClear();
    apiErrors.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await mount();
    expect(modal()).toBeNull();

    await failGet(gatewayErr(503));
    expect(versionCalls(fetchMock)).toHaveLength(0);
    expect(modal()).not.toBeNull();
    expect(modal().textContent).toContain("Sistem Güncellemesi Yapılıyor");

    act(() => { root.unmount(); });
    resetTransportOutageForTests();
    fetchMock.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await mount();

    fetchMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await Promise.all([0, 1, 2].map((n) => axios.get(`/api/ping-${n}`, {
        adapter: () => Promise.reject(networkErr()),
      }).catch(() => {})));
    });
    await flush();
    expect(versionCalls(fetchMock)).toHaveLength(1);
    expect(modal()).not.toBeNull();
  });
});

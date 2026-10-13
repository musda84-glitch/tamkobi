import { ApiHttpError } from "./errors";
import { request } from "./client";
import { clearRedirectedApiBase } from "./url";

jest.mock("../auth/storage", () => ({
  saveApiBase: jest.fn(async (v: string) => v.replace(/\/+$/, "")),
}));

describe("request", () => {
  const client = { baseUrl: "https://tamkobi.com", token: "abc" };

  afterEach(() => {
    // @ts-expect-error test mock
    global.fetch = undefined;
    clearRedirectedApiBase();
    jest.clearAllMocks();
  });

  it("sends bearer token and parses JSON", async () => {
    const fetchMock = jest.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      expect(url).toBe("https://tamkobi.com/api/auth/me");
      expect(init?.headers?.Authorization).toBe("Bearer abc");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ authenticated: true }),
      };
    });
    // @ts-expect-error test mock
    global.fetch = fetchMock;
    const data = await request<{ authenticated: boolean }>(client, "GET", "/auth/me");
    expect(data.authenticated).toBe(true);
  });

  it("surfaces FastAPI errors", async () => {
    // @ts-expect-error test mock
    global.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ detail: "E-posta adresi veya şifre hatalı." }),
    });
    await expect(request(client, "POST", "/auth/login", { body: {} })).rejects.toMatchObject({
      status: 401,
      message: "E-posta adresi veya şifre hatalı.",
    } satisfies Partial<ApiHttpError>);
  });

  it("sends DELETE without a JSON body", async () => {
    const fetchMock = jest.fn(async (_url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      expect(init?.method).toBe("DELETE");
      expect(init?.body).toBeUndefined();
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: "success" }), headers: { get: () => null } };
    });
    // @ts-expect-error test mock
    global.fetch = fetchMock;
    const { del } = await import("./client");
    const data = await del<{ status: string }>(client, "/products/prod_01");
    expect(data.status).toBe("success");
  });

  it("retries once on 301 Location host and persists", async () => {
    const { saveApiBase } = await import("../auth/storage");
    const fetchMock = jest.fn(async (url: string) => {
      if (String(url).includes("tamkobi.com") && !String(url).includes("app.")) {
        return {
          ok: false,
          status: 301,
          headers: { get: (h: string) => (h.toLowerCase() === "location" ? "https://app.tamkobi.com/api/auth/me" : null) },
          text: async () => "",
        };
      }
      expect(url).toBe("https://app.tamkobi.com/api/auth/me");
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ authenticated: true }),
      };
    });
    // @ts-expect-error test mock
    global.fetch = fetchMock;
    const data = await request<{ authenticated: boolean }>(client, "GET", "/auth/me");
    expect(data.authenticated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saveApiBase).toHaveBeenCalledWith("https://app.tamkobi.com");
  });
  it("does not persist or follow foreign Location host", async () => {
    const { saveApiBase } = await import("../auth/storage");
    (saveApiBase as jest.Mock).mockClear();
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 301,
      headers: { get: (h: string) => (h.toLowerCase() === "location" ? "https://evil.com/steal" : null) },
      text: async () => "",
      url: "https://tamkobi.com/api/auth/me",
      redirected: false,
    }));
    // @ts-expect-error test mock
    global.fetch = fetchMock;
    await expect(request(client, "GET", "/auth/me")).rejects.toMatchObject({ status: 301 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(saveApiBase).not.toHaveBeenCalled();
  });

  it("rejects http Location downgrade", async () => {
    const { saveApiBase } = await import("../auth/storage");
    (saveApiBase as jest.Mock).mockClear();
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 308,
      headers: { get: (h: string) => (h.toLowerCase() === "location" ? "http://tamkobi.com/api/auth/me" : null) },
      text: async () => "",
      url: "https://tamkobi.com/api/auth/me",
      redirected: false,
    }));
    // @ts-expect-error test mock
    global.fetch = fetchMock;
    await expect(request(client, "GET", "/auth/me")).rejects.toMatchObject({ status: 308 });
    expect(saveApiBase).not.toHaveBeenCalled();
  });

  it("retries when RN auto-follows to allowed host via res.url", async () => {
    const { saveApiBase } = await import("../auth/storage");
    (saveApiBase as jest.Mock).mockClear();
    let n = 0;
    const fetchMock = jest.fn(async (url: string) => {
      n += 1;
      if (n === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({ stale: true }),
          url: "https://app.tamkobi.com/api/auth/me",
          redirected: true,
        };
      }
      expect(url).toBe("https://app.tamkobi.com/api/auth/me");
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ authenticated: true }),
        url: "https://app.tamkobi.com/api/auth/me",
        redirected: false,
      };
    });
    // @ts-expect-error test mock
    global.fetch = fetchMock;
    const data = await request<{ authenticated?: boolean; stale?: boolean }>(client, "GET", "/auth/me");
    expect(data.authenticated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saveApiBase).toHaveBeenCalledWith("https://app.tamkobi.com");
  });
});

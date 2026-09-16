import { ApiHttpError } from "./errors";
import { request } from "./client";

describe("request", () => {
  const client = { baseUrl: "https://tamkobi.com", token: "abc" };

  afterEach(() => {
    // @ts-expect-error test mock
    global.fetch = undefined;
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
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: "success" }) };
    });
    // @ts-expect-error test mock
    global.fetch = fetchMock;
    const { del } = await import("./client");
    const data = await del<{ status: string }>(client, "/products/prod_01");
    expect(data.status).toBe("success");
  });
});

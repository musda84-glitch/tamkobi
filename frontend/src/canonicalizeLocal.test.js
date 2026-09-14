import { canonicalizeLocalOrigin } from "./canonicalizeLocal";

describe("canonicalizeLocalOrigin", () => {
  const original = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: original });
    jest.restoreAllMocks();
  });

  function mockLocation(href) {
    const u = new URL(href);
    const replace = jest.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: u.hostname,
        port: u.port,
        pathname: u.pathname,
        search: u.search,
        hash: u.hash,
        href,
        replace,
      },
    });
    return replace;
  }

  test("does nothing on already-canonical 127.0.0.1", async () => {
    const replace = mockLocation("http://127.0.0.1/portal/abc");
    await expect(canonicalizeLocalOrigin()).resolves.toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  test("rewrites localhost host but keeps port when not 3000/8000", async () => {
    const replace = mockLocation("http://localhost/b2b/giris");
    await expect(canonicalizeLocalOrigin()).resolves.toBe(true);
    expect(replace).toHaveBeenCalledWith("http://127.0.0.1/b2b/giris");
  });

  test("keeps CRA on :3000 when nginx is unreachable", async () => {
    const replace = mockLocation("http://127.0.0.1:3000/portal");
    jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(canonicalizeLocalOrigin()).resolves.toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  test("redirects :3000 → :80 when nginx responds", async () => {
    const replace = mockLocation("http://127.0.0.1:3000/portal/tok");
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await expect(canonicalizeLocalOrigin()).resolves.toBe(true);
    expect(replace).toHaveBeenCalledWith("http://127.0.0.1/portal/tok");
  });
});

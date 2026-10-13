import {
  apiRoot,
  applyRedirectedApiBase,
  clearRedirectedApiBase,
  displayFileUrl,
  extraApiUrl,
  fileUrl,
  isPermanentRedirect,
  normalizeApiBase,
  redirectBaseFromLocation,
  requestTarget,
} from "./url";

afterEach(() => {
  clearRedirectedApiBase();
});

describe("normalizeApiBase", () => {
  it("defaults empty to production", () => {
    expect(normalizeApiBase("")).toBe("https://tamkobi.com");
    expect(normalizeApiBase("   ")).toBe("https://tamkobi.com");
  });

  it("strips trailing slash and /api", () => {
    expect(normalizeApiBase("https://tamkobi.com/")).toBe("https://tamkobi.com");
    expect(normalizeApiBase("https://tamkobi.com/api")).toBe("https://tamkobi.com");
    expect(normalizeApiBase("https://tamkobi.com/api/")).toBe("https://tamkobi.com");
  });

  it("adds https when protocol is missing", () => {
    expect(normalizeApiBase("tamkobi.com")).toBe("https://tamkobi.com");
  });

  it("reads extra.apiUrl from app.json extra", () => {
    expect(extraApiUrl({ apiUrl: "https://tamkobi.com" })).toBe("https://tamkobi.com");
    expect(extraApiUrl({ apiUrl: "  https://tamkobi.com  " })).toBe("https://tamkobi.com");
    expect(extraApiUrl({})).toBeUndefined();
    expect(extraApiUrl(null)).toBeUndefined();
  });

  it("keeps localhost http", () => {
    expect(normalizeApiBase("http://127.0.0.1:8000")).toBe("http://127.0.0.1:8000");
    expect(apiRoot("http://localhost:8000/api")).toBe("http://localhost:8000/api");
  });

  it("calls the API directly when there is no browser origin", () => {
    expect(requestTarget("https://tamkobi.com", "/auth/login")).toEqual({ url: "https://tamkobi.com/api/auth/login" });
  });

  it("makes uploaded file paths absolute for native <Image>", () => {
    expect(fileUrl("https://tamkobi.com", "/api/files/tamkobi/survey/x.jpg")).toBe("https://tamkobi.com/api/files/tamkobi/survey/x.jpg");
    expect(fileUrl("https://tamkobi.com/api", "api/files/x.jpg")).toBe("https://tamkobi.com/api/files/x.jpg");
    expect(fileUrl("https://tamkobi.com", "tamkobi/survey/x.jpg")).toBe("https://tamkobi.com/api/files/tamkobi/survey/x.jpg");
    expect(fileUrl("https://tamkobi.com", "https://cdn.test/x.jpg")).toBe("https://cdn.test/x.jpg");
    expect(fileUrl("https://tamkobi.com", "")).toBe("");
  });

  it("keeps file paths same-origin in the browser preview", () => {
    expect(displayFileUrl("https://tamkobi.com", "/api/files/x.jpg", true)).toBe("/api/files/x.jpg");
    expect(displayFileUrl("https://tamkobi.com", "tamkobi/p.jpg", true)).toBe("/api/files/tamkobi/p.jpg");
    expect(displayFileUrl("https://tamkobi.com", "https://cdn.test/x.jpg", true)).toBe("https://cdn.test/x.jpg");
    expect(displayFileUrl("https://tamkobi.com", "/api/files/x.jpg", false)).toBe("https://tamkobi.com/api/files/x.jpg");
  });

  it("parses 301/308 Location host once", () => {
    expect(isPermanentRedirect(301)).toBe(true);
    expect(isPermanentRedirect(308)).toBe(true);
    expect(isPermanentRedirect(302)).toBe(false);
    expect(redirectBaseFromLocation("https://app.tamkobi.com/api/auth/me", "https://tamkobi.com")).toBe(
      "https://app.tamkobi.com",
    );
    expect(redirectBaseFromLocation("https://tamkobi.com/api/x", "https://tamkobi.com")).toBeNull();
    expect(redirectBaseFromLocation("/api/auth/me", "https://tamkobi.com")).toBeNull();
    applyRedirectedApiBase("https://app.tamkobi.com");
    expect(requestTarget("https://tamkobi.com", "/auth/me").url).toBe("https://app.tamkobi.com/api/auth/me");
  });
});

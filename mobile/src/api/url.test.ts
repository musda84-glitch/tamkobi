import { apiRoot, extraApiUrl, fileUrl, normalizeApiBase } from "./url";

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

  it("makes uploaded file paths absolute for native <Image>", () => {
    expect(fileUrl("https://tamkobi.com", "/api/files/tamkobi/survey/x.jpg")).toBe("https://tamkobi.com/api/files/tamkobi/survey/x.jpg");
    expect(fileUrl("https://tamkobi.com/api", "api/files/x.jpg")).toBe("https://tamkobi.com/api/files/x.jpg");
    expect(fileUrl("https://tamkobi.com", "tamkobi/survey/x.jpg")).toBe("https://tamkobi.com/api/files/tamkobi/survey/x.jpg");
    expect(fileUrl("https://tamkobi.com", "https://cdn.test/x.jpg")).toBe("https://cdn.test/x.jpg");
    expect(fileUrl("https://tamkobi.com", "")).toBe("");
  });
});

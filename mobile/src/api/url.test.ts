import { apiRoot, normalizeApiBase } from "./url";

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

  it("keeps localhost http", () => {
    expect(normalizeApiBase("http://127.0.0.1:8000")).toBe("http://127.0.0.1:8000");
    expect(apiRoot("http://localhost:8000/api")).toBe("http://localhost:8000/api");
  });
});

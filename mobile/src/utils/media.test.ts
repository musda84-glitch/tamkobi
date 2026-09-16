import { resolveMediaUrl } from "./media";

describe("resolveMediaUrl", () => {
  it("returns empty for blank", () => {
    expect(resolveMediaUrl("https://tamkobi.com", "")).toBe("");
    expect(resolveMediaUrl("https://tamkobi.com", null)).toBe("");
  });

  it("keeps absolute http urls", () => {
    expect(resolveMediaUrl("https://tamkobi.com", "https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
  });

  it("prefixes relative /api paths", () => {
    expect(resolveMediaUrl("https://tamkobi.com", "/api/files/logo.png")).toBe("https://tamkobi.com/api/files/logo.png");
  });

  it("treats bare filenames as files", () => {
    expect(resolveMediaUrl("https://tamkobi.com/", "logo.png")).toBe("https://tamkobi.com/api/files/logo.png");
  });
});

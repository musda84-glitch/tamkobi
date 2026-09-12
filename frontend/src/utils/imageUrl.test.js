/**
 * @jest-environment jsdom
 */
import { resolveImageUrl } from "./imageUrl";

jest.mock("../api/client", () => ({
  BACKEND_URL: "",
}));

describe("resolveImageUrl", () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  test("boş ve absolute URL", () => {
    expect(resolveImageUrl("")).toBe("");
    expect(resolveImageUrl(null)).toBe("");
    expect(resolveImageUrl("https://cdn.example/a.jpg")).toBe("https://cdn.example/a.jpg");
    expect(resolveImageUrl("data:image/png;base64,xx")).toBe("data:image/png;base64,xx");
  });

  test("BACKEND boşken same-origin relative path", () => {
    expect(resolveImageUrl("/api/files/tamkobi/products/a.jpg")).toBe("/api/files/tamkobi/products/a.jpg");
    expect(resolveImageUrl("tamkobi/products/a.jpg")).toBe("/api/files/tamkobi/products/a.jpg");
    expect(resolveImageUrl("api/files/x.jpg")).toBe("/api/files/x.jpg");
  });
});

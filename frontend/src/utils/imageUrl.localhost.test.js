/**
 * @jest-environment jsdom
 */
import { resolveImageUrl } from "./imageUrl";

jest.mock("../api/client", () => ({
  BACKEND_URL: "http://127.0.0.1:3001",
}));

describe("resolveImageUrl with localhost backend", () => {
  test("üretim hostname'de localhost base'i yok sayar", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://tamkobi.com/stock"),
    });
    expect(resolveImageUrl("/api/files/a.jpg")).toBe("/api/files/a.jpg");
  });

  test("localhost sayfada absolute backend kullanır", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("http://127.0.0.1:3000/stock"),
    });
    expect(resolveImageUrl("/api/files/a.jpg")).toBe("http://127.0.0.1:3001/api/files/a.jpg");
  });
});

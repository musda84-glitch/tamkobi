/**
 * @jest-environment jsdom
 */
import { preloadPrintThumbs, printItemImageRef, printLineThumbUrls, printThumbUrl, releasePrintThumbs } from "./printFormImages";

jest.mock("../api/client", () => ({
  BACKEND_URL: "",
}));

describe("printThumbUrl", () => {
  test("yerel dosya saklanan 200 px adresini ister", () => {
    expect(printThumbUrl("/api/files/tamkobi/products/a.jpg")).toBe(
      "/api/files/tamkobi/products/a.jpg?w=200",
    );
    expect(printThumbUrl("/api/files/tamkobi/products/a.w200.webp")).toBe(
      "/api/files/tamkobi/products/a.w200.webp",
    );
  });

  test("harici pazar yeri adresi olduğu gibi kalır", () => {
    expect(printThumbUrl("https://cdn.example/a.jpg")).toBe("https://cdn.example/a.jpg");
  });

  test("satır görseli stok kartından önce gelir", () => {
    const ref = printItemImageRef(
      { image_url: "/api/files/tamkobi/products/line.jpg" },
      { thumbnail_url: "/api/files/tamkobi/products/card.jpg" },
    );
    expect(printThumbUrl(ref)).toContain("line.jpg");
    const urls = printLineThumbUrls(
      [
        { image_url: "/api/files/tamkobi/products/a.jpg" },
        { image_url: "/api/files/tamkobi/products/a.jpg" },
        { image_url: "/api/files/tamkobi/products/b.jpg" },
      ],
    );
    expect(urls).toEqual([
      "/api/files/tamkobi/products/a.jpg?w=200",
      "/api/files/tamkobi/products/b.jpg?w=200",
    ]);
  });
});

describe("preloadPrintThumbs", () => {
  const assigned = [];

  beforeEach(() => {
    assigned.length = 0;
    global.Image = class {
      set src(value) {
        this._src = value;
        assigned.push(value);
      }
      get src() {
        return this._src || "";
      }
    };
    releasePrintThumbs([]);
    assigned.length = 0;
  });

  test("adresleri bekletmeden başlatır ve aynı adresi kesmez", () => {
    expect(preloadPrintThumbs([
      "/api/files/a.jpg?w=200",
      "/api/files/b.jpg?w=200",
      "/api/files/a.jpg?w=200",
    ])).toBe(2);
    expect(assigned).toEqual(["/api/files/a.jpg?w=200", "/api/files/b.jpg?w=200"]);
    preloadPrintThumbs(["/api/files/a.jpg?w=200", "/api/files/b.jpg?w=200"]);
    expect(assigned).toEqual(["/api/files/a.jpg?w=200", "/api/files/b.jpg?w=200"]);
    releasePrintThumbs(["/api/files/a.jpg?w=200"]);
    expect(assigned.filter((src) => src === "")).toHaveLength(1);
    expect(assigned.filter((src) => src === "/api/files/a.jpg?w=200")).toHaveLength(1);
  });
});

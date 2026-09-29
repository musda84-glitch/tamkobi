/**
 * @jest-environment jsdom
 */
import {
  absolutizeHtmlUrls,
  absolutizeUrl,
  buildLabelPrintDocument,
} from "./labelPrint";

describe("labelPrint", () => {
  test("absolutizeUrl keeps data/blob and resolves relative paths", () => {
    expect(absolutizeUrl("data:image/png;base64,xx")).toBe("data:image/png;base64,xx");
    expect(absolutizeUrl("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(absolutizeUrl("/api/files/a.png", "https://app.tamkobi.com/stock")).toBe(
      "https://app.tamkobi.com/api/files/a.png",
    );
  });

  test("absolutizeHtmlUrls rewrites img src", () => {
    const html = '<div class="lbl"><img src="/api/files/p.png" alt=""><img src="https://x/y.jpg"></div>';
    const out = absolutizeHtmlUrls(html, "https://app.tamkobi.com/");
    expect(out).toContain('src="https://app.tamkobi.com/api/files/p.png"');
    expect(out).toContain('src="https://x/y.jpg"');
  });

  test("buildLabelPrintDocument embeds base + thermal page size", () => {
    const doc = buildLabelPrintDocument({
      html: '<div class="lbl"><img src="/api/files/x.png"></div>',
      tpl: { width_mm: 100, height_mm: 30 },
      page: { mode: "thermal", cols: 1, gap_mm: 0 },
      baseHref: "https://app.tamkobi.com/",
    });
    expect(doc).toContain('<base href="https://app.tamkobi.com/">');
    expect(doc).toContain("100mm 30mm");
    expect(doc).toContain("print-color-adjust:exact");
    expect(doc).toContain('src="https://app.tamkobi.com/api/files/x.png"');
  });
});

/**
 * @jest-environment jsdom
 */
import {
  absolutizeHtmlUrls,
  absolutizeUrl,
  buildLabelPrintDocument,
  createLabelPrintWindow,
  fitLabelHtmlToBox,
  showLabelPrintDocument,
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
    expect(doc).toContain("<title>Etiketler</title>");
    expect(doc).toContain("@page{size:100mm 30mm;margin:0}");
    expect(doc).toContain("html,body{margin:0;padding:0;width:100mm;");
    expect(doc).not.toMatch(/zoom\s*:/);
    expect(doc).not.toMatch(/transform\s*:\s*scale/i);
  });

  test("fitLabelHtmlToBox maps the px canvas onto the label and drops scale", () => {
    const html = `<div class="lbl"><div style="position: relative; width: 378px; height: 113.4px"><div style="position: absolute; left: 7.56px; top: 5.67px; width: 80px; height: 20px; transform: scale(1); transform-origin: top left">MODEL</div><div style="position: absolute; left: 10px; top: 2px; width: 10px; height: 8px; transform: rotate(90deg) scale(1.2)">QR</div></div></div>`;
    const out = fitLabelHtmlToBox(html, { widthMm: 100, heightMm: 30 });
    expect(out).toContain("MODEL");
    expect(out).toContain("left: 2mm");
    expect(out).toContain("top: 1.5mm");
    expect(out).toContain("width: 100mm");
    expect(out).toContain("height: 30mm");
    expect(out).toContain("rotate(90deg)");
    expect(out).not.toMatch(/scale\(/);
    expect(out).not.toMatch(/zoom/i);
    expect(out).not.toMatch(/\d+px/);
  });

  test("print window opens a titled blob document instead of about:blank", async () => {
    const win = {
      document: { title: "", open: jest.fn(), write: jest.fn(), close: jest.fn() },
      location: { href: "about:blank", replace: jest.fn((url) => { win.location.href = url; }) },
      close: jest.fn(),
    };
    const prevOpen = window.open;
    const prevCreate = URL.createObjectURL;
    const prevRevoke = URL.revokeObjectURL;
    window.open = jest.fn(() => win);
    URL.createObjectURL = jest.fn(() => "blob:etiketler");
    URL.revokeObjectURL = jest.fn();
    try {
      const opened = createLabelPrintWindow("Etiketler");
      expect(opened).toBe(win);
      expect(window.open).toHaveBeenCalledWith("", "_blank", "width=900,height=700");
      expect(win.document.title).toBe("Etiketler");
      expect(win.document.write).toHaveBeenCalledWith(expect.stringContaining("<title>Etiketler</title>"));
      expect(win.document.write.mock.calls[0][0]).not.toContain("about:blank");

      const html = buildLabelPrintDocument({
        html: '<div class="lbl">LOGO</div>',
        tpl: { width_mm: 100, height_mm: 30 },
        page: { mode: "thermal" },
      });
      expect(showLabelPrintDocument(win, html, "Etiketler")).toBe(true);
      const blob = URL.createObjectURL.mock.calls[0][0];
      expect(String(blob.type || "")).toMatch(/text\/html/);
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
      expect(text).toContain("<title>Etiketler</title>");
      expect(text).toContain('document.title="Etiketler"');
      expect(text).toContain("window.print()");
      expect(text).not.toContain("about:blank");
      expect(win.location.replace).toHaveBeenCalledWith("blob:etiketler");
      expect(win.location.href).toBe("blob:etiketler");
    } finally {
      window.open = prevOpen;
      URL.createObjectURL = prevCreate;
      URL.revokeObjectURL = prevRevoke;
    }
  });
});

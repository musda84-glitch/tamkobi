import { builtinLabelTemplates, pickLineToLabelProduct, resolveLabelTemplate } from "./resolveLabelTemplate";
import { labelFieldValue, templateLabelCardHtml } from "./labelTemplateHtml";

describe("resolveLabelTemplate (mobile)", () => {
  const builtins = builtinLabelTemplates();
  const saved = [
    { id: "tpl_a", name: "A", is_default: false, width_mm: 50, height_mm: 30, elements: [] },
    { id: "tpl_def", name: "Varsayılan", is_default: true, width_mm: 50, height_mm: 30, elements: [] },
    { id: "tpl_stock", name: "Stok", width_mm: 60, height_mm: 40, elements: [] },
  ];

  it("prefers stock card template then default", () => {
    expect(resolveLabelTemplate(saved, { label_template_id: "tpl_stock" }, builtins)?.id).toBe("tpl_stock");
    expect(resolveLabelTemplate(saved, {}, builtins)?.id).toBe("tpl_def");
  });

  it("maps pick line to label product", () => {
    const p = pickLineToLabelProduct({
      product_id: "p1",
      product_name: "MDF",
      label_template_id: "tpl_stock",
      barcode: "869",
      label_image_url: "/api/files/label.jpg",
      image_url: "/api/files/cover.jpg",
    });
    expect(p?.label_template_id).toBe("tpl_stock");
    expect(p?.name).toBe("MDF");
    expect(p?.image_url).toBe("/api/files/label.jpg");
    expect(p?.label_image_url).toBe("/api/files/label.jpg");
  });

  it("renders template card with product name", () => {
    const tpl = {
      id: "t1",
      width_mm: 50,
      height_mm: 30,
      elements: [
        { id: "1", type: "field", field: "name", x: 1, y: 1, w: 48, h: 6, font: 9, bold: true },
        { id: "2", type: "barcode", x: 1, y: 8, w: 40, h: 18, showText: true },
      ],
    };
    const html = templateLabelCardHtml(tpl, { name: "Vida", sku: "V1", barcode: "8690001928371" });
    expect(html).toContain("Vida");
    expect(html).toContain("<svg");
    expect(labelFieldValue({ field: "sku" }, { name: "X", sku: "ABC" })).toBe("ABC");
  });

  it("renders QR svg and absolute product image", () => {
    const tpl = {
      id: "t2",
      width_mm: 60,
      height_mm: 40,
      elements: [
        { id: "q", type: "qr", x: 2, y: 2, w: 16, h: 16 },
        { id: "i", type: "image", x: 22, y: 2, w: 16, h: 16 },
      ],
    };
    const html = templateLabelCardHtml(
      tpl,
      { name: "Raf", barcode: "8690001928371", image_url: "/api/files/raf.jpg" },
      { name: "Matek", logo_url: "/api/files/logo.png" },
      { mediaBase: "https://tamkobi.com" },
    );
    expect(html).toContain('viewBox="0 0');
    expect(html).toContain("shape-rendering=\"crispEdges\"");
    expect(html).toContain('src="https://tamkobi.com/api/files/raf.jpg"');
    expect(html).not.toContain(">QR<");
  });
});

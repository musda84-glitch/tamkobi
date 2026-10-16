import { resolveLabelTemplate, resolveLabelTemplateInfo, pickLineToLabelProduct } from "./resolveLabelTemplate";

describe("resolveLabelTemplate", () => {
  const builtins = [
    { id: "builtin-40x20", name: "Hazır 40×20" },
    { id: "builtin-50x30", name: "Hazır 50×30" },
  ];
  const saved = [
    { id: "tpl_a", name: "A", is_default: false },
    { id: "tpl_def", name: "Varsayılan", is_default: true },
    { id: "tpl_stock", name: "Stok kartı" },
  ];

  test("uses stock card assigned template first", () => {
    expect(resolveLabelTemplate(saved, { label_template_id: "tpl_stock" }, builtins)?.id).toBe("tpl_stock");
  });

  test("falls back to default then first then builtin", () => {
    expect(resolveLabelTemplate(saved, {}, builtins)?.id).toBe("tpl_def");
    expect(resolveLabelTemplate([{ id: "only" }], {}, builtins)?.id).toBe("only");
    expect(resolveLabelTemplate([], {}, builtins)?.id).toBe("builtin-50x30");
  });

  test("resolveLabelTemplateInfo reports source and a missing assignment", () => {
    expect(resolveLabelTemplateInfo(saved, { label_template_id: "tpl_stock" }, builtins)).toMatchObject({
      source: "assigned",
      missingAssigned: false,
    });
    expect(resolveLabelTemplateInfo(saved, { label_template_id: "gone" }, builtins)).toMatchObject({
      tpl: { id: "tpl_def" },
      source: "default",
      missingAssigned: true,
    });
    expect(resolveLabelTemplateInfo([{ id: "only" }], { label_template_id: "gone" }, builtins)).toMatchObject({
      source: "first",
      missingAssigned: true,
    });
    expect(resolveLabelTemplateInfo([], { label_template_id: "gone" }, builtins)).toMatchObject({
      tpl: { id: "builtin-50x30" },
      source: "builtin",
      missingAssigned: true,
    });
    expect(resolveLabelTemplateInfo(saved, {}, builtins).missingAssigned).toBe(false);
  });

  test("pickLineToLabelProduct maps pick fields", () => {
    const p = pickLineToLabelProduct({
      product_id: "p1",
      product_name: "MDF",
      sku: "S1",
      barcode: "869",
      label_template_id: "tpl_stock",
      sale_price: 10,
    });
    expect(p).toMatchObject({
      id: "p1",
      name: "MDF",
      sku: "S1",
      barcode: "869",
      label_template_id: "tpl_stock",
      sale_price: 10,
    });
  });
});

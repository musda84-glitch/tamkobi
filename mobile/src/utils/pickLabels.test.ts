import { expandPickLabelJobs, labelCopyCount, productLabelBodyHtml, productLabelCss, productLabelDocumentHtml } from "./pickLabels";

describe("pickLabels", () => {
  test("prints one label per ordered unit", () => {
    expect(labelCopyCount({ ordered_qty: 3 })).toBe(3);
    expect(labelCopyCount({ ordered_qty: 0 })).toBe(1);
    expect(labelCopyCount({})).toBe(1);
    expect(labelCopyCount({ ordered_qty: 250 })).toBe(200);
    const jobs = expandPickLabelJobs([
      { product_name: "Vida", sku: "V-1", barcode: "8690001", ordered_qty: 2 },
      { product_name: "Somun", sku: "S-1", ordered_qty: 1 },
    ]);
    expect(jobs).toHaveLength(3);
    expect(jobs.filter((j) => j.code === "8690001")).toHaveLength(2);
    expect(jobs[2]).toEqual({ name: "Somun", sku: "S-1", code: "S-1" });
  });

  test("builds 50×30 product labels with barcode svg", () => {
    const jobs = expandPickLabelJobs([{ product_name: "Vida", sku: "V-1", barcode: "8690001928371", ordered_qty: 1 }]);
    const html = productLabelBodyHtml(jobs, "Matek");
    expect(html).toContain("Vida");
    expect(html).toContain("V-1");
    expect(html).toContain("Matek");
    expect(html).toContain("<svg");
    expect(html).toContain("8690001928371");
    expect(productLabelCss()).toContain("50mm 30mm");
    const doc = productLabelDocumentHtml("Etiketler", jobs, "Matek");
    expect(doc).toContain("<!doctype html>");
    expect(doc).not.toContain("window.print");
    expect(productLabelDocumentHtml("Etiketler", jobs, "Matek", true)).toContain("window.print");
  });
});

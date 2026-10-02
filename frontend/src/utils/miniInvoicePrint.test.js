import { describe, expect, it, jest } from "@jest/globals";
import { buildMiniInvoiceHtml, miniInvoiceSize, printMiniInvoicesFromIntegrator } from "./miniInvoicePrint";

describe("miniInvoicePrint integrator", () => {
  it("resolves paper sizes", () => {
    expect(miniInvoiceSize("8x20")).toEqual({ w: 80, h: 200, label: "8×20 cm" });
    expect(miniInvoiceSize("10x15").w).toBe(100);
  });

  it("buildMiniInvoiceHtml still builds local slip", () => {
    const html = buildMiniInvoiceHtml(
      [{ order_number: "O1", invoice_number: "F1", customer_name: "A", items: [], grand_total: 10 }],
      { name: "Co" },
      "10x15",
    );
    expect(html).toContain("size:100mm 150mm");
    expect(html).toContain("F1");
  });

  it("printMiniInvoicesFromIntegrator opens integrator PDF and prints", async () => {
    const pdfBlob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    const axiosClient = {
      get: jest.fn().mockResolvedValue({
        data: pdfBlob,
        headers: { "content-type": "application/pdf", "x-document-source": "integrator" },
      }),
    };
    const print = jest.fn();
    const addEventListener = jest.fn((ev, cb) => { if (ev === "load") cb(); });
    const open = jest.spyOn(window, "open").mockReturnValue({ print, addEventListener });
    const prevCreate = URL.createObjectURL;
    const prevRevoke = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:mini-pdf");
    URL.revokeObjectURL = jest.fn();

    const res = await printMiniInvoicesFromIntegrator(
      [{ invoice_id: "inv_1", order_number: "B2B-1" }],
      { apiUrl: "/api", axiosClient },
    );

    expect(res.ok).toBe(1);
    expect(res.fail).toBe(0);
    expect(axiosClient.get).toHaveBeenCalledWith(
      "/api/e-invoice/inv_1/pdf",
      expect.objectContaining({ responseType: "blob", params: { download: 0 } }),
    );
    expect(open).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();

    open.mockRestore();
    URL.createObjectURL = prevCreate;
    URL.revokeObjectURL = prevRevoke;
  });

  it("rejects local fallback source for mini e-fatura print", async () => {
    const axiosClient = {
      get: jest.fn().mockResolvedValue({
        data: new Blob(["%PDF"], { type: "application/pdf" }),
        headers: { "content-type": "application/pdf", "x-document-source": "local" },
      }),
    };
    const res = await printMiniInvoicesFromIntegrator(
      [{ invoice_id: "inv_local" }],
      { apiUrl: "/api", axiosClient },
    );
    expect(res.ok).toBe(0);
    expect(res.fail).toBe(1);
    expect(res.message).toMatch(/entegratör/i);
  });

  it("returns message when no invoice_id", async () => {
    const res = await printMiniInvoicesFromIntegrator([{ order_number: "X" }], { apiUrl: "/api", axiosClient: { get: jest.fn() } });
    expect(res.ok).toBe(0);
    expect(res.message).toMatch(/e-fatura yok/i);
  });
});

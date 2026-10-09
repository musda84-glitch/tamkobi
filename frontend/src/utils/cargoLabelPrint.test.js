import { describe, expect, it, jest } from "@jest/globals";
import { printCargoLabelsFromIntegrator, printCargoLabelsPreferIntegrator } from "./cargoLabelPrint";

describe("cargoLabelPrint integrator", () => {
  it("opens marketplace cargo-label file and prints", async () => {
    const pdfBlob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    const axiosClient = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { has_file: true, source: "marketplace" } })
        .mockResolvedValueOnce({
          data: pdfBlob,
          headers: { "content-type": "application/pdf" },
        }),
    };
    const print = jest.fn();
    const addEventListener = jest.fn((ev, cb) => { if (ev === "load") cb(); });
    const open = jest.spyOn(window, "open").mockReturnValue({ print, addEventListener });
    const prevCreate = URL.createObjectURL;
    const prevRevoke = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:cargo-pdf");
    URL.revokeObjectURL = jest.fn();

    const res = await printCargoLabelsFromIntegrator(
      [{ id: "ord_ty_1", channel: "trendyol", order_number: "908188687" }],
      { apiUrl: "/api", axiosClient },
    );

    expect(res.ok).toBe(1);
    expect(res.fail).toBe(0);
    expect(axiosClient.get).toHaveBeenNthCalledWith(1, "/api/orders/ord_ty_1/cargo-label");
    expect(axiosClient.get).toHaveBeenNthCalledWith(
      2,
      "/api/orders/ord_ty_1/cargo-label/file",
      expect.objectContaining({ responseType: "blob" }),
    );
    expect(open).toHaveBeenCalled();

    open.mockRestore();
    URL.createObjectURL = prevCreate;
    URL.revokeObjectURL = prevRevoke;
  });

  it("skips when integrator has no file", async () => {
    const axiosClient = {
      get: jest.fn().mockResolvedValue({ data: { has_file: false, source: "thermal" } }),
    };
    const res = await printCargoLabelsFromIntegrator(
      [{ id: "ord_1", channel: "trendyol" }],
      { apiUrl: "/api", axiosClient },
    );
    expect(res.ok).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.failedIds).toEqual(["ord_1"]);
    expect(axiosClient.get).toHaveBeenCalledTimes(1);
  });

  it("preferIntegrator uses marketplace then thermal fallback", async () => {
    const axiosClient = {
      get: jest.fn().mockResolvedValue({ data: { has_file: false, source: "thermal" } }),
    };
    const open = jest.spyOn(window, "open").mockReturnValue({
      document: { write: jest.fn(), close: jest.fn() },
    });

    const res = await printCargoLabelsPreferIntegrator(
      [
        { id: "ord_ty", channel: "trendyol", order_number: "9", items: [], customer_name: "A" },
        { id: "ord_b2b", channel: "b2b", order_number: "B1", items: [], customer_name: "B" },
      ],
      { name: "Co" },
      { apiUrl: "/api", axiosClient, size: "100x100" },
    );

    expect(res.thermal).toBe(2);
    expect(res.message).toMatch(/yerel termal/i);
    expect(open).toHaveBeenCalled();
    open.mockRestore();
  });

  it("preferIntegrator opens integrator PDF for marketplace when available", async () => {
    const pdfBlob = new Blob(["%PDF"], { type: "application/pdf" });
    const axiosClient = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { has_file: true, source: "marketplace" } })
        .mockResolvedValueOnce({ data: pdfBlob, headers: { "content-type": "application/pdf" } }),
    };
    const open = jest.spyOn(window, "open").mockReturnValue({
      print: jest.fn(),
      addEventListener: jest.fn((ev, cb) => { if (ev === "load") cb(); }),
    });
    const prevCreate = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:x");

    const res = await printCargoLabelsPreferIntegrator(
      [{ id: "ord_ty", channel: "trendyol", order_number: "9", items: [] }],
      { name: "Co" },
      { apiUrl: "/api", axiosClient, size: "100x150" },
    );

    expect(res.ok).toBe(1);
    expect(res.thermal).toBe(0);
    expect(res.message).toMatch(/entegratör/i);

    open.mockRestore();
    URL.createObjectURL = prevCreate;
  });
});

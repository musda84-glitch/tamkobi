import axios from "axios";
import { toast } from "sonner";
import { refreshInvoiceGibStatus } from "./InvoiceContextMenu";

jest.mock("axios");
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), message: jest.fn() },
}));

const inv = { id: "inv-1", invoice_number: "EA-1" };

beforeEach(() => {
  jest.clearAllMocks();
});

test("silent refresh does not toast and returns the payload", async () => {
  axios.post.mockResolvedValue({ data: { updated: true, gib_status: "1300" } });
  const data = await refreshInvoiceGibStatus("/api", inv, { silent: true });
  expect(data).toEqual({ updated: true, gib_status: "1300" });
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.message).not.toHaveBeenCalled();
  expect(axios.post).toHaveBeenCalledWith("/api/e-invoice/inv-1/refresh-status");
});

test("silent refresh does not swallow errors", async () => {
  axios.post.mockRejectedValue({ response: { data: { detail: "GİB kapalı" } } });
  await expect(refreshInvoiceGibStatus("/api", inv, { silent: true })).rejects.toEqual(
    expect.objectContaining({ response: { data: { detail: "GİB kapalı" } } }),
  );
  expect(toast.error).not.toHaveBeenCalled();
});

test("single GİB refresh menu keeps toast behavior", async () => {
  axios.post.mockResolvedValue({ data: { updated: true, gib_status: "Başarıyla Tamamlandı", invoice_number: "EA-1" } });
  await refreshInvoiceGibStatus("/api", inv);
  expect(toast.success).toHaveBeenCalled();
  expect(toast.message).toHaveBeenCalled();
  axios.post.mockRejectedValueOnce({ response: { data: { detail: "GİB durumu alınamadı." } } });
  const res = await refreshInvoiceGibStatus("/api", inv);
  expect(res).toBeNull();
  expect(toast.error).toHaveBeenCalledWith("GİB durumu alınamadı.");
});

import { del, get, post } from "../api/client";
import {
  deleteExpense,
  expenseDeleteConfirm,
  expensePayRequest,
  fetchExpenseById,
  postExpensePayment,
  postExpenseUnpay,
} from "./expenseActions";

jest.mock("../api/client", () => ({
  get: jest.fn(),
  post: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
}));

const client = { baseUrl: "https://api.test", token: "tok" };

describe("expenseActions", () => {
  beforeEach(() => {
    (get as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockReset();
    (del as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockResolvedValue({});
    (del as unknown as jest.Mock).mockResolvedValue({});
  });

  it("requires a kasa, banka, or partner target and keeps the same pay body", () => {
    expect(expensePayRequest("")).toEqual({ ok: false, error: "Ödeme için kasa/banka/ortak seçin." });
    expect(expensePayRequest("acc-1")).toEqual({ ok: true, body: { account_id: "acc-1", partner_id: null } });
    expect(expensePayRequest("partner:p1")).toEqual({ ok: true, body: { account_id: null, partner_id: "p1" } });
  });

  it("posts pay, unpay, and delete to the existing expense endpoints", async () => {
    await postExpensePayment(client, "e1", { account_id: "acc-1", partner_id: null });
    await postExpenseUnpay(client, "e1");
    await deleteExpense(client, "e1");
    expect(post).toHaveBeenNthCalledWith(1, client, "/expenses/e1/pay", { account_id: "acc-1", partner_id: null });
    expect(post).toHaveBeenNthCalledWith(2, client, "/expenses/e1/unpay");
    expect(del).toHaveBeenCalledWith(client, "/expenses/e1");
  });

  it("confirms delete with the expense number", () => {
    expect(expenseDeleteConfirm({ expense_number: "MSR-9" })).toBe("MSR-9 silinsin mi?");
    expect(expenseDeleteConfirm(null)).toBe("Bu masraf silinsin mi?");
  });

  it("finds an expense by id, then falls back to the full list", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, _path: string, query?: { q?: string }) => {
      if (query?.q === "e1") return Promise.resolve({ expenses: [{ id: "e1", description: "bulundu" }] });
      if (query?.q === "e2") return Promise.resolve({ expenses: [{ id: "baska", description: "yanlış" }] });
      return Promise.resolve({ expenses: [{ id: "e2", description: "tam liste" }] });
    });

    await expect(fetchExpenseById(client, "co-1", "e1")).resolves.toMatchObject({ id: "e1", description: "bulundu" });
    expect(get).toHaveBeenCalledTimes(1);

    await expect(fetchExpenseById(client, "co-1", "e2")).resolves.toMatchObject({ id: "e2", description: "tam liste" });
    await expect(fetchExpenseById(client, "co-1", "yok")).resolves.toBeNull();
  });
});

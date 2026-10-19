import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Product } from "../types";
import { commitProductLine, emptyLine } from "./documentLines";
import {
  appendProductPage,
  frequentInvoiceProductsKey,
  invoicePickAddLabel,
  invoicePickMeta,
  invoicePickStock,
  invoiceProductPageQuery,
  invoiceScanStrip,
  parseInvoiceProductPage,
  pushFrequentInvoiceProducts,
  readFrequentInvoiceProducts,
  rememberFrequentInvoiceProducts,
} from "./invoiceProductPick";

const mockStore = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStore.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockStore.delete(key); }),
}));

function product(partial: Partial<Product> & { id: string; name: string }): Product {
  return { unit: "Adet", vat_rate: 20, sale_price: 10, stock_quantity: 4, ...partial };
}

describe("invoiceProductPick", () => {
  beforeEach(() => {
    mockStore.clear();
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
  });

  it("builds a paged lite query and keeps an empty search off the wire", () => {
    expect(invoiceProductPageQuery({ companyId: "co-1", q: "  vida ", page: 2 })).toEqual({
      company_id: "co-1",
      q: "vida",
      page: 2,
      page_size: 30,
      lite: 1,
      active: "active",
    });
    expect(invoiceProductPageQuery({ companyId: "co-1", q: "   " }).q).toBeUndefined();
  });

  it("reads has_more from a paged payload and appends the next page", () => {
    const page = parseInvoiceProductPage({
      items: [product({ id: "a", name: "A" })],
      total: 2,
      page: 1,
      page_size: 30,
      has_more: true,
    });
    expect(page.has_more).toBe(true);
    const more = appendProductPage(page.items, [
      product({ id: "a", name: "A" }),
      product({ id: "b", name: "B" }),
    ]);
    expect(more.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("stores the last 10 products per company, newest first", async () => {
    const first = Array.from({ length: 10 }, (_, i) => product({ id: `p${i}`, name: `U${i}` }));
    await rememberFrequentInvoiceProducts("co-1", first);
    await rememberFrequentInvoiceProducts("co-1", [product({ id: "p-new", name: "Yeni" })]);
    await rememberFrequentInvoiceProducts("co-2", [product({ id: "other", name: "Diger" })]);

    const co1 = await readFrequentInvoiceProducts("co-1");
    const co2 = await readFrequentInvoiceProducts("co-2");
    expect(co1).toHaveLength(10);
    expect(co1[0]?.id).toBe("p-new");
    expect(co1.some((row) => row.id === "p0")).toBe(false);
    expect(co2.map((row) => row.id)).toEqual(["other"]);
    expect(mockStore.has(frequentInvoiceProductsKey("co-1"))).toBe(true);
    expect(mockStore.has(frequentInvoiceProductsKey("co-2"))).toBe(true);
    const again = pushFrequentInvoiceProducts(co1, [product({ id: "p-new", name: "Yeni" })]);
    expect(again[0]?.id).toBe("p-new");
    expect(again.filter((row) => row.id === "p-new")).toHaveLength(1);
  });

  it("colors stock and describes the scan strip", () => {
    expect(invoicePickStock({ type: "service", stock_quantity: 4, unit: "Saat" })).toEqual({ label: "stoksuz", tone: "muted" });
    expect(invoicePickStock({ stock_quantity: 0, unit: "Adet" }).tone).toBe("red");
    expect(invoicePickStock({ stock_quantity: -2, unit: "Adet" }).tone).toBe("red");
    expect(invoicePickStock({ stock_quantity: 3, unit: "Adet", min_stock_alert: 5 }).tone).toBe("amber");
    expect(invoicePickStock({ stock_quantity: 40, unit: "Adet", min_stock_alert: 5 }).tone).toBe("green");
    expect(invoicePickMeta({ sku: "VD", unit: "Kg", vat_rate: 10 }, 2)).toBe("VD · Kg · KDV %10 · faturada 2");
    expect(invoicePickMeta({ sku: "", unit: "", vat_rate: 20 }, 0)).toBe("— · Adet · KDV %20");
    expect(invoicePickAddLabel(2, 3)).toBe("2 ürün ekle (3 adet)");
    const added = commitProductLine([emptyLine()], { id: "p1", name: "Vida", unit: "Adet", sale_price: 10, vat_rate: 20 }, "sales");
    const again = commitProductLine(added.items, { id: "p1", name: "Vida", unit: "Adet", sale_price: 10, vat_rate: 20 }, "sales");
    expect(invoiceScanStrip(again)).toBe("📷 Vida +1 → faturada 2 Adet");
  });
});

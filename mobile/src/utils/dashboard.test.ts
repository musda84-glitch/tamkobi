import { monthlySalesRow, netProfitRow, salesChangeText } from "./dashboard";
import { fmtMoney } from "./money";

const overview = {
  invoices: { outgoing: { month: 7, week: 2, today: 1 }, incoming: { month: 0, week: 0, today: 0 } },
} as never;

describe("dashboard", () => {
  it("shows the monthly turnover with invoice count", () => {
    const row = monthlySalesRow({ monthly_sales: 128400.5, sales_change_pct: 12.4 }, overview);
    expect(row.label).toBe("Bu ay ciro");
    expect(row.value).toBe(fmtMoney(128400.5));
    expect(row.hint).toBe("7 fatura · ▲%12,4 geçen aya göre");
  });

  it("falls back to the invoice count when turnover is unavailable", () => {
    expect(monthlySalesRow(null, overview)).toEqual({ label: "Bu ay satış", value: "7", hint: "Fatura adedi" });
    expect(monthlySalesRow({}, null)).toEqual({ label: "Bu ay satış", value: "0", hint: "Fatura adedi" });
  });

  it("formats the change only when the server sends one", () => {
    expect(salesChangeText(null)).toBe("");
    expect(salesChangeText(undefined)).toBe("");
    expect(salesChangeText(-8)).toBe("▼%8 geçen aya göre");
    expect(salesChangeText(0)).toBe("%0 geçen aya göre");
  });

  it("adds a profit row with the expense hint", () => {
    expect(netProfitRow(null)).toBeNull();
    expect(netProfitRow({ monthly_sales: 10 })).toBeNull();
    expect(netProfitRow({ net_profit: -250, monthly_expenses: 900 })).toEqual({
      label: "Bu ay net kâr",
      value: fmtMoney(-250),
      hint: `Gider ${fmtMoney(900)}`,
    });
  });
});

import { isLiquidityAccount, shownAccountBalance, sumShownBalances, totalLiquidity } from "./accountTotals";

test("toplam likidite ve grup kartı aynı görünen bakiyeyi kullanır", () => {
  const accounts = [
    { type: "cash_box", current_balance: 10 },
    { type: "bank", current_balance: 5 },
    { type: "pos", current_balance: 3 },
    { type: "credit_card", current_balance: -20 },
    { type: "credit_card", is_customer_card_pool: true, current_balance: 99 },
  ];
  expect(shownAccountBalance(accounts[4])).toBe(0);
  expect(isLiquidityAccount(accounts[2])).toBe(true);
  expect(isLiquidityAccount(accounts[3])).toBe(false);
  expect(totalLiquidity(accounts)).toBe(18);
  expect(sumShownBalances(accounts.filter((a) => a.type === "bank"))).toBe(5);
  expect(sumShownBalances(accounts.filter((a) => a.type === "cash_box"))).toBe(10);
  expect(sumShownBalances(accounts.filter((a) => a.type === "pos"))).toBe(3);
  expect(sumShownBalances(accounts.filter((a) => a.type === "credit_card"))).toBe(-20);
});

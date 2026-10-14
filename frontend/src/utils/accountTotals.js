/** Hesap kartı ve Toplam Likidite aynı görünen bakiyeyi kullanır. */

export function shownAccountBalance(account) {
  if (!account || account.is_customer_card_pool) return 0;
  const n = Number(account.current_balance);
  return Number.isFinite(n) ? n : 0;
}

export function isLiquidityAccount(account) {
  return Boolean(account) && account.type !== "credit_card" && !account.is_customer_card_pool;
}

export function sumShownBalances(accounts) {
  return (accounts || []).reduce((sum, account) => sum + shownAccountBalance(account), 0);
}

/** Kredi kartı ve müşteri kart havuzu hariç. */
export function totalLiquidity(accounts) {
  return sumShownBalances((accounts || []).filter(isLiquidityAccount));
}

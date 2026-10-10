/** Hesap hareketleri listesi: hesap filtresi + tarih sırası. Eşleşmiş bank_sync satırları asla elenmez. */

export function matchesAccount(tx, id) {
  if (!id || !tx) return false;
  return tx.account_id === id || tx.target_account_id === id || tx.customer_card_account_id === id;
}

/** Yeni → eski (ekstre / hesap hareketleri). */
export function sortBankTransactions(txs) {
  const rows = Array.isArray(txs) ? [...txs] : [];
  return rows.sort((a, b) => {
    const da = String(a?.date || "");
    const db = String(b?.date || "");
    if (da !== db) return db.localeCompare(da);
    const ca = String(a?.created_at || a?.matched_at || "");
    const cb = String(b?.created_at || b?.matched_at || "");
    if (ca !== cb) return cb.localeCompare(ca);
    return String(b?.id || b?._id || "").localeCompare(String(a?.id || a?._id || ""));
  });
}

/**
 * Seçili hesap / grup hareketleri.
 * match_status (matched/unmatched) filtrelemez — eşleşmiş banka satırı listede kalır.
 */
export function filterAccountTransactions(txs, { accountId = null, groupIds = null } = {}) {
  const rows = Array.isArray(txs) ? txs : [];
  let filtered = rows;
  if (accountId) {
    filtered = rows.filter((tx) => matchesAccount(tx, accountId));
  } else if (Array.isArray(groupIds) && groupIds.length) {
    filtered = rows.filter((tx) => groupIds.some((id) => matchesAccount(tx, id)));
  }
  return sortBankTransactions(filtered);
}

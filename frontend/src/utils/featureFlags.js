/** Çalışma anı bayrakları. Varsayılan kapalı; kapatmak geri dönüştür. */

export const BANK_TX_PAGING_STORAGE_KEY = "tk_ff_bank_tx_paging";

/**
 * Banka/kasa hareket listesini sunucuda sayfala.
 * localStorage "tk_ff_bank_tx_paging" === "1" ise açık. Aksi halde kapalı.
 */
export function isBankTxServerPagingEnabled() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(BANK_TX_PAGING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** İstenen ad: varsayılan kapalı. Açık mı sorusu isBankTxServerPagingEnabled(). */
export const BANK_TX_SERVER_PAGING = false;

export const PARTNER_TX_PAGING_STORAGE_KEY = "tk_ff_partner_tx_paging";

/**
 * Ortak hareket listesini sunucuda sayfala.
 * localStorage "tk_ff_partner_tx_paging" === "1" ise açık. Aksi halde kapalı.
 */
export function isPartnerTxServerPagingEnabled() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(PARTNER_TX_PAGING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

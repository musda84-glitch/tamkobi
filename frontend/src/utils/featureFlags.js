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

export const CONTACTS_PAGING_STORAGE_KEY = "tk_ff_contacts_paging";

/**
 * Cari listesini sunucuda sayfala.
 * localStorage "tk_ff_contacts_paging" === "1" ise açık. Aksi halde kapalı.
 */
export function isContactsServerPagingEnabled() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(CONTACTS_PAGING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** İstenen ad: varsayılan kapalı. Açık mı sorusu isContactsServerPagingEnabled(). */
export const CONTACTS_SERVER_PAGING = false;

export const ORDERS_PAGING_STORAGE_KEY = "tk_ff_orders_paging";

/**
 * Sipariş listesini sunucuda sayfala.
 * localStorage "tk_ff_orders_paging" === "1" ise açık. Aksi halde kapalı.
 */
export function isOrdersServerPagingEnabled() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(ORDERS_PAGING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** İstenen ad: varsayılan kapalı. Açık mı sorusu isOrdersServerPagingEnabled(). */
export const ORDERS_SERVER_PAGING = false;

export const PRODUCTS_PAGING_STORAGE_KEY = "tk_ff_products_paging";

/**
 * Stok / ürün listesini sunucuda sayfala.
 * localStorage "tk_ff_products_paging" === "1" ise açık. Aksi halde kapalı.
 */
export function isProductsServerPagingEnabled() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(PRODUCTS_PAGING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** İstenen ad: varsayılan kapalı. Açık mı sorusu isProductsServerPagingEnabled(). */
export const PRODUCTS_SERVER_PAGING = false;

export const INVOICES_PAGING_STORAGE_KEY = "tk_ff_invoices_paging";

/**
 * Fatura listesini sunucuda sayfala.
 * localStorage "tk_ff_invoices_paging" === "1" ise açık. Aksi halde kapalı.
 */
export function invoicesServerPagingEnabled() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(INVOICES_PAGING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** İstenen ad: varsayılan kapalı. Açık mı sorusu invoicesServerPagingEnabled(). */
export const INVOICES_SERVER_PAGING = false;

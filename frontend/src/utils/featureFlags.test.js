import {
  BANK_TX_PAGING_STORAGE_KEY,
  BANK_TX_SERVER_PAGING,
  CONTACTS_PAGING_STORAGE_KEY,
  CONTACTS_SERVER_PAGING,
  ORDERS_PAGING_STORAGE_KEY,
  ORDERS_SERVER_PAGING,
  PARTNER_TX_PAGING_STORAGE_KEY,
  PRODUCTS_PAGING_STORAGE_KEY,
  PRODUCTS_SERVER_PAGING,
  INVOICES_PAGING_STORAGE_KEY,
  INVOICES_SERVER_PAGING,
  isBankTxServerPagingEnabled,
  isContactsServerPagingEnabled,
  isOrdersServerPagingEnabled,
  isPartnerTxServerPagingEnabled,
  isProductsServerPagingEnabled,
  invoicesServerPagingEnabled,
} from "./featureFlags";

test("BANK_TX_SERVER_PAGING varsayılan kapalı", () => {
  localStorage.removeItem(BANK_TX_PAGING_STORAGE_KEY);
  expect(BANK_TX_SERVER_PAGING).toBe(false);
  expect(isBankTxServerPagingEnabled()).toBe(false);
});

test("tk_ff_bank_tx_paging=1 bayrağı açar", () => {
  localStorage.setItem(BANK_TX_PAGING_STORAGE_KEY, "1");
  expect(isBankTxServerPagingEnabled()).toBe(true);
  localStorage.setItem(BANK_TX_PAGING_STORAGE_KEY, "0");
  expect(isBankTxServerPagingEnabled()).toBe(false);
  localStorage.removeItem(BANK_TX_PAGING_STORAGE_KEY);
});

test("tk_ff_partner_tx_paging varsayılan kapalı, 1 ile açılır", () => {
  localStorage.removeItem(PARTNER_TX_PAGING_STORAGE_KEY);
  expect(isPartnerTxServerPagingEnabled()).toBe(false);
  localStorage.setItem(PARTNER_TX_PAGING_STORAGE_KEY, "1");
  expect(isPartnerTxServerPagingEnabled()).toBe(true);
  localStorage.setItem(PARTNER_TX_PAGING_STORAGE_KEY, "0");
  expect(isPartnerTxServerPagingEnabled()).toBe(false);
  localStorage.removeItem(PARTNER_TX_PAGING_STORAGE_KEY);
});

test("CONTACTS_SERVER_PAGING varsayılan kapalı", () => {
  localStorage.removeItem(CONTACTS_PAGING_STORAGE_KEY);
  expect(CONTACTS_SERVER_PAGING).toBe(false);
  expect(isContactsServerPagingEnabled()).toBe(false);
});

test("tk_ff_contacts_paging=1 bayrağı açar", () => {
  localStorage.setItem(CONTACTS_PAGING_STORAGE_KEY, "1");
  expect(isContactsServerPagingEnabled()).toBe(true);
  localStorage.setItem(CONTACTS_PAGING_STORAGE_KEY, "0");
  expect(isContactsServerPagingEnabled()).toBe(false);
  localStorage.removeItem(CONTACTS_PAGING_STORAGE_KEY);
});

test("ORDERS_SERVER_PAGING varsayılan kapalı", () => {
  localStorage.removeItem(ORDERS_PAGING_STORAGE_KEY);
  expect(ORDERS_SERVER_PAGING).toBe(false);
  expect(isOrdersServerPagingEnabled()).toBe(false);
});

test("tk_ff_orders_paging=1 bayrağı açar", () => {
  localStorage.setItem(ORDERS_PAGING_STORAGE_KEY, "1");
  expect(isOrdersServerPagingEnabled()).toBe(true);
  localStorage.setItem(ORDERS_PAGING_STORAGE_KEY, "0");
  expect(isOrdersServerPagingEnabled()).toBe(false);
  localStorage.removeItem(ORDERS_PAGING_STORAGE_KEY);
});

test("PRODUCTS_SERVER_PAGING varsayılan kapalı", () => {
  localStorage.removeItem(PRODUCTS_PAGING_STORAGE_KEY);
  expect(PRODUCTS_SERVER_PAGING).toBe(false);
  expect(isProductsServerPagingEnabled()).toBe(false);
});

test("tk_ff_products_paging=1 bayrağı açar", () => {
  localStorage.setItem(PRODUCTS_PAGING_STORAGE_KEY, "1");
  expect(isProductsServerPagingEnabled()).toBe(true);
  localStorage.setItem(PRODUCTS_PAGING_STORAGE_KEY, "0");
  expect(isProductsServerPagingEnabled()).toBe(false);
  localStorage.removeItem(PRODUCTS_PAGING_STORAGE_KEY);
});

test("INVOICES_SERVER_PAGING varsayılan kapalı", () => {
  localStorage.removeItem(INVOICES_PAGING_STORAGE_KEY);
  expect(INVOICES_SERVER_PAGING).toBe(false);
  expect(invoicesServerPagingEnabled()).toBe(false);
});

test("tk_ff_invoices_paging=1 bayrağı açar", () => {
  localStorage.setItem(INVOICES_PAGING_STORAGE_KEY, "1");
  expect(invoicesServerPagingEnabled()).toBe(true);
  localStorage.setItem(INVOICES_PAGING_STORAGE_KEY, "0");
  expect(invoicesServerPagingEnabled()).toBe(false);
  localStorage.removeItem(INVOICES_PAGING_STORAGE_KEY);
});

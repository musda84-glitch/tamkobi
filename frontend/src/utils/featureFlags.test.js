import { BANK_TX_PAGING_STORAGE_KEY, BANK_TX_SERVER_PAGING, PARTNER_TX_PAGING_STORAGE_KEY, isBankTxServerPagingEnabled, isPartnerTxServerPagingEnabled } from "./featureFlags";

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

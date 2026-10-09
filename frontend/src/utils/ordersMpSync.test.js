import { ORDERS_MP_SYNC_TRIGGERS, shouldSyncMarketplaceOnPageOpen } from "./ordersMpSync";

describe("ordersMpSync policy", () => {
  it("never syncs on nav / F5 / mount", () => {
    expect(ORDERS_MP_SYNC_TRIGGERS.navClick).toBe(false);
    expect(ORDERS_MP_SYNC_TRIGGERS.pageReload).toBe(false);
    expect(ORDERS_MP_SYNC_TRIGGERS.mountLoadData).toBe(false);
    expect(shouldSyncMarketplaceOnPageOpen()).toBe(false);
  });

  it("allows Yenile and 10-minute loop", () => {
    expect(ORDERS_MP_SYNC_TRIGGERS.toolbarRefresh).toBe(true);
    expect(ORDERS_MP_SYNC_TRIGGERS.bulkMenuRefresh).toBe(true);
    expect(ORDERS_MP_SYNC_TRIGGERS.autoLoop10min).toBe(true);
  });
});

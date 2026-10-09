/**
 * Siparişler sayfası pazaryeri çekim kuralları (dokümantasyon + test).
 *
 * - Nav / F5 / mount → yalnızca yerel GET /orders (sync-now YOK)
 * - Toolbar «Yenile» / toplu menü Yenile → sync-now
 * - Sunucu → 10 dk arka plan döngüsü
 */

export const ORDERS_MP_SYNC_TRIGGERS = Object.freeze({
  toolbarRefresh: true,
  bulkMenuRefresh: true,
  autoLoop10min: true,
  navClick: false,
  pageReload: false,
  mountLoadData: false,
});

export function shouldSyncMarketplaceOnPageOpen() {
  return ORDERS_MP_SYNC_TRIGGERS.navClick
    || ORDERS_MP_SYNC_TRIGGERS.pageReload
    || ORDERS_MP_SYNC_TRIGGERS.mountLoadData;
}

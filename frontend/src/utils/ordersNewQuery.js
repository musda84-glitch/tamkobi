/** Üst bar / radial: /orders?new=1 — modal kapanınca param temizlenmeli. */

export function stripNewOrderParam(searchParams) {
  if (!searchParams || typeof searchParams.get !== "function") return null;
  if (searchParams.get("new") !== "1") return null;
  const next = new URLSearchParams(searchParams);
  next.delete("new");
  return next;
}

/**
 * Aynı URL'deyken navigate no-op olur; önce ?new kaldırıp tekrar ekle.
 * @param {(to: string, opts?: object) => void} navigate
 * @param {{ pathname?: string, search?: string }} location
 */
export function navigateNewOrder(navigate, location = {}) {
  const path = String(location.pathname || "");
  const search = String(location.search || "");
  const onOrders = path === "/orders" || path.startsWith("/orders/");
  const hasNew = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("new") === "1";
  if (onOrders && hasNew) {
    navigate("/orders", { replace: true });
    queueMicrotask(() => navigate("/orders?new=1"));
    return;
  }
  navigate("/orders?new=1");
}

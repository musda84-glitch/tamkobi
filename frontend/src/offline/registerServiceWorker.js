/** Üretim derlemesinde Workbox service worker kaydı. API yanıtları önbelleğe alınmaz. */

export function registerOfflineServiceWorker() {
  if (process.env.NODE_ENV !== "production") return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    const url = `${process.env.PUBLIC_URL || ""}/service-worker.js`;
    navigator.serviceWorker.register(url).catch(() => {});
  });
}

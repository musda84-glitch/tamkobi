import { useEffect } from "react";

/** Kasa / cari / fatura gibi ekranlar arası arka plan yenileme olayı. */
export const DATA_CHANGED_EVENT = "tamkobi:data-changed";

/** Scope → IndexedDB koleksiyonları (olay ayrıntısında listelenir). */
export const SCOPE_COLLECTIONS = {
  cash: ["bank_transactions", "contacts"],
  contacts: ["contacts"],
  invoices: ["invoices", "contacts", "orders"],
  orders: ["orders"],
  expenses: ["contacts"],
  stock: ["products"],
  all: ["bank_transactions", "contacts", "invoices", "products", "orders"],
};

/**
 * İşlem sonrası açık ekranlara arka planda yeniden yükleme sinyali gönder.
 * IndexedDB imleci silinmez. Silmek sonraki cachedList'i since'siz tam
 * /api/sync yapar; 8 sayfa tavanı listeyi eksik bırakır. Delta ve mezar
 * taşları silinen kaydı düşürür.
 */
export async function notifyDataChanged({
  companyId,
  scopes = ["cash"],
  collections = [],
} = {}) {
  const cols = new Set(collections);
  for (const scope of scopes) {
    for (const name of SCOPE_COLLECTIONS[scope] || []) cols.add(name);
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DATA_CHANGED_EVENT, {
      detail: { companyId, scopes, collections: [...cols], at: Date.now() },
    })
  );
}

export function scopesOverlap(listenerScopes = ["cash"], eventScopes = ["cash"]) {
  if (!listenerScopes?.length || !eventScopes?.length) return true;
  if (eventScopes.includes("all") || listenerScopes.includes("all")) return true;
  return listenerScopes.some((s) => eventScopes.includes(s));
}

/** SSE cash olayları bu pencerede tek yenilemeye iner. */
export const CASH_EVENT_DEBOUNCE_MS = 700;

/**
 * Sayfa/komponent: cash vb. değişince sessizce yeniden yükle.
 * onRefresh stabil olmalı (useCallback).
 * cash kapsamı 700 ms debounce: art arda olaylar tek yenileme olur.
 */
export function useDataRefresh(onRefresh, { companyId, scopes = ["cash"], debounceMs } = {}) {
  const scopesKey = Array.isArray(scopes) ? scopes.join(",") : String(scopes || "");
  useEffect(() => {
    if (typeof onRefresh !== "function") return undefined;
    const listenerScopes = scopesKey ? scopesKey.split(",") : [];
    let timer = null;
    const handler = (event) => {
      const detail = event?.detail || {};
      if (companyId && detail.companyId && detail.companyId !== companyId) return;
      const eventScopes = detail.scopes || ["cash"];
      if (!scopesOverlap(listenerScopes, eventScopes)) return;
      const wait = debounceMs != null
        ? debounceMs
        : (eventScopes.includes("cash") ? CASH_EVENT_DEBOUNCE_MS : 0);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (wait <= 0) {
        onRefresh(detail);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        onRefresh(detail);
      }, wait);
    };
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, handler);
      if (timer) clearTimeout(timer);
    };
  }, [onRefresh, companyId, scopesKey, debounceMs]);
}

import { useEffect } from "react";
import { dropCached } from "./dataSync";

/** Kasa / cari / fatura gibi ekranlar arası arka plan yenileme olayı. */
export const DATA_CHANGED_EVENT = "tamkobi:data-changed";

/** Scope → IndexedDB koleksiyonları (mutation sonrası drop edilir). */
export const SCOPE_COLLECTIONS = {
  cash: ["bank_transactions", "contacts"],
  contacts: ["contacts"],
  invoices: ["invoices", "contacts"],
  expenses: ["contacts"],
  stock: ["products"],
  all: ["bank_transactions", "contacts", "invoices", "products"],
};

/**
 * İşlem sonrası: ilgili IndexedDB cache'ini düşür ve açık ekranlara
 * arka planda yeniden yükleme sinyali gönder.
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
  if (companyId) {
    await Promise.all([...cols].map((name) => dropCached(name, companyId)));
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

/**
 * Sayfa/komponent: cash vb. değişince sessizce yeniden yükle.
 * onRefresh stabil olmalı (useCallback).
 */
export function useDataRefresh(onRefresh, { companyId, scopes = ["cash"] } = {}) {
  const scopesKey = Array.isArray(scopes) ? scopes.join(",") : String(scopes || "");
  useEffect(() => {
    if (typeof onRefresh !== "function") return undefined;
    const handler = (event) => {
      const detail = event?.detail || {};
      if (companyId && detail.companyId && detail.companyId !== companyId) return;
      if (!scopesOverlap(scopes, detail.scopes || ["cash"])) return;
      onRefresh(detail);
    };
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
  }, [onRefresh, companyId, scopesKey]);
}

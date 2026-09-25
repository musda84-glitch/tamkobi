/** Nav geçmişi yoksa listeye dön. */
export function headerBackAction(canGoBack: boolean, fallback: string): "back" | string {
  return canGoBack ? "back" : fallback || "/";
}

/** Stok listesi tab rotası; diğer modüller kendi klasör adını kullanır. */
const LIST_TAB_FALLBACK: Record<string, string> = {
  stock: "/stok",
};

const LIST_STACK_ROOTS = new Set([
  "contacts",
  "invoices",
  "orders",
  "sevk",
  "sayim",
  "banking",
  "cheques",
  "expenses",
  "quotes",
  "projects",
  "surveys",
  "personnel",
]);

/** Expo web'de geçmiş yoksa (yenile / deep link) ilgili listeye veya ana sayfaya dön. */
export function stackHeaderFallback(routeName: string): string {
  const parts = String(routeName || "").split("/").filter(Boolean);
  if (!parts.length) return "/";
  const root = parts[0];
  const child = parts[1];
  const nested = Boolean(child && child !== "index");
  if (nested && LIST_TAB_FALLBACK[root]) return LIST_TAB_FALLBACK[root];
  if (nested && LIST_STACK_ROOTS.has(root)) return `/${root}`;
  return "/";
}

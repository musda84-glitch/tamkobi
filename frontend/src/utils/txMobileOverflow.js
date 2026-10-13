/** Structural guards: 375px-wide movement cards must not include a table or unbreakable min-width. */
export function txMobileListGuards(root) {
  const list = root.querySelector("[data-tx-mobile-list]");
  if (!list) return { ok: false, reason: "no-mobile-list" };
  if (list.querySelector("table")) return { ok: false, reason: "table-in-cards" };
  if (!/overflow-x-hidden/.test(list.className)) return { ok: false, reason: "no-overflow-hidden" };
  if (!/md:hidden/.test(list.className)) return { ok: false, reason: "cards-not-md-hidden" };
  const wrap = list.querySelector("[data-tx-wrap]") || root.querySelector("[data-tx-wrap]");
  if (!wrap) return { ok: false, reason: "no-wrap" };
  const cls = wrap.className || "";
  if (!/break-words/.test(cls)) return { ok: false, reason: "no-break-words" };
  if (!/overflow-wrap:anywhere/.test(cls)) return { ok: false, reason: "no-overflow-wrap" };
  if (!/word-break:break-word/.test(cls)) return { ok: false, reason: "no-word-break" };
  return { ok: true, reason: "" };
}

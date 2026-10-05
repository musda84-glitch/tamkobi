/** Gelen e-belge listesinde aynı GİB faturasının kopyalarını gizler. */

export function uniqueInboxItems(items) {
  const seen = new Set();
  const out = [];
  for (const d of items || []) {
    const uuid = String(d.uuid || "").trim().toLowerCase().replace(/[{}]/g, "");
    const number = String(d.number || "").trim().toLowerCase();
    const kind = d.kind === "dispatch" ? "dispatch" : "invoice";
    const keys = [];
    if (uuid) keys.push(`u:${uuid}`);
    if (number) keys.push(`n:${kind}:${number}`);
    if (!keys.length) keys.push(`id:${d.id}`);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(d);
  }
  return out;
}

/** Bekleyen / red / dikkate alınmayan. İçeri alınanlar Faturalar → Gelen e-Fatura'da. */
export const INBOX_STATUS_FILTERS = [
  ["pending", "Bekleyen"],
  ["rejected", "Reddedilen"],
  ["ignored", "Dikkate alınmayan"],
];

export function inboxStatusKey(status) {
  const s = String(status || "pending");
  return INBOX_STATUS_FILTERS.some(([k]) => k === s) ? s : "pending";
}

/** Varsayılan gelen e-fatura; all/invoice aynı liste. */
export function inboxKindFromQuery(kind) {
  return String(kind || "").toLowerCase() === "dispatch" ? "dispatch" : "invoice";
}

export function inboxItemsOfKind(items, kind) {
  const list = uniqueInboxItems(items);
  if (inboxKindFromQuery(kind) === "dispatch") return list.filter((d) => d.kind === "dispatch");
  return list.filter((d) => d.kind !== "dispatch");
}

/** Gelen faturaya alırken stok kartı açılsın mı. */
export function processStockChoice(createCards) {
  return createCards
    ? { auto_create_products: true, allow_unmatched: false }
    : { auto_create_products: false, allow_unmatched: true };
}

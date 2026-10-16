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

/** GİB ticari fatura yanıt süresi (gün), fatura tarihinden itibaren. */
export const COMMERCIAL_RESPONSE_DAYS = 8;
export const GIB_ACCEPT_CONFIRM = "Bu yanıt GİB'e gider, geri alınamaz";
export const GIB_RED_OPTION_LABEL = "GİB'e RED yanıtı gönder";
export const DISPATCH_PROCESS_LABEL = "İrsaliyeyi teslim al (stok girişi)";
export const DISPATCH_PROCESS_SUCCESS = "Gelen irsaliye alındı";
export const INVOICE_PROCESS_LABEL = "Gelen faturaya al";

export function istanbulDateISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function commercialElapsedDays(issueDate, now = new Date()) {
  const issued = String(issueDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issued)) return null;
  const today = istanbulDateISO(now);
  const a = Date.parse(`${issued}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function isCommercialInvoice(doc) {
  if (!doc || doc.kind === "dispatch") return false;
  return String(doc.profile || "").toUpperCase().includes("TICARI");
}

export function commercialWindowOpen(doc, now = new Date()) {
  if (!isCommercialInvoice(doc)) return false;
  const elapsed = commercialElapsedDays(doc.issue_date, now);
  return elapsed != null && elapsed <= COMMERCIAL_RESPONSE_DAYS;
}

export function canSendCommercialResponse(doc, now = new Date()) {
  if (!commercialWindowOpen(doc, now)) return false;
  const resp = String(doc.commercial_response || "");
  return resp !== "accepted" && resp !== "rejected" && resp !== "sending";
}

export function commercialDaysLeft(doc, now = new Date()) {
  const elapsed = commercialElapsedDays(doc?.issue_date, now);
  if (elapsed == null) return null;
  return Math.max(0, COMMERCIAL_RESPONSE_DAYS - Math.max(0, elapsed));
}

/** Gelen kutu rozeti: Yanıt bekliyor (kalan gün) / Kabul edildi / Reddedildi. */
export function commercialBadge(doc, now = new Date()) {
  if (!doc || doc.kind === "dispatch") return null;
  const resp = String(doc.commercial_response || "");
  if (resp === "accepted") return { label: "Kabul edildi", tone: "ok" };
  if (resp === "rejected") return { label: "Reddedildi", tone: "bad" };
  if (!isCommercialInvoice(doc) || resp === "sending") return null;
  const elapsed = commercialElapsedDays(doc.issue_date, now);
  if (elapsed == null || elapsed > COMMERCIAL_RESPONSE_DAYS) return null;
  const left = commercialDaysLeft(doc, now);
  return { label: `Yanıt bekliyor (${left} gün)`, tone: "wait" };
}

/** Faturalar listesindeki gelen fatura satırı — aynı üç durum. */
export function incomingCommercialStatusLabel(inv, now = new Date()) {
  if (!inv || inv.invoice_type === "dispatch" || inv.e_type === "e_dispatch") return null;
  const incoming = inv.direction === "incoming" || inv.source === "edoc_inbox" || inv.edoc_id;
  if (!incoming || inv.invoice_type !== "purchase") return null;
  const stored = String(inv.commercial_response || "").toLowerCase();
  const gib = String(inv.gib_response || "").toLowerCase();
  const gs = String(inv.gib_status || "");
  if (stored === "rejected" || gib === "rejected") return { label: "Reddedildi", tone: "bad" };
  if (stored === "accepted") return { label: "Kabul edildi", tone: "ok" };
  if (/yanıt bekleniyor|yanit bekleniyor/i.test(gs)) {
    const elapsed = commercialElapsedDays(inv.issue_date, now);
    if (elapsed != null && elapsed <= COMMERCIAL_RESPONSE_DAYS) {
      const left = Math.max(0, COMMERCIAL_RESPONSE_DAYS - Math.max(0, elapsed));
      return { label: `Yanıt bekliyor (${left} gün)`, tone: "wait" };
    }
    return { label: "Yanıt bekliyor", tone: "wait" };
  }
  const profile = String(inv.gib_scenario || inv.profile || "").toUpperCase();
  if (profile.includes("TICARI") && gib === "accepted") return { label: "Kabul edildi", tone: "ok" };
  return null;
}

export function inboxProcessLabel(doc) {
  return doc?.kind === "dispatch" ? DISPATCH_PROCESS_LABEL : INVOICE_PROCESS_LABEL;
}

export function inboxProcessSuccess(doc) {
  return doc?.kind === "dispatch"
    ? DISPATCH_PROCESS_SUCCESS
    : "Gelen faturaya alındı. Faturalar listesinde görünür.";
}

export const COMMERCIAL_BADGE_CLASS = {
  wait: "bg-amber-50 text-amber-800",
  ok: "bg-emerald-50 text-emerald-700",
  bad: "bg-rose-50 text-rose-700",
};

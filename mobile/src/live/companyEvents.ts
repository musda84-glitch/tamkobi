/** Şirket olay türü → yenilenecek kapsamlar. Web companyEvents.js ile aynı. */
export const EVENT_SCOPES: Record<string, string[]> = {
  bank_account: ["cash"],
  bank_transaction: ["cash"],
  partner: ["cash"],
  partner_transaction: ["cash"],
  payment: ["cash", "contacts"],
  transfer: ["cash", "contacts"],
  invoice: ["invoices", "contacts", "cash"],
  order: ["orders", "stock"],
  contact: ["contacts", "cash"],
  stock: ["stock"],
};

export const EVENT_DEBOUNCE_MS = 400;

export function scopesForEventType(type?: string | null): string[] {
  if (!type) return ["all"];
  return EVENT_SCOPES[type] || ["all"];
}

export function scopesOverlap(listenerScopes: string[] = ["cash"], eventScopes: string[] = ["cash"]): boolean {
  if (!listenerScopes.length || !eventScopes.length) return true;
  if (eventScopes.includes("all") || listenerScopes.includes("all")) return true;
  return listenerScopes.some((scope) => eventScopes.includes(scope));
}

export function parseSseChunk(buffer: string): { events: { event: string; data: Record<string, unknown> }[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() || "";
  const events: { event: string; data: Record<string, unknown> }[] = [];
  for (const block of parts) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    try {
      const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      events.push({ event, data });
    } catch {
      /* bozuk blok */
    }
  }
  return { events, rest };
}

export function nextRetryDelay(attempt: number): number {
  const n = Number(attempt) || 0;
  return Math.min(15000, 1000 * 2 ** Math.min(n, 4));
}

export function shouldRefreshOnForeground(state: string): boolean {
  return state === "active";
}

function apiHostname(baseUrl?: string | null): string {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProto).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** ik ve ynt API hostu olay akışında 403 döner; köprü bağlanmasın. */
export function companyEventStreamEnabled(baseUrl?: string | null): boolean {
  const label = apiHostname(baseUrl).split(".")[0];
  return label !== "ik" && label !== "ynt";
}

type Listener = (scopes: string[]) => void;
const listeners = new Set<Listener>();

export function emitLiveRefresh(scopes: string[]): void {
  for (const listener of listeners) listener(scopes);
}

export function subscribeLiveRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

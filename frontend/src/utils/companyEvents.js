/** Şirket olay türü → yenilenecek ekran kapsamları. Bilinmeyen tür her şeyi tazeler. */
export const EVENT_SCOPES = {
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

export function scopesForEventType(type) {
  return EVENT_SCOPES[type] || ["all"];
}

export function parseSseBlock(block) {
  let event = "message";
  const dataLines = [];
  for (const line of String(block || "").split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

/** Art arda gelen olayları tek yenilemede birleştirir. */
export function createChangeBuffer({ debounceMs = EVENT_DEBOUNCE_MS, onFlush } = {}) {
  let timer = null;
  let scopes = new Set();
  const fire = (extra) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const batch = new Set(scopes);
    scopes = new Set();
    for (const scope of extra || []) batch.add(scope);
    if (batch.size && typeof onFlush === "function") onFlush([...batch]);
  };
  return {
    push(type) {
      for (const scope of scopesForEventType(type)) scopes.add(scope);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fire(), debounceMs);
    },
    flushNow(extraScopes) {
      fire(extraScopes);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      scopes = new Set();
    },
  };
}

export function nextRetryDelay(attempt) {
  const n = Number(attempt) || 0;
  return Math.min(15000, 1000 * (2 ** Math.min(n, 4)));
}

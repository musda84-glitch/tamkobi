/** e-İrsaliye nakliye doğrulaması — web despatchShipment.js ile aynı kurallar. */

const PLATE_RE = /^(0[1-9]|[1-7][0-9]|8[01])[A-Z]{1,3}\d{2,4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DespatchForm = {
  despatch_mode: "own" | "carrier";
  issue_date: string;
  issue_time: string;
  shipping_address: string;
  despatch_plate: string;
  despatch_driver_first: string;
  despatch_driver_last: string;
  despatch_driver_tckn: string;
  despatch_carrier_vkn: string;
  despatch_carrier_name: string;
  cargo_tracking_number: string;
};

export type DespatchLike = {
  invoice_type?: string;
  e_type?: string;
  direction?: string;
  source?: string;
  edoc_id?: string;
  gib_status?: string;
  einvoice_state?: string;
  gib_status_code?: string;
  gib_uuid?: string;
  gib_tracking_id?: string;
  status?: string;
  issue_date?: string;
  issue_time?: string;
  shipping_address?: string;
  address?: string;
  despatch_mode?: string;
  despatch_plate?: string;
  plate?: string;
  despatch_driver_first?: string;
  driver_first?: string;
  despatch_driver_last?: string;
  driver_last?: string;
  despatch_driver_tckn?: string;
  driver_tckn?: string;
  despatch_carrier_vkn?: string;
  carrier_vkn?: string;
  despatch_carrier_name?: string;
  carrier_name?: string;
  cargo_tracking_number?: string;
};

export function digits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export function normalizePlate(value: unknown): string {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function tcknValid(value: unknown): boolean {
  const raw = digits(value);
  if (raw.length !== 11 || raw[0] === "0") return false;
  const n = [...raw].map((c) => Number(c));
  const odd = n[0] + n[2] + n[4] + n[6] + n[8];
  const even = n[1] + n[3] + n[5] + n[7];
  if (n[9] !== ((odd * 7) - even) % 10) return false;
  return n[10] === n.slice(0, 10).reduce((s, x) => s + x, 0) % 10;
}

export function vknValid(value: unknown): boolean {
  const raw = digits(value);
  if (raw.length !== 10 || raw === "0000000000") return false;
  const nums = [...raw].map((c) => Number(c));
  let total = 0;
  for (let i = 0; i < 9; i += 1) {
    const tmp = (nums[i] + (9 - i)) % 10;
    const contrib = tmp === 9 ? 9 : (tmp * (2 ** (9 - i))) % 9;
    total += contrib;
  }
  const check = (10 - (total % 10)) % 10;
  return nums[9] === check;
}

export function taxIdValid(value: unknown): boolean {
  const raw = digits(value);
  if (raw.length === 11) return tcknValid(raw);
  if (raw.length === 10) return vknValid(raw);
  return false;
}

export function isIncomingDispatch(inv?: DespatchLike | null): boolean {
  if (!inv) return false;
  if (inv.invoice_type !== "dispatch" && inv.e_type !== "e_dispatch") return false;
  if (inv.direction === "incoming" || inv.source === "edoc_inbox" || inv.edoc_id) return true;
  return /gelen/i.test(String(inv.gib_status || ""));
}

export function despatchNeedsCorrection(inv?: DespatchLike | null): boolean {
  if (!inv) return false;
  if (String(inv.einvoice_state || "") === "error") return true;
  return /^\s*hata\s*:/i.test(String(inv.gib_status || ""));
}

export function despatchGibAccepted(inv?: DespatchLike | null): boolean {
  if (!inv || isIncomingDispatch(inv)) return false;
  const state = String(inv.einvoice_state || "").toLowerCase();
  const gs = String(inv.gib_status || "");
  const code = String(inv.gib_status_code || "").trim();
  const uuid = String(inv.gib_uuid || inv.gib_tracking_id || "").trim();
  if (state === "error" || /^\s*hata\s*:/i.test(gs)) return code === "1300" && UUID_RE.test(uuid);
  if (!UUID_RE.test(uuid)) return false;
  if (code === "1300") return true;
  if (state === "sent" || state === "accepted") return true;
  const folded = gs.toLowerCase().replace(/ı/g, "i");
  if (folded.includes("basariyla tamamland") || folded.includes("gib onay")) return true;
  return false;
}

export function canSendOutgoingDispatch(inv?: DespatchLike | null): boolean {
  if (!inv) return false;
  if (inv.invoice_type !== "dispatch" && inv.e_type !== "e_dispatch") return false;
  if (inv.status === "cancelled") return false;
  if (isIncomingDispatch(inv)) return false;
  if (despatchGibAccepted(inv)) return false;
  return true;
}

export function despatchSendLabel(inv?: DespatchLike | null): string {
  return despatchNeedsCorrection(inv) ? "Düzelt ve tekrar gönder" : "GİB'e gönder";
}

function pick(inv: DespatchLike | null | undefined, defaults: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  const bag = inv as Record<string, unknown> | null | undefined;
  const defs = defaults || {};
  for (const key of keys) {
    if (bag && bag[key] != null && String(bag[key]).trim() !== "") return String(bag[key]).trim();
    if (defs[key] != null && String(defs[key]).trim() !== "") return String(defs[key]).trim();
  }
  return "";
}

export function despatchFormFrom(
  inv?: DespatchLike | null,
  defaults?: Record<string, unknown> | null,
  fallbackAddress = "",
): DespatchForm {
  const d = defaults || {};
  const plate = pick(inv, d, "despatch_plate", "plate");
  const carrierVkn = pick(inv, d, "despatch_carrier_vkn", "carrier_vkn");
  const carrierName = pick(inv, d, "despatch_carrier_name", "carrier_name");
  let mode = String(inv?.despatch_mode || d.mode || "").toLowerCase();
  if (mode !== "own" && mode !== "carrier") {
    mode = carrierVkn && carrierName && !plate ? "carrier" : "own";
  }
  const time = pick(inv, d, "issue_time") || "09:00";
  return {
    despatch_mode: mode === "carrier" ? "carrier" : "own",
    issue_date: String(inv?.issue_date || "").slice(0, 10),
    issue_time: time.slice(0, 5),
    shipping_address: String(inv?.shipping_address || inv?.address || fallbackAddress || "").trim(),
    despatch_plate: plate,
    despatch_driver_first: pick(inv, d, "despatch_driver_first", "driver_first"),
    despatch_driver_last: pick(inv, d, "despatch_driver_last", "driver_last"),
    despatch_driver_tckn: pick(inv, d, "despatch_driver_tckn", "driver_tckn"),
    despatch_carrier_vkn: carrierVkn,
    despatch_carrier_name: carrierName,
    cargo_tracking_number: String(inv?.cargo_tracking_number || "").trim(),
  };
}

export function validateDespatchForm(form?: Partial<DespatchForm> | null): string[] {
  const f = form || {};
  const problems: string[] = [];
  const date = String(f.issue_date || "").trim().slice(0, 10);
  const time = String(f.issue_time || "").trim();
  const address = String(f.shipping_address || "").trim();
  if (!DATE_RE.test(date)) problems.push("Sevk tarihi eksik.");
  if (!TIME_RE.test(time)) problems.push("Sevk saati eksik.");
  if (!address || address === "-" || address === ".") problems.push("Teslim adresi eksik.");
  if (f.despatch_mode === "carrier") {
    const vkn = digits(f.despatch_carrier_vkn);
    if (!vkn) problems.push("Taşıyıcı VKN/TCKN eksik.");
    else if (!taxIdValid(vkn)) problems.push("Taşıyıcı VKN/TCKN geçersiz.");
    if (!String(f.despatch_carrier_name || "").trim()) problems.push("Taşıyıcı ünvan eksik.");
  } else {
    const plate = normalizePlate(f.despatch_plate);
    if (!plate) problems.push("Araç plakası eksik.");
    else if (!PLATE_RE.test(plate)) problems.push("Araç plakası biçimi geçersiz.");
    if (!String(f.despatch_driver_first || "").trim()) problems.push("Şoför adı eksik.");
    if (!String(f.despatch_driver_last || "").trim()) problems.push("Şoför soyadı eksik.");
    const tckn = digits(f.despatch_driver_tckn);
    if (!tckn) problems.push("Şoför TCKN eksik.");
    else if (!tcknValid(tckn)) problems.push("Şoför TCKN geçersiz.");
  }
  return problems;
}

export function despatchSendPayload(form?: Partial<DespatchForm> | null) {
  const f = form || {};
  const time = String(f.issue_time || "").trim();
  return {
    e_type: "e_dispatch",
    despatch_mode: f.despatch_mode === "carrier" ? "carrier" : "own",
    issue_date: String(f.issue_date || "").slice(0, 10),
    issue_time: time.length === 5 ? `${time}:00` : time,
    shipping_address: String(f.shipping_address || "").trim(),
    despatch_plate: normalizePlate(f.despatch_plate),
    despatch_driver_first: String(f.despatch_driver_first || "").trim(),
    despatch_driver_last: String(f.despatch_driver_last || "").trim(),
    despatch_driver_tckn: digits(f.despatch_driver_tckn),
    despatch_carrier_vkn: digits(f.despatch_carrier_vkn),
    despatch_carrier_name: String(f.despatch_carrier_name || "").trim(),
    cargo_tracking_number: String(f.cargo_tracking_number || "").trim(),
  };
}

export function splitDispatchLists<T extends DespatchLike>(rows: T[]): { incoming: T[]; outgoing: T[] } {
  const incoming: T[] = [];
  const outgoing: T[] = [];
  for (const row of rows) {
    if (isIncomingDispatch(row)) incoming.push(row);
    else outgoing.push(row);
  }
  return { incoming, outgoing };
}

export function dispatchDirFromParam(value: unknown): "in" | "out" {
  return value === "in" ? "in" : "out";
}

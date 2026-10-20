import { applyChequeScan, type ChequeScanDraft } from "./chequeScan";
import {
  chequePayload,
  emptyChequeDraft,
  validateChequeDraft,
  type Cheque,
  type ChequeDraft,
} from "./cheques";
import { fmtDate, fmtMoney } from "./money";

export const CHEQUE_BATCH_LIMIT = 50;

export type ChequeBatchSource = "manual" | "scan";

export type ChequeBatchItem = {
  id: string;
  draft: ChequeDraft;
  source: ChequeBatchSource;
};

export type ChequeBatchContact = {
  contact_id?: string;
  id?: string;
  contact_name?: string;
  name?: string;
};

export type SavedChequeBatch = {
  mode: "single" | "group";
  contactId: string;
  contactName: string;
  direction: "received" | "issued";
  items: Cheque[];
  total: number;
  recordDate: string;
  receiptGroupId?: string;
};

let batchSeq = 0;

function nextBatchId(): string {
  batchSeq += 1;
  return `b${batchSeq}`;
}

function cloneDraft(draft: ChequeDraft): ChequeDraft {
  return { ...draft };
}

function amountOf(value: string | number): number {
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function addBatchItem(
  items: ChequeBatchItem[],
  draft: ChequeDraft,
  source: ChequeBatchSource = "manual",
): ChequeBatchItem[] {
  if (items.length >= CHEQUE_BATCH_LIMIT) return items;
  return [...items, { id: nextBatchId(), draft: cloneDraft(draft), source }];
}

export function removeBatchItem(items: ChequeBatchItem[], index: number): ChequeBatchItem[] {
  if (index < 0 || index >= items.length) return items;
  return items.filter((_, i) => i !== index);
}

export function updateBatchItem(items: ChequeBatchItem[], index: number, draft: ChequeDraft): ChequeBatchItem[] {
  if (index < 0 || index >= items.length) return items;
  return items.map((item, i) => (i === index ? { ...item, draft: cloneDraft(draft) } : item));
}

export function batchTotal(items: ChequeBatchItem[]): number {
  const sum = items.reduce((acc, item) => acc + amountOf(item.draft.amount), 0);
  return Math.round(sum * 100) / 100;
}

function contactIdOf(contact: ChequeBatchContact | string): string {
  if (typeof contact === "string") return contact.trim();
  return String(contact.contact_id || contact.id || "").trim();
}

/** Ortak cari/yön üstte; kalemler chequePayload alan kurallarını kullanır. Boş keşide gönderilmez. */
export function chequeBatchPayload(
  draftItems: ChequeDraft[],
  contact: ChequeBatchContact | string,
  direction: "received" | "issued",
  companyId: string,
  notes?: string,
) {
  const contactId = contactIdOf(contact);
  const items = draftItems.map((draft) => {
    const full = chequePayload({ ...draft, contact_id: contactId, direction }, companyId);
    const { company_id: _company, contact_id: _contact, direction: _direction, issue_date: issue, ...rest } = full;
    return issue ? { ...rest, issue_date: issue } : rest;
  });
  const shared = String(notes || "").trim();
  return {
    company_id: companyId,
    contact_id: contactId,
    direction,
    ...(shared ? { notes: shared } : {}),
    items,
  };
}

function errorText(err: unknown): string {
  if (typeof err === "string") return err.trim();
  if (!err || typeof err !== "object") return "";
  const anyErr = err as {
    message?: string;
    detail?: unknown;
    response?: { data?: { detail?: unknown } };
  };
  const detail = anyErr.response?.data?.detail ?? anyErr.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (typeof anyErr.message === "string") return anyErr.message.trim();
  return "";
}

/** "Kalem 2: …" → 2. Backend kalem indeksini 0 tabanlı yazar. */
export function batchItemErrorIndex(err: unknown): number | null {
  const match = /Kalem\s+(\d+)\s*:/.exec(errorText(err));
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) ? index : null;
}

export function batchItemErrorText(err: unknown): string | null {
  const text = errorText(err);
  return batchItemErrorIndex(err) == null ? null : text;
}

export function nextChequeDraft(current: ChequeDraft, today = ""): ChequeDraft {
  const blank = emptyChequeDraft(today);
  return {
    ...blank,
    direction: current.direction,
    instrument: current.instrument,
    contact_id: current.contact_id,
    contact_name: current.contact_name,
  };
}

export function batchHeading(
  items: ChequeBatchItem[],
  direction: "received" | "issued",
  contactName: string,
): string {
  const kinds = new Set(items.map((item) => item.draft.instrument));
  const kind = kinds.size === 1 && kinds.has("promissory") ? "SENET" : kinds.size > 1 ? "ÇEK / SENET" : "ÇEK";
  const way = direction === "issued" ? "VERİLEN" : "ALINAN";
  return `${way} ${kind} · ${contactName || "CARİ"}`;
}

export function batchMetaLine(count: number, recordDate: string): string {
  return `${count} çek · tek makbuz · kayıt ${fmtDate(recordDate)}`;
}

export function batchSaveLabel(count: number, total: number): string {
  return `${count} çeki kaydet · ${fmtMoney(total)}`;
}

export function batchDueLabel(rows: { due_date?: string | null }[]): string {
  const dates = [...new Set(
    rows.map((row) => String(row.due_date || "").slice(0, 10)).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)),
  )].sort();
  if (!dates.length) return "—";
  if (dates.length === 1) return fmtDate(dates[0]);
  return `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`;
}

export function appendScannedCheque(
  items: ChequeBatchItem[],
  scan: ChequeScanDraft | null | undefined,
  lock: { contact_id: string; contact_name: string; direction: "received" | "issued" },
): { items: ChequeBatchItem[]; error: string | null } {
  if (items.length >= CHEQUE_BATCH_LIMIT) return { items, error: "En fazla 50 çek." };
  const base: ChequeDraft = {
    ...emptyChequeDraft(""),
    contact_id: lock.contact_id,
    contact_name: lock.contact_name,
    direction: lock.direction,
  };
  const next = applyChequeScan(base, scan);
  next.direction = lock.direction;
  next.contact_id = lock.contact_id;
  next.contact_name = lock.contact_name;
  const invalid = validateChequeDraft(next);
  if (invalid) return { items, error: invalid };
  return { items: addBatchItem(items, next, "scan"), error: null };
}

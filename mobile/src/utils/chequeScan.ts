import type { ApiClient } from "../api/client";
import { upload } from "../api/client";
import { compressPickerAsset } from "./compressUploadImage";
import type { ChequeDraft } from "./cheques";
import { appendUploadBlob, resolveUploadBlob, type PickerAssetLike } from "./formDataFile";

export type ChequeScanDraft = {
  instrument?: "cheque" | "promissory" | string;
  direction?: "received" | "issued" | string;
  amount?: number;
  due_date?: string | null;
  issue_date?: string | null;
  serial_no?: string | null;
  bank_name?: string | null;
  bank_branch?: string | null;
  account_no?: string | null;
  drawer_name?: string | null;
  contact_name?: string | null;
  notes?: string | null;
  confidence?: number;
};

export type ChequeExtractResponse = {
  draft?: ChequeScanDraft;
  source?: string;
  matched_contact?: { id?: string; _id?: string; name?: string } | null;
};

export function chequeAmountInput(amount: number, sep: "." | "," = ","): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(".", sep);
}

function textOf(v?: string | null): string {
  return String(v || "").trim();
}

export function applyChequeScan(
  form: ChequeDraft,
  draft?: ChequeScanDraft | null,
  match?: { id?: string; _id?: string; name?: string } | null,
  amountSep: "." | "," = ",",
): ChequeDraft {
  if (!form || !draft) return form;
  const amount = chequeAmountInput(Number(draft.amount) || 0, amountSep);
  const contactId = String(match?.id || match?._id || "").trim();
  return {
    ...form,
    instrument: draft.instrument === "promissory" ? "promissory" : draft.instrument === "cheque" ? "cheque" : form.instrument,
    direction: draft.direction === "issued" ? "issued" : draft.direction === "received" ? "received" : form.direction,
    ...(amount ? { amount } : {}),
    ...(textOf(draft.due_date) ? { due_date: textOf(draft.due_date) } : {}),
    ...(textOf(draft.issue_date) ? { issue_date: textOf(draft.issue_date) } : {}),
    ...(textOf(draft.serial_no) ? { serial_no: textOf(draft.serial_no) } : {}),
    ...(textOf(draft.bank_name) ? { bank_name: textOf(draft.bank_name) } : {}),
    ...(textOf(draft.bank_branch) ? { bank_branch: textOf(draft.bank_branch) } : {}),
    ...(textOf(draft.account_no) ? { account_no: textOf(draft.account_no) } : {}),
    ...(textOf(draft.drawer_name) ? { drawer_name: textOf(draft.drawer_name) } : {}),
    ...(textOf(draft.notes) ? { notes: textOf(draft.notes) } : {}),
    ...(contactId ? { contact_id: contactId, contact_name: textOf(match?.name) || form.contact_name } : {}),
    ...(!contactId && textOf(draft.contact_name) && !form.contact_id ? { contact_name: textOf(draft.contact_name) } : {}),
  };
}

export const CHEQUE_SCAN_IDLE_HINT =
  "Kamera veya galeri ile çek / senet okuyun; tutar, vade ve banka dolar. Gerekirse yapay zeka okur.";

export function chequeScanHint(draft?: ChequeScanDraft | null): string {
  if (!draft || !(Number(draft.amount) > 0)) return "Çek okunamadı.";
  const kind = draft.instrument === "promissory" ? "Senet" : "Çek";
  const way = draft.direction === "issued" ? "verilen" : "alınan";
  return `${way} ${kind.toLowerCase()} okundu · ${chequeAmountInput(Number(draft.amount), ",")} ₺`;
}

export function chequeScanNavParams(
  draft?: ChequeScanDraft | null,
  match?: { id?: string; _id?: string; name?: string } | null,
) {
  return {
    contact_id: String(match?.id || match?._id || ""),
    contact_name: String(match?.name || draft?.contact_name || ""),
    instrument: draft?.instrument === "promissory" ? "promissory" : "cheque",
    direction: draft?.direction === "issued" ? "issued" : "received",
    amount: chequeAmountInput(Number(draft?.amount) || 0, ","),
    notes: String(draft?.notes || ""),
    serial_no: String(draft?.serial_no || ""),
    bank_name: String(draft?.bank_name || ""),
    bank_branch: String(draft?.bank_branch || ""),
    account_no: String(draft?.account_no || ""),
    drawer_name: String(draft?.drawer_name || ""),
    issue_date: String(draft?.issue_date || ""),
    due_date: String(draft?.due_date || ""),
  };
}

export async function extractChequeFromAsset(
  client: ApiClient,
  companyId: string,
  asset: PickerAssetLike,
): Promise<ChequeExtractResponse> {
  const compact = await compressPickerAsset(asset);
  const { blob, name } = await resolveUploadBlob(compact);
  const form = new FormData();
  appendUploadBlob(form, blob, name);
  return upload<ChequeExtractResponse>(client, "/ai/cheque-extract", form, { company_id: companyId });
}

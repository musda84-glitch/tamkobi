import type { ApiClient } from "../api/client";
import { upload } from "../api/client";
import { compressPickerAsset } from "./compressUploadImage";
import { appendUploadBlob, resolveUploadBlob, type PickerAssetLike } from "./formDataFile";

export type ReceiptDraft = {
  type: "inflow" | "outflow";
  amount: number;
  date?: string | null;
  description?: string;
  contact_name?: string | null;
  tax_number?: string | null;
  confidence?: number;
};

export type ReceiptExtractResponse = {
  draft?: ReceiptDraft;
  source?: string;
  matched_contact?: { id?: string; name?: string } | null;
  filename?: string;
};

export function receiptAmountInput(amount: number, sep: "." | "," = ","): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(".", sep);
}

export function applyReceiptDraft<T extends { type?: string; amount?: string; description?: string }>(
  form: T,
  draft?: ReceiptDraft | null,
  amountSep: "." | "," = ",",
): T {
  if (!draft) return form;
  const type = draft.type === "outflow" ? "outflow" : "inflow";
  const amount = receiptAmountInput(Number(draft.amount) || 0, amountSep);
  const description = String(draft.description || "").trim();
  return {
    ...form,
    type,
    ...(amount ? { amount } : {}),
    ...(description ? { description } : {}),
  };
}

export function receiptScanHint(draft?: ReceiptDraft | null): string {
  if (!draft || !(Number(draft.amount) > 0)) return "Makbuz okunamadı.";
  const kind = draft.type === "outflow" ? "Ödeme" : "Tahsilat";
  const amt = receiptAmountInput(Number(draft.amount), ",");
  return `${kind} okundu · ${amt} ₺`;
}

export async function extractReceiptFromAsset(
  client: ApiClient,
  companyId: string,
  asset: PickerAssetLike,
): Promise<ReceiptExtractResponse> {
  const compact = await compressPickerAsset(asset);
  const { blob, name } = await resolveUploadBlob(compact);
  const form = new FormData();
  appendUploadBlob(form, blob, name);
  return upload<ReceiptExtractResponse>(client, "/ai/receipt-extract", form, { company_id: companyId });
}

import type { ApiClient } from "../api/client";
import { upload } from "../api/client";
import { compressPickerAsset } from "./compressUploadImage";
import { EXPENSE_DEFAULT_CATEGORIES, type ExpenseDraft } from "./finance";
import { appendUploadBlob, resolveUploadBlob, type PickerAssetLike } from "./formDataFile";

export type ExpenseScanDraft = {
  amount?: number;
  vat_rate?: number;
  vat_included?: boolean;
  date?: string | null;
  description?: string;
  category?: string;
  document_no?: string | null;
  contact_name?: string | null;
  notes?: string | null;
};

export type ExpenseExtractResponse = {
  draft?: ExpenseScanDraft;
  matched_contact?: { id?: string; _id?: string; name?: string } | null;
};

export function expenseAmountInput(amount: number, sep: "." | "," = ","): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(".", sep);
}

function textOf(v?: string | null): string {
  return String(v || "").trim();
}

export function applyExpenseScan(
  form: ExpenseDraft,
  draft?: ExpenseScanDraft | null,
  match?: { id?: string; _id?: string; name?: string } | null,
  amountSep: "." | "," = ",",
): ExpenseDraft {
  if (!form || !draft) return form;
  const amount = expenseAmountInput(Number(draft.amount) || 0, amountSep);
  const vat = Number(draft.vat_rate);
  const category = textOf(draft.category);
  const contactId = String(match?.id || match?._id || "").trim();
  return {
    ...form,
    ...(amount ? { amount } : {}),
    ...(vat === 0 || vat === 1 || vat === 10 || vat === 20 ? { vat_rate: String(vat) } : {}),
    vat_included: draft.vat_included !== false,
    ...(textOf(draft.date) ? { date: textOf(draft.date) } : {}),
    ...(textOf(draft.description) ? { description: textOf(draft.description) } : {}),
    ...(category && (EXPENSE_DEFAULT_CATEGORIES as readonly string[]).includes(category) ? { category } : {}),
    ...(textOf(draft.document_no) ? { document_no: textOf(draft.document_no) } : {}),
    ...(textOf(draft.notes) ? { notes: textOf(draft.notes) } : {}),
    ...(contactId ? { contact_id: contactId } : {}),
  };
}

export function expenseScanHint(draft?: ExpenseScanDraft | null): string {
  if (!draft || !(Number(draft.amount) > 0)) return "Fiş okunamadı.";
  const cat = textOf(draft.category) || "Masraf";
  return `${cat} fişi okundu · ${expenseAmountInput(Number(draft.amount), ",")} ₺`;
}

export function expenseScanNavParams(
  draft?: ExpenseScanDraft | null,
  match?: { id?: string; _id?: string; name?: string } | null,
) {
  const vat = Number(draft?.vat_rate);
  return {
    amount: expenseAmountInput(Number(draft?.amount) || 0, ","),
    description: String(draft?.description || ""),
    category: String(draft?.category || ""),
    date: String(draft?.date || ""),
    document_no: String(draft?.document_no || ""),
    vat_rate: vat === 0 || vat === 1 || vat === 10 || vat === 20 ? String(vat) : "",
    vat_included: draft?.vat_included === false ? "0" : "1",
    notes: String(draft?.notes || ""),
    contact_id: String(match?.id || match?._id || ""),
  };
}

export function applyExpensePrefill(
  draft: ExpenseDraft,
  params?: {
    account_id?: string | string[];
    amount?: string | string[];
    description?: string | string[];
    category?: string | string[];
    date?: string | string[];
    document_no?: string | string[];
    vat_rate?: string | string[];
    vat_included?: string | string[];
    notes?: string | string[];
    contact_id?: string | string[];
  } | null,
): ExpenseDraft {
  const one = (v?: string | string[]) => String(Array.isArray(v) ? v[0] : v || "").trim();
  const ymd = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const vat = one(params?.vat_rate);
  const cat = one(params?.category);
  return {
    ...draft,
    account_id: one(params?.account_id) || draft.account_id,
    amount: one(params?.amount) || draft.amount,
    description: one(params?.description) || draft.description,
    category: cat && (EXPENSE_DEFAULT_CATEGORIES as readonly string[]).includes(cat) ? cat : draft.category,
    date: ymd(one(params?.date)) || draft.date,
    document_no: one(params?.document_no) || draft.document_no,
    vat_rate: vat === "0" || vat === "1" || vat === "10" || vat === "20" ? vat : draft.vat_rate,
    vat_included: one(params?.vat_included) ? one(params?.vat_included) !== "0" : draft.vat_included,
    notes: one(params?.notes) || draft.notes,
    contact_id: one(params?.contact_id) || draft.contact_id,
  };
}

export async function extractExpenseFromAsset(
  client: ApiClient,
  companyId: string,
  asset: PickerAssetLike,
): Promise<ExpenseExtractResponse> {
  const compact = await compressPickerAsset(asset);
  const { blob, name } = await resolveUploadBlob(compact);
  const form = new FormData();
  appendUploadBlob(form, blob, name);
  return upload<ExpenseExtractResponse>(client, "/ai/expense-extract", form, { company_id: companyId });
}

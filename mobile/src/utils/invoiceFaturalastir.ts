import { post, put, type ApiClient } from "../api/client";
import type { Invoice } from "../types";
import type { EfaturaOnayPayload } from "./efaturaOnay";
import { contactMukellefPatch } from "./gibMukellef";
import { incomingPurchaseLedgerPosted, isGibIssued, isIncomingPurchaseInvoice } from "./invoiceDraft";
import { nowIssueDateTime } from "./invoiceIssueNow";

/** Taslak satış faturası — siparişteki Faturalaştır gibi tür seçilip kesilir. */
export function canFaturalastirDraftInvoice(inv?: Invoice | null): boolean {
  if (!inv) return false;
  if (inv.status !== "draft") return false;
  if (inv.invoice_type === "purchase" || isIncomingPurchaseInvoice(inv)) return false;
  if (inv.e_type === "expense_slip") return false;
  if (inv.invoice_type === "dispatch" || inv.e_type === "e_dispatch") return false;
  return !isGibIssued(inv);
}

export const DRAFT_FATURALASTIR_TYPES = [
  { key: "e_invoice", label: "E-Fatura" },
  { key: "e_archive", label: "E-Arşiv" },
  { key: "e_export", label: "e-İhracat" },
  { key: "paper", label: "GİB'e gönderilmeyen / kağıt fatura" },
] as const;

export type DraftFaturalastirType = (typeof DRAFT_FATURALASTIR_TYPES)[number]["key"];

export function draftFaturalastirNeedsOnay(eType: string): boolean {
  return eType === "e_invoice" || eType === "e_archive" || eType === "auto";
}

/** Gelen fatura: sipariş taslağı ile aynı onay. Tür listesi yok. */
export async function postIncomingPurchaseInvoice(client: ApiClient, inv: Invoice): Promise<void> {
  if (incomingPurchaseLedgerPosted(inv)) return;
  const id = inv.id || inv._id;
  if (!id) throw new Error("Fatura bulunamadı.");
  await post(client, `/invoices/${id}/approve`);
}

/** ElektronikFaturaOnayModal sonucu → send-to-gib (InvoiceDetail ile aynı gövde). */
export async function issueInvoiceFromOnay(
  client: ApiClient,
  inv: { id?: string; _id?: string; contact_id?: string },
  payload: EfaturaOnayPayload,
): Promise<{ message?: string; warning?: string; dispatch_draft_warning?: string }> {
  const id = inv.id || inv._id;
  if (!id) throw new Error("Fatura bulunamadı.");
  const mukellefPatch = contactMukellefPatch(payload.gibMeta);
  if (mukellefPatch && inv.contact_id) {
    try {
      await put(client, `/contacts/${inv.contact_id}`, mukellefPatch);
    } catch {
      /* gönderim yine denenecek */
    }
  }
  const patch: Record<string, unknown> = {};
  if (payload.stampNow) Object.assign(patch, nowIssueDateTime());
  if (payload.withholding) {
    patch.withholding_rate = Number(payload.withholding.withholding_rate || 0);
    patch.withholding_code = payload.withholding.withholding_code || null;
  }
  if (payload.exemption?.tax_exemption_code) {
    patch.tax_exemption_code = payload.exemption.tax_exemption_code;
    patch.tax_exemption_reason = payload.exemption.tax_exemption_reason || null;
  }
  if (payload.returnRef?.original_invoice_number) {
    patch.original_invoice_number = payload.returnRef.original_invoice_number;
    patch.original_issue_date = payload.returnRef.original_issue_date || null;
    if (payload.returnRef.notes) patch.notes = payload.returnRef.notes;
  }
  if (Object.keys(patch).length) {
    await put(client, `/invoices/${id}`, patch);
  }
  const body: Record<string, unknown> = { e_type: payload.eType };
  if (payload.scenario) body.scenario = payload.scenario;
  if (payload.stampNow) {
    const stamp = nowIssueDateTime();
    body.stamp_now = true;
    body.issue_date = stamp.issue_date;
    body.issue_time = stamp.issue_time;
  }
  return await post<{ message?: string; warning?: string; dispatch_draft_warning?: string }>(
    client,
    `/invoices/${id}/send-to-gib`,
    body,
  );
}

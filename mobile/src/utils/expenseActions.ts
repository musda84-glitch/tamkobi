import { del, get, post, type ApiClient } from "../api/client";
import { idOf } from "./money";
import { splitPaymentTarget, type Expense } from "./finance";

export const EXPENSE_PAY_NEED_TARGET = "Ödeme için kasa/banka/ortak seçin.";
export const EXPENSE_PAY_OK = "Masraf ödendi.";
export const EXPENSE_PAY_FAIL = "Ödenemedi.";
export const EXPENSE_UNPAY_TITLE = "Ödemeyi geri al";
export const EXPENSE_UNPAY_BODY = "Kasa/banka bakiyesi düzeltilir.";
export const EXPENSE_UNPAY_OK = "Ödeme geri alındı.";
export const EXPENSE_UNPAY_FAIL = "İşlem başarısız.";
export const EXPENSE_DELETE_TITLE = "Masrafı sil";
export const EXPENSE_DELETE_FAIL = "Silinemedi.";

export type ExpensePayBody = { account_id?: string | null; partner_id?: string | null };

/** Aynı kasa/banka/ortak seçimi: paymentTargetGroups değeri splitPaymentTarget ile çözülür. */
export function expensePayRequest(payAcc: string): { ok: true; body: ExpensePayBody } | { ok: false; error: string } {
  const target = splitPaymentTarget(payAcc);
  if (!target.account_id && !target.partner_id) return { ok: false, error: EXPENSE_PAY_NEED_TARGET };
  return { ok: true, body: { account_id: target.account_id, partner_id: target.partner_id } };
}

export function expenseDeleteConfirm(expense?: Pick<Expense, "expense_number"> | null): string {
  return `${expense?.expense_number || "Bu masraf"} silinsin mi?`;
}

export async function postExpensePayment(client: ApiClient, expenseId: string, body: ExpensePayBody): Promise<void> {
  await post(client, `/expenses/${expenseId}/pay`, { account_id: body.account_id, partner_id: body.partner_id });
}

export async function postExpenseUnpay(client: ApiClient, expenseId: string): Promise<void> {
  await post(client, `/expenses/${expenseId}/unpay`);
}

export async function deleteExpense(client: ApiClient, expenseId: string): Promise<void> {
  await del(client, `/expenses/${expenseId}`);
}

/** Liste ucundan tek masraf. Arama tutmazsa tam listede id eşlenir. */
export async function fetchExpenseById(client: ApiClient, companyId: string, expenseId: string): Promise<Expense | null> {
  const list = await get<{ expenses?: Expense[] }>(client, "/expenses", { company_id: companyId, q: expenseId });
  const rows = list.expenses || [];
  const found = rows.find((row) => idOf(row) === expenseId) || rows[0];
  let exp = found && idOf(found) === expenseId ? found : null;
  if (!exp) {
    const all = await get<{ expenses?: Expense[] }>(client, "/expenses", { company_id: companyId });
    exp = (all.expenses || []).find((row) => idOf(row) === expenseId) || null;
  }
  return exp;
}

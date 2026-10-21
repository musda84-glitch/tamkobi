import { post, type ApiClient } from "../api/client";
import {
  emptyMatchDraft,
  formatPosAmount,
  matchPayload,
  POS_COMMISSION_CATEGORY,
  type BankMatchTx,
  type MatchDraft,
  type MatchMode,
} from "./bankMatch";
import { idOf } from "./money";

type ReplaceSource = BankMatchTx & {
  expense_id?: string | null;
  as_expense?: boolean | null;
};

export type TxMatchState = "unmatched" | "matched" | "rematching";

/** POST /banking/transactions/{id}/match. replace yalnız true iken gövdeye girer. */
export function submitMatch(
  client: ApiClient,
  tx: BankMatchTx,
  draft: MatchDraft,
  opts?: { replace?: boolean },
) {
  const payload = matchPayload(draft);
  const body = opts?.replace ? { ...payload, replace: true } : payload;
  return post(client, `/banking/transactions/${idOf(tx)}/match`, body);
}

/** POST /banking/transactions/{id}/unmatch. */
export function unmatchTx(client: ApiClient, tx: BankMatchTx) {
  return post(client, `/banking/transactions/${idOf(tx)}/unmatch`, {});
}

/**
 * Değiştir formu: emptyMatchDraft üstüne mevcut eşleşme.
 * match_kind pos_settlement → pos (komisyon masrafı expense moduna düşmez);
 * expense_id / as_expense → expense; target var ve contact yok → transfer;
 * eşleşmiş, contact yok, kategori dolu → category; diğer → contact.
 */
export function replaceMatchDraft(tx?: ReplaceSource | null): MatchDraft {
  const base = emptyMatchDraft(tx);
  const contactId = String(tx?.contact_id || tx?.suggested_contact_id || "");
  const targetId = String(tx?.target_account_id || "");
  const category = String(tx?.category || "");
  const matched = String(tx?.match_status || "") === "matched";
  const pos = tx?.match_kind === "pos_settlement";
  let mode: MatchMode = "contact";
  if (pos) mode = "pos_settlement";
  else if (tx?.expense_id || tx?.as_expense) mode = "expense";
  else if (targetId && !contactId) mode = "transfer";
  else if (matched && !contactId && category.trim()) mode = "category";
  return {
    ...base,
    mode,
    contact_id: pos ? "" : contactId,
    target_account_id: pos ? (targetId || tx?.suggested_target_account_id || "") : targetId,
    category: pos ? (category.trim() || POS_COMMISSION_CATEGORY) : category,
    pos_gross: pos ? formatPosAmount(tx?.pos_gross) : "",
    pos_commission: pos ? formatPosAmount(tx?.pos_commission) : "",
    expense_id: pos ? "" : base.expense_id,
  };
}

/** bank_sync değilse null. rematching / matched / unmatched aynen döner. */
export function txMatchState(tx?: { source?: string | null; match_status?: string | null } | null): TxMatchState | null {
  if (!tx || String(tx.source || "") !== "bank_sync") return null;
  if (tx.match_status === "rematching" || tx.match_status === "matched" || tx.match_status === "unmatched") {
    return tx.match_status;
  }
  return null;
}

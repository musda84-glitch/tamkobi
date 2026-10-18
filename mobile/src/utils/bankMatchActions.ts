import { post, type ApiClient } from "../api/client";
import { matchPayload, type BankMatchTx, type MatchDraft } from "./bankMatch";
import { idOf } from "./money";

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

/** bank_sync değilse null. rematching / matched / unmatched aynen döner. */
export function txMatchState(tx?: { source?: string | null; match_status?: string | null } | null): TxMatchState | null {
  if (!tx || String(tx.source || "") !== "bank_sync") return null;
  if (tx.match_status === "rematching" || tx.match_status === "matched" || tx.match_status === "unmatched") {
    return tx.match_status;
  }
  return null;
}

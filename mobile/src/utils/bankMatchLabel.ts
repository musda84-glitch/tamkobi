/** Banka hareketi Kullanıcı sütunu — web bankMatchLabel ile aynı. */

const SITE_BRAND_ACTOR = /^(tamkobi(\.com)?|nexus(\.com)?)$/i;
const BARE_DOMAIN_ACTOR = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|app|dev|co|tr|com\.tr)$/i;
const PLATFORM_ACTOR_EMAIL = /^(?:tamkobi(?:[.+_-][^@]*)?@|[^@]+@tamkobi\.com(?:\.tr)?$)/i;

export type TxActorLike = {
  created_by_name?: string | null;
  matched_by_name?: string | null;
  match_status?: string | null;
  source?: string | null;
  is_simulated?: boolean | null;
};

export function sanitizeActorLabel(name?: string | null): string {
  const s = String(name || "").trim();
  if (!s) return "";
  if (SITE_BRAND_ACTOR.test(s) || BARE_DOMAIN_ACTOR.test(s)) return "";
  if (PLATFORM_ACTOR_EMAIL.test(s)) return "";
  return s;
}

export function txCreatedSourceLabel(tx?: TxActorLike | null): string {
  const src = String(tx?.source || "");
  if (src === "bank_sync" || src === "card_statement" || src === "bank_statement") {
    return tx?.is_simulated ? "Simüle" : "Sistem (Banka aktarımı)";
  }
  const created = sanitizeActorLabel(tx?.created_by_name);
  if (created) return created;
  if (src === "ledger") return "Sistem";
  return "";
}

/** «Oluşturan: X · Eşleştiren: Y» — eşleşme yoksa yalnızca oluşturan. */
export function txUserColumnLabel(tx?: TxActorLike | null): string {
  const created = txCreatedSourceLabel(tx);
  const matched = sanitizeActorLabel(tx?.matched_by_name);
  const isMatched = String(tx?.match_status || "") === "matched" && !!matched;
  if (isMatched && created) return `Oluşturan: ${created} · Eşleştiren: ${matched}`;
  if (isMatched) return `Eşleştiren: ${matched}`;
  return created || "";
}

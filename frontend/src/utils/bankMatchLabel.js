/** Banka hareketi eşleşme rozeti: hedef cari/hesap + işlemi yapan kullanıcı. */

export function matchTargetLabel(tx) {
  if (tx?.contact_name) return tx.contact_name;
  if (tx?.target_account_name) return tx.target_account_name;
  return "";
}

export function matchActorName(tx) {
  return String(tx?.matched_by_name || "").trim();
}

/** Hareketi oluşturan / eşleştiren yönetici — listede gösterilir. */
export function txCreatedByLabel(tx) {
  const created = String(tx?.created_by_name || "").trim();
  if (created) return created;
  const matched = matchActorName(tx);
  if (matched) return matched;
  if (tx?.source === "bank_sync") return tx?.is_simulated ? "Simüle" : "Banka";
  if (tx?.source === "ledger") return "Sistem";
  return "";
}

export function matchStatusLabel(tx) {
  const target = matchTargetLabel(tx);
  const sep = tx?.contact_name ? ": " : target ? " → " : "";
  const actor = matchActorName(tx);
  return `EŞLEŞTİ${target ? `${sep}${target}` : ""}${actor ? ` · ${actor}` : ""}`;
}

export function matchActorTitle(tx) {
  const actor = matchActorName(tx);
  if (!actor) return "";
  const via = tx?.matched_via;
  const how =
    via === "rule" ? "kural" :
    via === "suggestion" ? "öneri" :
    via === "auto" ? "otomatik" :
    via === "history" || via === "prior" ? "önceki eşleşme" :
    "manuel";
  return `${actor} eşleştirdi (${how})`;
}

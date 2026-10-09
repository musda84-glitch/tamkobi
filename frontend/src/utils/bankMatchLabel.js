/** Banka hareketi eşleşme rozeti: hedef cari/hesap + işlemi yapan kullanıcı. */

const GENERIC_DESC = /^(banka\s*hareketi|gelen\s*havale\/?eft|giden\s*ödeme|giden\s*odeme)$/i;

function _clean(s) {
  return String(s || "").trim();
}

/** Liste hücresi: bankadan gelen açıklama / karşı taraf; jenerik "Banka Hareketi" gizlenir. */
export function txDescriptionLabel(tx) {
  const desc = _clean(tx?.description);
  const cp = _clean(tx?.counterparty);
  const generic = !desc || GENERIC_DESC.test(desc);
  const parts = [];
  if (!generic) parts.push(desc);
  if (cp && !parts.some((p) => p.toLocaleLowerCase("tr").includes(cp.toLocaleLowerCase("tr")))) {
    parts.push(cp);
  }
  if (!parts.length) {
    const tip = tx?.type === "inflow" ? "Gelen" : tx?.type === "outflow" ? "Giden" : "Hareket";
    const who = _clean(tx?.suggested_contact_name) || _clean(tx?.contact_name);
    if (who) parts.push(`${tip} · ${who}`);
    else if (_clean(tx?.external_id)) parts.push(`${tip} · ref ${tx.external_id}`);
    else parts.push(tip);
  } else {
    const who = _clean(tx?.contact_name);
    if (who && !parts.some((p) => p.toLocaleLowerCase("tr").includes(who.toLocaleLowerCase("tr")))) {
      parts.push(who);
    }
  }
  return parts.join(" · ");
}

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

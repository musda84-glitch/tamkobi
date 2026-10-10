/** Banka hareketi eşleşme rozeti: hedef cari/hesap + işlemi yapan kullanıcı. */

const GENERIC_DESC = /^(banka\s*hareketi|gelen(\s*havale)?(\s*\/?\s*eft)?|giden(\s*(ödeme|odeme|eft|havale))?|havale(\s*\/?\s*eft)?|eft|fast)(\s*[·•\-]\s*ref\s+\S+)?$/i;

function _clean(s) {
  return String(s || "").trim();
}

function _isGenericDesc(desc) {
  const d = _clean(desc);
  if (!d) return true;
  if (GENERIC_DESC.test(d)) return true;
  // "Gelen · ref 189…" / "Gelen havale/EFT · ref …"
  if (/^(gelen|giden)(\s+\S+){0,3}\s*[·•]\s*ref\s+\S+$/i.test(d)) return true;
  return false;
}

/** Liste hücresi: bankadan gelen açıklama / karşı taraf; jenerik "Banka Hareketi" gizlenir. */
export function txDescriptionLabel(tx) {
  const desc = _clean(tx?.description);
  const cp = _clean(tx?.counterparty);
  const generic = _isGenericDesc(desc);
  const parts = [];
  if (!generic) parts.push(desc);
  if (cp && !parts.some((p) => p.toLocaleLowerCase("tr").includes(cp.toLocaleLowerCase("tr")))) {
    parts.push(cp);
  }
  if (!parts.length) {
    const tip = tx?.type === "inflow" ? "Gelen" : tx?.type === "outflow" ? "Giden" : "Hareket";
    const who = cp || _clean(tx?.suggested_contact_name) || _clean(tx?.contact_name);
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
  return sanitizeActorLabel(tx?.matched_by_name);
}

const SITE_BRAND_ACTOR = /^(tamkobi(\.com)?|nexus(\.com)?)$/i;
const BARE_DOMAIN_ACTOR = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|app|dev|co|tr|com\.tr)$/i;
/** Platform CRM / destek e-postası şirket kullanıcısı gibi gösterilmesin. */
const PLATFORM_ACTOR_EMAIL = /^(?:tamkobi(?:[.+_-][^@]*)?@|[^@]+@tamkobi\.com(?:\.tr)?$)/i;

/** Marka / site / platform e-postası kullanıcı gibi gösterilmesin. */
export function sanitizeActorLabel(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  if (SITE_BRAND_ACTOR.test(s) || BARE_DOMAIN_ACTOR.test(s)) return "";
  if (PLATFORM_ACTOR_EMAIL.test(s)) return "";
  return s;
}

/** Hareketi oluşturan / eşleştiren yönetici — listede gösterilir. */
export function txCreatedByLabel(tx) {
  const created = sanitizeActorLabel(tx?.created_by_name);
  if (created) return created;
  const matched = sanitizeActorLabel(matchActorName(tx));
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

/** Banka hareketi eşleşme rozeti: hedef cari/hesap + işlem kullanıcıları. */

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

/** Otomatik banka içe aktarımda oluşturan etiketi — her zaman Sistem (Banka aktarımı). */
export function txCreatedSourceLabel(tx) {
  const src = String(tx?.source || "");
  if (src === "bank_sync" || src === "card_statement" || src === "bank_statement") {
    return tx?.is_simulated ? "Simüle" : "Sistem (Banka aktarımı)";
  }
  const created = sanitizeActorLabel(tx?.created_by_name);
  if (created) return created;
  if (src === "ledger") return "Sistem";
  return "";
}

/**
 * Kullanıcı sütunu: «Oluşturan: X · Eşleştiren: Y»
 * Eşleşme yoksa yalnızca oluşturan.
 */
export function txUserColumnLabel(tx) {
  const created = txCreatedSourceLabel(tx);
  const matched = matchActorName(tx);
  const isMatched = String(tx?.match_status || "") === "matched" && !!matched;
  if (isMatched && created) return `Oluşturan: ${created} · Eşleştiren: ${matched}`;
  if (isMatched) return `Eşleştiren: ${matched}`;
  return created || "";
}

const USER_COLUMN_SHORT_MAX = 28;

function txUserShortCreated(tx) {
  const src = String(tx?.source || "");
  if (src === "bank_sync" || src === "card_statement" || src === "bank_statement") {
    return tx?.is_simulated ? "Simüle" : "Banka aktarımı";
  }
  const created = sanitizeActorLabel(tx?.created_by_name);
  if (created) return created;
  if (src === "ledger") return "Sistem";
  return "";
}

function ellipsizeLabel(text, max) {
  const s = String(text || "");
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Kullanıcı sütununun kısa hali: «Banka aktarımı · Mustafa BAL».
 * En fazla ~28 karakter; sığmazsa … ile biter. txUserColumnLabel aynı kalır.
 */
export function txUserColumnLabelShort(tx, max = USER_COLUMN_SHORT_MAX) {
  const created = txUserShortCreated(tx);
  const matched = matchActorName(tx);
  const isMatched = String(tx?.match_status || "") === "matched" && !!matched;
  let text = "";
  if (isMatched && created) text = `${created} · ${matched}`;
  else if (isMatched) text = matched;
  else text = created || "";
  return ellipsizeLabel(text, max);
}

/** @deprecated alias — liste sütunu için txUserColumnLabel kullanın. */
export function txCreatedByLabel(tx) {
  return txUserColumnLabel(tx);
}

export function matchStatusLabel(tx) {
  const target = matchTargetLabel(tx);
  const sep = tx?.contact_name ? ": " : target ? " → " : "";
  // Kullanıcı adı rozette değil; Kullanıcı sütununda Eşleştiren olarak görünür.
  return `EŞLEŞTİ${target ? `${sep}${target}` : ""}`;
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

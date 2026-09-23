export const CONSENT_WARNING = "Bu sözleşmeleri işaretlediğinizde personel paneli (Mesaim) kullanıma açılır.";
export const CONSENT_DENIED = "KVKK ve konum paylaşımı sözleşmesini kabul etmeden Mesaim kullanılamaz.";

export const KVKK_TITLE = "KVKK aydınlatması (K)";
export const KVKK_TEXT =
  "İşveren, 6698 sayılı KVKK kapsamında mesai takibi için cihazınızın konum verisini (GPS) işler. Veri giriş-çıkış ve görev/iş yeri kontrolü için kullanılır; yasal süre boyunca saklanır.";

export const SHARE_TITLE = "Konum paylaşımı sözleşmesi (KK)";
export const SHARE_TEXT =
  "Mesai süresince konumumun alınmasına ve konum alınamadığında yöneticimin haberdar edilmesine izin veriyorum.";

export function normalizeLocationConsent(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  const accept_kvkk = Boolean(row.accept_kvkk || row.kvkk);
  const accept_share = Boolean(row.accept_share || row.kk || row.location);
  const accepted = Boolean(row.accepted ?? (accept_kvkk && accept_share));
  const at = String(row.accepted_at || "").trim() || null;
  return {
    accept_kvkk,
    accept_share,
    accepted,
    accepted_at: accepted ? at : null,
    required: row.required !== false,
    warning: row.warning || CONSENT_WARNING,
    kvkk_title: row.kvkk_title || KVKK_TITLE,
    kvkk_text: row.kvkk_text || KVKK_TEXT,
    share_title: row.share_title || SHARE_TITLE,
    share_text: row.share_text || SHARE_TEXT,
  };
}

export function locationConsentAccepted(raw) {
  return Boolean(normalizeLocationConsent(raw).accepted);
}

export function validateLocationConsent(req) {
  const row = req && typeof req === "object" ? req : {};
  const kvkk = Boolean(row.accept_kvkk || row.kvkk);
  const share = Boolean(row.accept_share || row.kk);
  if (!kvkk || !share) return "KVKK (K) ve konum paylaşımı (KK) sözleşmelerini işaretleyin.";
  return null;
}

export function locationConsentPayload() {
  return { accept_kvkk: true, accept_share: true };
}

export function normalizeLocationSignal(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  let tone = row.tone;
  let ok = row.ok;
  if (ok === true) tone = tone || "green";
  else if (ok === false) tone = tone || "red";
  else if (tone !== "green" && tone !== "red") {
    tone = "amber";
    ok = ok ?? null;
  }
  const label =
    row.label ||
    (tone === "green" ? "Konum alındı" : tone === "red" ? "Konum alınamadı" : "Konum bekleniyor");
  return { ok: ok === true ? true : ok === false ? false : null, at: row.at || null, tone, label };
}

export function locationUnavailablePayload(reason) {
  const text = String(reason || "").trim();
  return { reason: (text || "Konum izni kapalı veya GPS alınamadı.").slice(0, 200) };
}

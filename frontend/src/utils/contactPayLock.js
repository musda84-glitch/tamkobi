/** Cari Ödemeler satırı kilit / ortak hesabı kuralları. */
export function isPartnerContactPay(p) {
  return p?.source === "partner" && !p?.virtual;
}

export function isLockedContactPay(p) {
  return p?.source === "bank_sync" || p?.source === "cheque" || !!p?.virtual;
}

export function isEndorsementPayment(p) {
  if (!p) return false;
  if (p.cheque_kind === "endorsement") return true;
  return String(p.category || "").startsWith("Ciro edilen");
}

export function lockedContactPayTitle(p) {
  if (isEndorsementPayment(p)) {
    return "Ciro satırları Çek/Senet modülünden yönetilir; buradan düzenlenemez veya silinemez.";
  }
  if (p?.source === "cheque" || p?.virtual) {
    return "Çek/senet kaydından geldi — Çek/Senet modülünden yönetilir";
  }
  return "Banka entegrasyonundan geldi — düzenlenemez";
}

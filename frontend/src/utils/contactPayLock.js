/** Cari Ödemeler satırı kilit / ortak hesabı kuralları. */
export function isPartnerContactPay(p) {
  return p?.source === "partner" && !p?.virtual;
}

export function isLockedContactPay(p) {
  return p?.source === "bank_sync" || p?.source === "cheque" || !!p?.virtual;
}

export function lockedContactPayTitle(p) {
  if (p?.source === "cheque" || p?.virtual) {
    return "Çek/senet kaydından geldi — Çek/Senet modülünden yönetilir";
  }
  return "Banka entegrasyonundan geldi — düzenlenemez";
}

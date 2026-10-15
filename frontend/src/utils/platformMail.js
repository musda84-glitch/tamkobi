export const MAILBOX_PASSWORD_MISSING = "Bu kutunun şifresi tanımlı değil.";
export const SMTP_PASSWORD_MISSING = "SMTP şifresi tanımlı değil (sunucu veya kutu).";
export const MAILBOX_PASSWORD_HINT = "Kutuyu düzenleyip şifre girin.";

/** Şifre eksik hatalarında düzenleme yönlendirmesi. Başka hatalarda boş. */
export function mailboxPasswordHint(detail) {
  const text = typeof detail === "string" ? detail.trim() : "";
  if (text === MAILBOX_PASSWORD_MISSING || text === SMTP_PASSWORD_MISSING) return MAILBOX_PASSWORD_HINT;
  return "";
}

/** Seçili sunucu listede yoksa (silinmiş / eski id) ilk kayıtlı sunucuya düş; yoksa boş. */
export function pickMailServerId(current, servers) {
  const list = Array.isArray(servers) ? servers : [];
  const cur = current == null ? "" : String(current);
  if (cur && list.some((s) => s && s.id === cur)) return cur;
  return (list[0] && list[0].id) || "";
}

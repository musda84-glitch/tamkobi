export function validatePasswordChange(current: string, next: string, confirm: string): string | null {
  if (!current.trim()) return "Mevcut şifreyi girin.";
  if ((next || "").trim().length < 6) return "Yeni şifre en az 6 karakter olmalı.";
  if (next !== confirm) return "Yeni şifreler eşleşmiyor.";
  if (current === next) return "Yeni şifre mevcut şifreyle aynı olamaz.";
  return null;
}

export function passwordChangePayload(current: string, next: string) {
  return { current_password: current, new_password: next.trim() };
}

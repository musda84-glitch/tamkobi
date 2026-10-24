const CODE = /^[A-Za-z0-9_-]{40,128}$/;

export type QrLoginPreview = {
  company_name?: string;
  company_id?: string;
  user_name?: string;
  user_email?: string;
  browser?: string;
  ip?: string;
  expires_at?: string;
};

export const QR_LOGIN_PREVIEW = "/auth/qr-login/preview";
export const QR_LOGIN_APPROVE = "/auth/qr-login/approve";
export const QR_LOGIN_REJECT = "/auth/qr-login/reject";

/** QR içeriği yalnız rastgele koddur. Adres, token veya kısa barkod kabul edilmez. */
export function qrLoginCode(raw: unknown): string | null {
  const text = String(raw ?? "").replace(/^\uFEFF/, "").trim();
  if (!CODE.test(text)) return null;
  if (text.includes("://")) return null;
  return text;
}

export type ForgotChannel = "email" | "sms";

export type ForgotErpInput = {
  channel?: ForgotChannel | string;
  email?: string;
  phone?: string;
  baseUrl: string;
  next?: "login" | "sistem";
};

/** POST /auth/forgot-password gövdesi — kanal SMS ise phone, değilse email. */
export function forgotErpPayload(input: ForgotErpInput): Record<string, string> {
  const channel = String(input.channel || "email").trim().toLowerCase() === "sms" ? "sms" : "email";
  const body: Record<string, string> = {
    channel,
    base_url: input.baseUrl,
    next: input.next || "login",
  };
  if (channel === "sms") {
    body.phone = String(input.phone || "").trim();
  } else {
    body.email = String(input.email || "").trim();
  }
  return body;
}

/** Yanıttan yalnızca kullanıcıya gösterilecek mesaj. */
export function forgotResultMessage(res: { message?: string } | null | undefined, channel: ForgotChannel = "email"): string {
  const msg = String(res?.message || "").trim();
  if (msg) return msg;
  return channel === "sms"
    ? "Kayıtlı bir hesap varsa SMS gönderildi."
    : "Kayıtlı bir hesap varsa e-posta gönderildi.";
}

export type ApprovalChannel = "sms" | "email" | "whatsapp";

export type ApprovalChannelResult = {
  status?: string;
  detail?: string;
  wa_link?: string;
};

export function approvalChannels(flags: { sms?: boolean; email?: boolean; whatsapp?: boolean }): ApprovalChannel[] {
  const out: ApprovalChannel[] = [];
  if (flags.sms) out.push("sms");
  if (flags.email) out.push("email");
  if (flags.whatsapp) out.push("whatsapp");
  return out;
}

export function validateApprovalSend(channels: string[], phone: string, email: string): string | null {
  if (!channels.length) return "En az bir kanal seçin.";
  if ((channels.includes("sms") || channels.includes("whatsapp")) && !phone.trim()) return "Telefon numarası girin.";
  if (channels.includes("email") && !email.trim()) return "E-posta girin.";
  return null;
}

export function approvalPayload(channels: string[], phone: string, email: string, baseUrl: string) {
  return {
    channels,
    phone: phone.trim(),
    email: email.trim(),
    base_url: baseUrl.replace(/\/+$/, ""),
  };
}

export function approvalStatusTr(status?: string | null): string {
  if (status === "accepted") return "Onaylandı";
  if (status === "rejected") return "Reddedildi";
  if (status === "pending") return "Onay bekliyor";
  return "Gönderilmedi";
}

/** Web QuoteSendApprovalModal ile aynı: telefonda SMS + WhatsApp açık. */
export function defaultApprovalFlags(phone?: string | null, email?: string | null) {
  const hasPhone = Boolean(String(phone || "").trim());
  const hasEmail = Boolean(String(email || "").trim());
  return {
    sms: hasPhone,
    email: hasEmail && !hasPhone,
    whatsapp: hasPhone,
  };
}

export function smsComposerHref(phone: string, body: string): string {
  const raw = String(phone || "").trim();
  return `sms:${encodeURIComponent(raw)}?body=${encodeURIComponent(body)}`;
}

export function approvalSmsFallback(
  results: Record<string, ApprovalChannelResult> | null | undefined,
  requested: string[],
): boolean {
  if (!requested.includes("sms")) return false;
  const st = results?.sms?.status;
  return st === "simulated" || st === "failed" || !st;
}

export function approvalSendFeedback(
  results: Record<string, ApprovalChannelResult> | null | undefined,
  requested: string[],
  fallbackOpened = false,
): { ok: boolean; message: string } {
  const sms = results?.sms;
  if (requested.includes("sms") && sms?.status === "failed") {
    return {
      ok: fallbackOpened,
      message: fallbackOpened
        ? "SMS operatörü gönderemedi; telefon SMS uygulaması açıldı."
        : sms.detail || "SMS gönderilemedi.",
    };
  }
  if (requested.includes("sms") && sms?.status === "simulated") {
    return {
      ok: true,
      message: fallbackOpened
        ? "SMS operatörü tanımlı değil; telefon SMS uygulaması açıldı."
        : sms.detail || "Onay linki oluşturuldu. SMS operatör bilgisi girilmedi (simüle).",
    };
  }
  const anySent = Object.values(results || {}).some((v) => v.status === "sent");
  if (anySent) return { ok: true, message: "Onay linki gönderildi." };
  if (Object.values(results || {}).some((v) => v.status === "simulated")) {
    return { ok: true, message: "Onay linki oluşturuldu." };
  }
  return { ok: false, message: "Hiçbir kanaldan gönderilemedi." };
}

export type SmsApiResult = {
  status?: string;
  sent?: number;
  failed?: number;
  simulated?: boolean;
  message?: string;
  error?: string;
};

/** /comm/sms/send 200 döner; gerçek hata status/failed alanındadır. */
export function smsSendFailed(r: SmsApiResult | null | undefined): boolean {
  if (!r) return true;
  if (r.status === "failed") return true;
  if ((r.failed || 0) > 0 && !r.sent) return true;
  return false;
}

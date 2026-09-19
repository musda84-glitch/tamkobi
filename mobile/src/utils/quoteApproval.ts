export type ApprovalChannel = "sms" | "email" | "whatsapp";

export type ApprovalChannelResult = {
  status?: string;
  detail?: string;
  wa_link?: string;
};

export type ApprovalFlags = { sms?: boolean; email?: boolean; whatsapp?: boolean };

export function approvalChannels(flags: ApprovalFlags): ApprovalChannel[] {
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

export function contactPhone(contact?: { phone?: string | null; contact_person_phone?: string | null } | null): string {
  return String(contact?.phone || contact?.contact_person_phone || "").trim();
}

export function contactEmail(contact?: { email?: string | null } | null): string {
  return String(contact?.email || "").trim();
}

/** Web modal gibi telefonda SMS+WhatsApp; e-posta varsa o da açık. */
export function defaultApprovalFlags(phone?: string | null, email?: string | null) {
  const hasPhone = Boolean(String(phone || "").trim());
  const hasEmail = Boolean(String(email || "").trim());
  return {
    sms: hasPhone,
    email: hasEmail,
    whatsapp: hasPhone,
  };
}

export function mergeApprovalFlags(current: ApprovalFlags, phone?: string | null, email?: string | null) {
  const next = defaultApprovalFlags(phone, email);
  if (!current.sms && !current.email && !current.whatsapp) return next;
  return {
    sms: Boolean(current.sms || next.sms),
    email: Boolean(current.email || next.email),
    whatsapp: Boolean(current.whatsapp || next.whatsapp),
  };
}

export function approvalPublicOrigin(apiBase: string, existingLink?: string | null): string {
  const m = String(existingLink || "").match(/^(https?:\/\/[^/]+)/i);
  if (m) return m[1];
  return String(apiBase || "").replace(/\/+$/, "");
}

export function channelResultLabel(status?: string): string {
  if (status === "sent") return "Gönderildi";
  if (status === "simulated") return "Simüle";
  return "Hata";
}

export function smsComposerHref(phone: string, body: string): string {
  const raw = String(phone || "").trim();
  return `sms:${encodeURIComponent(raw)}?body=${encodeURIComponent(body)}`;
}

export function emailComposerHref(email: string, subject: string, body: string): string {
  return `mailto:${String(email || "").trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function approvalChannelNeedsFallback(
  results: Record<string, ApprovalChannelResult> | null | undefined,
  requested: string[],
  channel: "sms" | "email",
): boolean {
  if (!requested.includes(channel)) return false;
  const st = results?.[channel]?.status;
  if (channel === "sms") return st === "simulated" || st === "failed" || !st;
  return st === "failed" || !st;
}

export function approvalSendFeedback(
  results: Record<string, ApprovalChannelResult> | null | undefined,
  requested: string[],
  opened: { sms?: boolean; email?: boolean } = {},
): { ok: boolean; message: string } {
  const parts: string[] = [];
  if (requested.includes("sms")) {
    const sms = results?.sms;
    if (sms?.status === "sent") parts.push("SMS gönderildi.");
    else if (sms?.status === "simulated") {
      parts.push(opened.sms
        ? "SMS operatörü tanımlı değil; telefon SMS uygulaması açıldı."
        : sms.detail || "Onay linki oluşturuldu. SMS operatör bilgisi girilmedi (simüle).");
    } else {
      parts.push(opened.sms
        ? "SMS operatörü gönderemedi; telefon SMS uygulaması açıldı."
        : sms?.detail || "SMS gönderilemedi.");
    }
  }
  if (requested.includes("email")) {
    const mail = results?.email;
    if (mail?.status === "sent") parts.push("E-posta gönderildi.");
    else {
      parts.push(opened.email
        ? "E-posta hesabı gönderemedi; telefon e-posta uygulaması açıldı."
        : mail?.detail || "E-posta gönderilemedi.");
    }
  }
  const recovered = Boolean(
    (requested.includes("sms") && opened.sms) || (requested.includes("email") && opened.email),
  );
  const failedOpen = requested.filter((ch) => {
    if (ch === "sms" && opened.sms) return false;
    if (ch === "email" && opened.email) return false;
    const st = results?.[ch]?.status;
    return st !== "sent" && st !== "simulated";
  });
  const ok = failedOpen.length === 0 || recovered;
  return { ok, message: parts.join(" ") || (ok ? "Onay linki gönderildi." : "Hiçbir kanaldan gönderilemedi.") };
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

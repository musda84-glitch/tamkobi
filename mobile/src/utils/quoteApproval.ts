export type ApprovalChannel = "sms" | "email" | "whatsapp";

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

export function defaultApprovalFlags(phone?: string | null, email?: string | null) {
  const hasPhone = Boolean(String(phone || "").trim());
  const hasEmail = Boolean(String(email || "").trim());
  return {
    sms: false,
    email: hasEmail && !hasPhone,
    whatsapp: hasPhone,
  };
}

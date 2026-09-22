export const QUOTE_STATUS_TR = {
  draft: "Hazırlanıyor",
  sent: "Gönderildi",
  accepted: "Onaylandı",
  rejected: "Reddedildi",
};

export function publicQuoteStatusLabel(q) {
  if (!q) return "";
  return QUOTE_STATUS_TR[q.approval_status] || QUOTE_STATUS_TR[q.status] || q.approval_status || q.status || "";
}

export function publicProjectQuoteUrl(apiUrl, token, quoteNumber) {
  const base = String(apiUrl || "").replace(/\/$/, "");
  return `${base}/public/projects/${encodeURIComponent(token)}/quotes/${encodeURIComponent(quoteNumber)}`;
}

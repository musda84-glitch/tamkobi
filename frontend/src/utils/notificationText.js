export function localizeNotificationText(text) {
  return String(text || "").replace(/\b(approved|rejected|pending)\b/gi, (raw) => {
    const key = raw.toLowerCase();
    if (key === "approved") return "onaylandı";
    if (key === "rejected") return "reddedildi";
    if (key === "pending") return "bekliyor";
    return raw;
  });
}

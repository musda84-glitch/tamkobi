export function validateMessageBody(text) {
  if (!String(text || "").trim()) return "Mesaj yazın.";
  return null;
}

export function unreadStaffMessages(rows, reader) {
  const want = reader === "staff" ? "manager" : "staff";
  return (rows || []).filter((m) => !m.read_at && m.from_side === want).length;
}

export function previewStaffMessages(rows, limit = 4) {
  return (rows || []).slice(0, Math.max(0, limit));
}

export function inboxUnreadTotal(inbox) {
  return (inbox || []).reduce((s, r) => s + (Number(r.unread) || 0), 0);
}

export function messageAuthor(m) {
  if (!m) return "";
  if (m.from_side === "manager") return m.from_name || "Yönetici";
  return m.from_name || m.employee_name || "Personel";
}

export function messagePreview(m) {
  return String(m?.body || "").replace(/\s+/g, " ").trim();
}

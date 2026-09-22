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

export const MESSAGES_HIDDEN_KEY = "tamkobi.staff_messages.hidden";

export function parseHiddenFlag(raw) {
  return raw === "1" || raw === "true";
}

export function mergeInboxWithDirectory(inbox, directory) {
  const by = new Map();
  for (const row of inbox || []) {
    if (row.employee_id) by.set(String(row.employee_id), row);
  }
  for (const emp of directory || []) {
    const id = String(emp.id || "");
    if (!id || by.has(id)) continue;
    by.set(id, { employee_id: id, employee_name: emp.full_name || "Personel", last: null, unread: 0 });
  }
  return [...by.values()].sort((a, b) => {
    const ua = Number(a.unread) || 0;
    const ub = Number(b.unread) || 0;
    if (ub !== ua) return ub - ua;
    if (Boolean(b.last) !== Boolean(a.last)) return b.last ? 1 : -1;
    return String(a.employee_name || "").localeCompare(String(b.employee_name || ""), "tr");
  });
}

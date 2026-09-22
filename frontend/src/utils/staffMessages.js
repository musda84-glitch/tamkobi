export function validateMessageBody(text) {
  if (!String(text || "").trim()) return "Mesaj yazın.";
  return null;
}

export function requireManagerId(managerId, managers) {
  const real = (managers || []).filter((m) => m.id && m.id !== "_all");
  if (!real.length) return null;
  if (!String(managerId || "").trim()) return "Yönetici seçin.";
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

function sortUnreadThenName(rows) {
  return [...rows].sort((a, b) => {
    const ua = Number(a.unread) || 0;
    const ub = Number(b.unread) || 0;
    if (ub !== ua) return ub - ua;
    if (Boolean(b.last) !== Boolean(a.last)) return b.last ? 1 : -1;
    return String(a.name || a.employee_name || "").localeCompare(String(b.name || b.employee_name || ""), "tr");
  });
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
  return sortUnreadThenName([...by.values()]);
}

export function mergeManagerInbox(inbox, managers, selfId) {
  const skip = String(selfId || "");
  const by = new Map();
  for (const row of inbox || []) {
    const id = String(row.user_id || "");
    if (!id || id === skip) continue;
    by.set(id, row);
  }
  for (const m of managers || []) {
    const id = String(m.id || "");
    if (!id || id === skip || by.has(id)) continue;
    by.set(id, { kind: "manager", user_id: id, name: m.name || "Yönetici", last: null, unread: 0 });
  }
  return sortUnreadThenName([...by.values()]);
}

export function managerSelectGroups(managers, inbox, selfId) {
  const skip = String(selfId || "");
  const by = new Map();
  for (const m of managers || []) {
    const id = String(m.id || "");
    if (!id || id === skip) continue;
    by.set(id, { value: id, label: m.name || "Yönetici" });
  }
  for (const row of inbox || []) {
    const id = String(row.user_id || "");
    if (!id || id === skip || by.has(id)) continue;
    by.set(id, { value: id, label: row.name || (id === "_all" ? "Tüm yöneticiler" : "Yönetici") });
  }
  const opts = [...by.values()].sort((a, b) => {
    if (a.value === "_all") return 1;
    if (b.value === "_all") return -1;
    return a.label.localeCompare(b.label, "tr");
  });
  if (!opts.length) return [];
  return [{ label: "Yöneticiler", options: opts }];
}

export function parsePeerValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("m:")) return { kind: "manager", id: raw.slice(2) };
  if (raw.startsWith("g:")) return { kind: "group", id: raw.slice(2) };
  if (raw.startsWith("e:")) return { kind: "emp", id: raw.slice(2) };
  return { kind: "emp", id: raw };
}

export function peerQuery(peer) {
  if (!peer?.id) return {};
  if (peer.kind === "manager") return { to_user_id: peer.id };
  if (peer.kind === "group") return { group_id: peer.id };
  return { employee_id: peer.id };
}

export function peerPostBody(peer, extra) {
  const body = { ...(extra || {}) };
  if (!peer?.id) return body;
  if (peer.kind === "manager" && peer.id !== "_all") body.to_user_id = peer.id;
  if (peer.kind === "group") body.group_id = peer.id;
  if (peer.kind === "emp") body.employee_id = peer.id;
  return body;
}

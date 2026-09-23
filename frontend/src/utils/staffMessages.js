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
export const MESSAGES_COLLAPSED_KEY = "tamkobi.staff_messages.collapsed";

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

export function peerSelectGroups(directory, managers, selfId, inbox) {
  const groups = [];
  const emps = (directory || [])
    .filter((e) => e.id)
    .map((e) => ({
      value: `e:${e.id}`,
      label: [e.full_name, e.position || e.department].filter(Boolean).join(" · "),
    }));
  if (emps.length) groups.push({ label: "Personel", options: emps });
  const skip = String(selfId || "");
  const by = new Map();
  for (const m of managers || []) {
    const id = String(m.id || "");
    if (!id || id === "_all" || id === skip) continue;
    by.set(id, { value: `m:${id}`, label: m.name || "Yönetici" });
  }
  for (const row of inbox || []) {
    const id = String(row.user_id || "");
    if (!id || id === "_all" || id === skip || by.has(id)) continue;
    by.set(id, { value: `m:${id}`, label: row.name || "Yönetici" });
  }
  const mgrs = [...by.values()].sort((a, b) => a.label.localeCompare(b.label, "tr"));
  if (mgrs.length) groups.push({ label: "Yöneticiler", options: mgrs });
  return groups;
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

export function announceAudienceLabel(row) {
  const n = (row?.employee_ids || []).length;
  if (!n) return "Tüm personel";
  return n === 1 ? "1 personel" : `${n} personel`;
}

export function announcementUnread(rows, selfId) {
  const me = String(selfId || "");
  return (rows || []).filter((a) => !(a.read_by || []).includes(me)).length;
}

export function peerPostBody(peer, extra) {
  const body = { ...(extra || {}) };
  if (!peer?.id) return body;
  if (peer.kind === "manager" && peer.id !== "_all") body.to_user_id = peer.id;
  if (peer.kind === "group") body.group_id = peer.id;
  if (peer.kind === "emp") body.employee_id = peer.id;
  return body;
}

const AVATAR_COLORS = ["#4F46E5", "#059669", "#D97706", "#0284C7", "#7C3AED", "#E11D48"];

export function chatInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] || "") : (parts[0][1] || "");
  return `${first}${last}`.toLocaleUpperCase("tr-TR");
}

export function chatAvatarColor(key) {
  const s = String(key || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function chatTimeLabel(value, now = Date.now()) {
  const t = Date.parse(String(value || ""));
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const yest = new Date(n);
  yest.setDate(n.getDate() - 1);
  if (d.getFullYear() === yest.getFullYear() && d.getMonth() === yest.getMonth() && d.getDate() === yest.getDate()) return "dün";
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

export function threadInOrder(rows) {
  return [...(rows || [])].sort((a, b) => (Date.parse(a.created_at || "") || 0) - (Date.parse(b.created_at || "") || 0));
}

export function isOwnMessage(m, selfId, mode) {
  if (!m) return false;
  const me = String(selfId || "");
  if (me && m.from_user_id && String(m.from_user_id) === me) return true;
  if (mode === "staff") return m.from_side === "staff";
  if (mode === "manager") return m.from_side === "manager";
  return false;
}

export function filterChatList(rows, query) {
  const q = String(query || "").trim().toLocaleLowerCase("tr-TR");
  if (!q) return rows || [];
  return (rows || []).filter((r) => {
    const name = String(r.name || "").toLocaleLowerCase("tr-TR");
    const preview = String(r.preview || "").toLocaleLowerCase("tr-TR");
    return name.includes(q) || preview.includes(q);
  });
}

function sortChatRows(rows) {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.at || "") || 0;
    const tb = Date.parse(b.at || "") || 0;
    if (tb !== ta) return tb - ta;
    const ua = Number(a.unread) || 0;
    const ub = Number(b.unread) || 0;
    if (ub !== ua) return ub - ua;
    return String(a.name || "").localeCompare(String(b.name || ""), "tr");
  });
}

export function buildChatList({
  managers,
  employees,
  groups,
  announcements,
  selfId,
  includeEmptyManagers = false,
  includeEmptyEmployees = false,
} = {}) {
  const rows = [];
  for (const r of managers || []) {
    const id = String(r.user_id || "");
    if (!id || id === "_all") continue;
    if (!includeEmptyManagers && !r.last && !r.unread) continue;
    rows.push({
      key: `m:${id}`,
      kind: "manager",
      id,
      name: r.name || "Yönetici",
      last: r.last || null,
      preview: messagePreview(r.last) || "Yeni yazışma",
      unread: Number(r.unread) || 0,
      at: r.last?.created_at || "",
    });
  }
  for (const r of employees || []) {
    const id = String(r.employee_id || "");
    if (!id) continue;
    if (!includeEmptyEmployees && !r.last && !r.unread) continue;
    rows.push({
      key: `e:${id}`,
      kind: "emp",
      id,
      name: r.employee_name || "Personel",
      last: r.last || null,
      preview: messagePreview(r.last) || "Yeni yazışma",
      unread: Number(r.unread) || 0,
      at: r.last?.created_at || "",
    });
  }
  for (const r of groups || []) {
    const id = String(r.group_id || r.id || "");
    if (!id) continue;
    rows.push({
      key: `g:${id}`,
      kind: "group",
      id,
      name: r.name || r.title || "Grup",
      last: r.last || null,
      preview: messagePreview(r.last) || "Grup yazışması",
      unread: Number(r.unread) || 0,
      at: r.last?.created_at || r.created_at || "",
    });
  }
  for (const a of announcements || []) {
    const id = String(a.id || "");
    if (!id) continue;
    rows.push({
      key: `a:${id}`,
      kind: "announce",
      id,
      name: a.title || "Duyuru",
      last: { body: a.body, created_at: a.created_at, from_name: a.from_name },
      preview: [a.from_name || "Yönetici", announceAudienceLabel(a), messagePreview(a)].filter(Boolean).join(" · "),
      unread: (a.read_by || []).includes(String(selfId || "")) ? 0 : 1,
      at: a.created_at || "",
    });
  }
  return sortChatRows(rows);
}

export function chatPeer(row) {
  if (!row?.id || row.kind === "announce") return null;
  return { kind: row.kind, id: row.id };
}

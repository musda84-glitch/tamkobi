export type StaffMessage = {
  id?: string;
  employee_id?: string;
  employee_name?: string;
  from_side?: "manager" | "staff" | string;
  from_user_id?: string;
  from_name?: string;
  to_user_id?: string;
  to_name?: string;
  group_id?: string;
  thread_kind?: string;
  body?: string;
  created_at?: string;
  read_at?: string | null;
};

export type StaffInboxRow = {
  employee_id: string;
  employee_name?: string;
  last?: StaffMessage | null;
  unread?: number;
};

export type StaffDirectoryEmp = {
  id?: string;
  full_name?: string;
  department?: string;
  position?: string;
};

export type StaffManager = {
  id?: string;
  name?: string;
  role?: string;
};

export type StaffGroup = {
  id?: string;
  title?: string;
  member_user_ids?: string[];
  member_employee_ids?: string[];
};

export type ManagerInboxRow = {
  kind?: "manager" | string;
  user_id: string;
  name?: string;
  last?: StaffMessage | null;
  unread?: number;
};

export type GroupInboxRow = {
  kind?: "group" | string;
  group_id: string;
  name?: string;
  last?: StaffMessage | null;
  unread?: number;
};

export type StaffAnnouncement = {
  id?: string;
  title?: string;
  body?: string;
  from_name?: string;
  employee_ids?: string[];
  created_at?: string;
  read_by?: string[];
};

export type StaffMessagesPayload = {
  mode?: "staff" | "manager" | "both" | "thread" | "group" | string;
  employee?: { id?: string; full_name?: string } | null;
  thread?: StaffMessage[];
  inbox?: StaffInboxRow[];
  directory?: StaffDirectoryEmp[];
  managers?: StaffManager[];
  manager_inbox?: ManagerInboxRow[];
  groups?: StaffGroup[];
  group_inbox?: GroupInboxRow[];
  group?: StaffGroup | null;
  announcements?: StaffAnnouncement[];
  to_user?: StaffManager | null;
  unread?: number;
  self_user_id?: string;
};

export type PeerKind = "emp" | "manager" | "group";
export type PeerRef = { kind: PeerKind; id: string };

export const MESSAGES_HIDDEN_KEY = "tamkobi.staff_messages.hidden";
export const MESSAGES_COLLAPSED_KEY = "tamkobi.staff_messages.collapsed";

export function parseHiddenFlag(raw?: string | null): boolean {
  return raw === "1" || raw === "true";
}

export function validateMessageBody(text?: string | null): string | null {
  if (!String(text || "").trim()) return "Mesaj yazın.";
  return null;
}

export function requireManagerId(managerId?: string | null, managers?: StaffManager[] | null): string | null {
  const real = (managers || []).filter((m) => m.id && m.id !== "_all");
  if (!real.length) return null;
  if (!String(managerId || "").trim()) return "Yönetici seçin.";
  return null;
}

export function unreadStaffMessages(rows: StaffMessage[] | null | undefined, reader: "staff" | "manager"): number {
  const want = reader === "staff" ? "manager" : "staff";
  return (rows || []).filter((m) => !m.read_at && m.from_side === want).length;
}

export function previewStaffMessages(rows: StaffMessage[] | null | undefined, limit = 4): StaffMessage[] {
  return (rows || []).slice(0, Math.max(0, limit));
}

export function inboxUnreadTotal<T extends { unread?: number }>(inbox?: T[] | null): number {
  return (inbox || []).reduce((s, r) => s + (Number(r.unread) || 0), 0);
}

export function messageAuthor(m: StaffMessage | null | undefined): string {
  if (!m) return "";
  if (m.from_side === "manager") return m.from_name || "Yönetici";
  return m.from_name || m.employee_name || "Personel";
}

export function messagePreview(m: StaffMessage | null | undefined): string {
  return String(m?.body || "").replace(/\s+/g, " ").trim();
}

function sortUnreadThenName<T extends { unread?: number; last?: unknown; name?: string; employee_name?: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ua = Number(a.unread) || 0;
    const ub = Number(b.unread) || 0;
    if (ub !== ua) return ub - ua;
    if (Boolean(b.last) !== Boolean(a.last)) return b.last ? 1 : -1;
    return String(a.name || a.employee_name || "").localeCompare(String(b.name || b.employee_name || ""), "tr");
  });
}

export function mergeInboxWithDirectory(
  inbox?: StaffInboxRow[] | null,
  directory?: StaffDirectoryEmp[] | null,
): StaffInboxRow[] {
  const by = new Map<string, StaffInboxRow>();
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

export function mergeManagerInbox(
  inbox?: ManagerInboxRow[] | null,
  managers?: StaffManager[] | null,
  selfId?: string | null,
): ManagerInboxRow[] {
  const skip = String(selfId || "");
  const by = new Map<string, ManagerInboxRow>();
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

export function employeeSelectGroups(directory?: StaffDirectoryEmp[] | null) {
  const opts = (directory || [])
    .filter((e) => e.id)
    .map((e) => ({
      value: String(e.id),
      label: [e.full_name, e.position || e.department].filter(Boolean).join(" · "),
    }));
  if (!opts.length) return [];
  return [{ label: "Personel", options: opts }];
}

export function managerSelectGroups(
  managers?: StaffManager[] | null,
  inbox?: ManagerInboxRow[] | null,
  selfId?: string | null,
) {
  const skip = String(selfId || "");
  const by = new Map<string, { value: string; label: string }>();
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

export function peerSelectGroups(
  directory?: StaffDirectoryEmp[] | null,
  managers?: StaffManager[] | null,
  selfId?: string | null,
  inbox?: ManagerInboxRow[] | null,
) {
  const groups: { label: string; options: { value: string; label: string }[] }[] = [];
  const emps = (directory || [])
    .filter((e) => e.id)
    .map((e) => ({
      value: `e:${e.id}`,
      label: [e.full_name, e.position || e.department].filter(Boolean).join(" · "),
    }));
  if (emps.length) groups.push({ label: "Personel", options: emps });
  const skip = String(selfId || "");
  const by = new Map<string, { value: string; label: string }>();
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

export function parsePeerValue(value?: string | null): PeerRef | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("m:")) return { kind: "manager", id: raw.slice(2) };
  if (raw.startsWith("g:")) return { kind: "group", id: raw.slice(2) };
  if (raw.startsWith("e:")) return { kind: "emp", id: raw.slice(2) };
  return { kind: "emp", id: raw };
}

export function peerQuery(peer: PeerRef | null | undefined): Record<string, string> {
  if (!peer?.id) return {};
  if (peer.kind === "manager") return { to_user_id: peer.id };
  if (peer.kind === "group") return { group_id: peer.id };
  return { employee_id: peer.id };
}

export function announceAudienceLabel(row?: { employee_ids?: string[] } | null): string {
  const n = (row?.employee_ids || []).length;
  if (!n) return "Tüm personel";
  return n === 1 ? "1 personel" : `${n} personel`;
}

export function announcementUnread(rows?: StaffAnnouncement[] | null, selfId?: string | null): number {
  const me = String(selfId || "");
  return (rows || []).filter((a) => !(a.read_by || []).includes(me)).length;
}

export function peerPostBody(peer: PeerRef | null | undefined, extra?: Record<string, unknown>): Record<string, unknown> {
  const body = { ...(extra || {}) };
  if (!peer?.id) return body;
  if (peer.kind === "manager" && peer.id !== "_all") body.to_user_id = peer.id;
  if (peer.kind === "group") body.group_id = peer.id;
  if (peer.kind === "emp") body.employee_id = peer.id;
  return body;
}

export type ChatKind = PeerKind | "announce";

export type ChatListRow = {
  key: string;
  kind: ChatKind;
  id: string;
  name: string;
  last?: StaffMessage | null;
  preview: string;
  unread: number;
  at: string;
};

const AVATAR_COLORS = ["#4F46E5", "#059669", "#D97706", "#0284C7", "#7C3AED", "#E11D48"];

export function chatInitials(name?: string | null): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] || "") : (parts[0][1] || "");
  return `${first}${last}`.toLocaleUpperCase("tr-TR");
}

export function chatAvatarColor(key?: string | null): string {
  const s = String(key || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function chatTimeLabel(value?: string | null, now: number = Date.now()): string {
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

export function threadInOrder(rows?: StaffMessage[] | null): StaffMessage[] {
  return [...(rows || [])].sort((a, b) => (Date.parse(a.created_at || "") || 0) - (Date.parse(b.created_at || "") || 0));
}

export function isOwnMessage(
  m?: StaffMessage | null,
  selfId?: string | null,
  mode?: string | null,
): boolean {
  if (!m) return false;
  const me = String(selfId || "");
  if (me && m.from_user_id && String(m.from_user_id) === me) return true;
  if (mode === "staff") return m.from_side === "staff";
  if (mode === "manager") return m.from_side === "manager";
  return false;
}

export function filterChatList(rows?: ChatListRow[] | null, query?: string | null): ChatListRow[] {
  const q = String(query || "").trim().toLocaleLowerCase("tr-TR");
  if (!q) return rows || [];
  return (rows || []).filter((r) => {
    const name = String(r.name || "").toLocaleLowerCase("tr-TR");
    const preview = String(r.preview || "").toLocaleLowerCase("tr-TR");
    return name.includes(q) || preview.includes(q);
  });
}

function sortChatRows(rows: ChatListRow[]): ChatListRow[] {
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

export function buildChatList(opts: {
  managers?: ManagerInboxRow[] | null;
  employees?: StaffInboxRow[] | null;
  groups?: Array<GroupInboxRow & { id?: string; title?: string; created_at?: string }> | null;
  announcements?: StaffAnnouncement[] | null;
  selfId?: string | null;
  includeEmptyManagers?: boolean;
  includeEmptyEmployees?: boolean;
}): ChatListRow[] {
  const rows: ChatListRow[] = [];
  for (const r of opts.managers || []) {
    const id = String(r.user_id || "");
    if (!id || id === "_all") continue;
    if (!opts.includeEmptyManagers && !r.last && !r.unread) continue;
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
  for (const r of opts.employees || []) {
    const id = String(r.employee_id || "");
    if (!id) continue;
    if (!opts.includeEmptyEmployees && !r.last && !r.unread) continue;
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
  for (const r of opts.groups || []) {
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
  for (const a of opts.announcements || []) {
    const id = String(a.id || "");
    if (!id) continue;
    rows.push({
      key: `a:${id}`,
      kind: "announce",
      id,
      name: a.title || "Duyuru",
      last: { body: a.body, created_at: a.created_at, from_name: a.from_name },
      preview: [a.from_name || "Yönetici", announceAudienceLabel(a), messagePreview(a)].filter(Boolean).join(" · "),
      unread: (a.read_by || []).includes(String(opts.selfId || "")) ? 0 : 1,
      at: a.created_at || "",
    });
  }
  return sortChatRows(rows);
}

export function chatPeer(row: Pick<ChatListRow, "kind" | "id">): PeerRef | null {
  if (row.kind === "announce" || !row.id) return null;
  return { kind: row.kind, id: row.id };
}

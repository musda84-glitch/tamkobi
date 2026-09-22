export type StaffMessage = {
  id?: string;
  employee_id?: string;
  employee_name?: string;
  from_side?: "manager" | "staff" | string;
  from_user_id?: string;
  from_name?: string;
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

export type StaffMessagesPayload = {
  mode?: "staff" | "manager" | "both" | "thread" | string;
  employee?: { id?: string; full_name?: string } | null;
  thread?: StaffMessage[];
  inbox?: StaffInboxRow[];
  directory?: StaffDirectoryEmp[];
  unread?: number;
};

export const MESSAGES_HIDDEN_KEY = "tamkobi.staff_messages.hidden";

export function parseHiddenFlag(raw?: string | null): boolean {
  return raw === "1" || raw === "true";
}

export function validateMessageBody(text?: string | null): string | null {
  if (!String(text || "").trim()) return "Mesaj yazın.";
  return null;
}

export function unreadStaffMessages(rows: StaffMessage[] | null | undefined, reader: "staff" | "manager"): number {
  const want = reader === "staff" ? "manager" : "staff";
  return (rows || []).filter((m) => !m.read_at && m.from_side === want).length;
}

export function previewStaffMessages(rows: StaffMessage[] | null | undefined, limit = 4): StaffMessage[] {
  return (rows || []).slice(0, Math.max(0, limit));
}

export function inboxUnreadTotal(inbox: StaffInboxRow[] | null | undefined): number {
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
  return [...by.values()].sort((a, b) => {
    const ua = Number(a.unread) || 0;
    const ub = Number(b.unread) || 0;
    if (ub !== ua) return ub - ua;
    if (Boolean(b.last) !== Boolean(a.last)) return b.last ? 1 : -1;
    return String(a.employee_name || "").localeCompare(String(b.employee_name || ""), "tr");
  });
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

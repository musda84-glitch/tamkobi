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

export type StaffMessagesPayload = {
  mode?: "staff" | "manager" | "both" | "thread" | string;
  employee?: { id?: string; full_name?: string } | null;
  thread?: StaffMessage[];
  inbox?: StaffInboxRow[];
  unread?: number;
};

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

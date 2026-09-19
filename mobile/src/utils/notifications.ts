import type { Ionicons } from "@expo/vector-icons";
import type { Notification, User } from "../types";
import { resolveMobilePath, type QuickTone } from "./quickMenu";

const TYPE_ROLES: Record<string, string[]> = {
  order_pick_missing: ["admin", "manager", "warehouse"],
  order_pick_production: ["admin", "manager", "warehouse", "production"],
  attendance_late: ["admin", "manager", "accountant"],
  attendance_missing: ["admin", "manager", "accountant"],
  attendance_dispute: ["admin", "manager", "accountant"],
  role_assigned: ["admin", "manager"],
  b2b_order: ["admin", "manager", "sales"],
  quote_response: ["admin", "manager", "sales"],
  cash_approval: ["admin", "manager", "accountant"],
};

export function rolesForType(type?: string | null): string[] {
  return TYPE_ROLES[String(type || "")] || ["admin"];
}

/** Ana ekranda kişi kendi rolüne veya kendisine atanan kayıtlara bakar. */
export function visibleNotifications(rows: Notification[] | null | undefined, user?: User | null): Notification[] {
  const list = rows || [];
  if (!user) return list;
  if (user.is_super_admin || user.role === "admin") return list;
  const mine = new Set([user.id, user.employee_id].filter(Boolean).map(String));
  const role = (user.role || "").toLowerCase();
  return list.filter((n) => {
    if (n.user_id && mine.has(String(n.user_id))) return true;
    if (n.employee_id && mine.has(String(n.employee_id))) return true;
    const roles = n.roles != null ? n.roles : rolesForType(n.type);
    return !!role && roles.includes(role);
  });
}

/** Ana ekranda gösterilen bildirim sayısı. */
export const NOTIFICATION_PREVIEW = 3;

export type NotificationLook = { icon: keyof typeof Ionicons.glyphMap; tone: QuickTone };

/** Türkçe büyük İ/I küçültmesi ICU'ya bağlı kalmasın. */
function lower(text: string): string {
  return text.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

export function unreadCount(rows: Notification[] | null | undefined): number {
  return (rows || []).filter((n) => !n.is_read).length;
}

/** Sunucu created_at'e göre sıralı döner; yine de güvenceye alıp en yenileri keseriz. */
export function latestNotifications(
  rows: Notification[] | null | undefined,
  limit = NOTIFICATION_PREVIEW
): Notification[] {
  const time = (n: Notification) => {
    const t = Date.parse(String(n.created_at || ""));
    return Number.isNaN(t) ? 0 : t;
  };
  return [...(rows || [])].sort((a, b) => time(b) - time(a)).slice(0, limit);
}

export function notificationText(n: Notification): string {
  return n.message || n.body || "";
}

export function notificationTitle(n: Notification): string {
  return n.title || n.type || "Bildirim";
}

/** Web bildirim çekmecesindeki onay/ret ayrımını ikon ve renge çevirir. */
export function notificationLook(n: Notification): NotificationLook {
  const text = lower(`${n.title || ""} ${notificationText(n)}`);
  if (/onayland|kabul edild|tamamland/.test(text)) return { icon: "checkmark-circle", tone: "emerald" };
  if (/reddedil|iptal|silin|eksik|başarısız/.test(text)) return { icon: "close-circle", tone: "rose" };
  const type = lower(String(n.type || ""));
  if (type.startsWith("b2b")) return { icon: "cart", tone: "sky" };
  if (type.startsWith("cash")) return { icon: "wallet", tone: "teal" };
  if (type.startsWith("quote")) return { icon: "create", tone: "amber" };
  if (type === "role_assigned") return { icon: "people", tone: "violet" };
  if (type === "task_assigned") return { icon: "briefcase", tone: "indigo" };
  if (type === "overtime_assigned") return { icon: "time", tone: "indigo" };
  if (type.startsWith("attendance") || type.startsWith("order_pick")) return { icon: "alert-circle", tone: "amber" };
  return { icon: "information-circle", tone: "indigo" };
}

const REF_ROUTES: Record<string, string> = {
  quote: "/quotes",
  survey: "/surveys",
  project: "/projects",
  order: "/orders",
  invoice: "/invoices",
  contact: "/contacts",
  cheque: "/cheques",
  cash_approval: "/banking",
  employee: "/personnel",
};

/** Web'deki link/ref_type yönlendirmesinin mobilde karşılığı olan rotası. */
export function notificationRoute(n: Notification): string | null {
  const link = String(n.link || "").trim();
  if (link) {
    const [path, query] = link.split("?");
    const mapped = resolveMobilePath(path);
    if (mapped) return query ? `${mapped}?${query}` : mapped;
  }
  return REF_ROUTES[lower(String(n.ref_type || ""))] || null;
}

/** Listede tarih yerine "3 sa" gibi kısa yaş bilgisi durur. */
export function notificationAge(value?: string | null, now: number = Date.now()): string {
  const t = Date.parse(String(value || ""));
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((now - t) / 60000);
  if (mins < 1) return "şimdi";
  if (mins < 60) return `${mins} dk`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} gn`;
  return `${Math.floor(days / 7)} hf`;
}

import type { Ionicons } from "@expo/vector-icons";
import type { Notification } from "../types";
import { resolveMobilePath, type QuickTone } from "./quickMenu";

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

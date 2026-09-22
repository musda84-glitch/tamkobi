import type { Notification } from "../types";
import { notificationText, notificationTitle } from "./notifications";

export const LOCAL_PUSH_REPLAY_LIMIT = 12;
export const LOCAL_PUSH_SEEN_LIMIT = 200;

export function notificationKey(n: { id?: string; _id?: string } | null | undefined): string {
  return String(n?.id || n?._id || "").trim();
}

export type LocalPushPlan = {
  alerts: Notification[];
  nextSeen: string[];
  seeded: boolean;
};

function newestFirst(rows: Notification[]): Notification[] {
  const time = (n: Notification) => {
    const t = Date.parse(String(n.created_at || ""));
    return Number.isNaN(t) ? 0 : t;
  };
  return [...rows].sort((a, b) => time(b) - time(a));
}

/** İlk açılışta okunmamışları telefona yansıt; sonra yalnız yeni gelenleri göster. */
export function planLocalPush(
  rows: Notification[] | null | undefined,
  seenIds: string[],
  seeded: boolean,
  limit = LOCAL_PUSH_REPLAY_LIMIT,
): LocalPushPlan {
  const unread = (rows || []).filter((n) => !n.is_read && notificationKey(n));
  const seen = new Set((seenIds || []).filter(Boolean));
  const ids = unread.map(notificationKey);
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  if (!seeded) {
    return {
      alerts: newestFirst(unread).slice(0, cap),
      nextSeen: [...new Set([...(seenIds || []), ...ids])].slice(-LOCAL_PUSH_SEEN_LIMIT),
      seeded: true,
    };
  }
  const alerts = newestFirst(unread.filter((n) => !seen.has(notificationKey(n)))).slice(0, cap);
  return {
    alerts,
    nextSeen: [...new Set([...(seenIds || []), ...ids])].slice(-LOCAL_PUSH_SEEN_LIMIT),
    seeded: true,
  };
}

export function localPushContent(n: Notification): {
  title: string;
  body: string;
  data: Record<string, string>;
} {
  return {
    title: notificationTitle(n),
    body: notificationText(n),
    data: {
      type: String(n.type || ""),
      link: String(n.link || ""),
      notification_id: notificationKey(n),
    },
  };
}

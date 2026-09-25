export const NOTIFY_SWIPE_W = 72;
export const NOTIFY_SWIPE_TAP = 8;

export function notificationCanDelete(note) {
  return Boolean(note?.is_read && (note.id || note._id));
}

export function notificationDeletePath(note) {
  const id = String(note?.id || note?._id || "").trim();
  if (!id || !notificationCanDelete(note)) return null;
  return `/notifications/${id}`;
}

/** Sola kaydırma: menü aç, kapat veya satırı tıkla. */
export function swipeDeleteOutcome(startX, dx, vx = 0, menuW = NOTIFY_SWIPE_W) {
  if (Math.abs(dx) < NOTIFY_SWIPE_TAP && Math.abs(vx) < 0.25) {
    return startX < -10 ? "close" : "press";
  }
  const next = startX + dx;
  if (next < -menuW / 2 || vx < -0.4) return "open";
  return "close";
}

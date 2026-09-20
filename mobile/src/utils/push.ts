import { resolveMobilePath } from "./quickMenu";

export const PUSH_CHANNEL = "tamkobi";

export function isExpoPushToken(token?: string | null): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(String(token || "").trim());
}

/** Push data.link → mobil rota; yoksa bildirim listesi. */
export function notificationHref(data?: Record<string, unknown> | null): string {
  const link = String(data?.link || "").trim();
  if (link) {
    const [path, query] = link.split("?");
    const mapped = resolveMobilePath(path);
    if (mapped) return query ? `${mapped}?${query}` : mapped;
    if (path.startsWith("/")) return link;
  }
  return "/notifications";
}

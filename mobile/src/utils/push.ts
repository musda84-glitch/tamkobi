import { resolveMobilePath } from "./quickMenu";

/** Android kanalı — ses değişince yeni id gerekir (eski kanal kilitlenir). */
export const PUSH_CHANNEL = "tamkobi_chime";
/** iOS / Expo payload dosya adı (plugin `sounds`). Android raw adı uzantısız. */
export const PUSH_SOUND = "tamkobi.wav";
export const PUSH_SOUND_ANDROID = "tamkobi";

export const IOS_PUSH_PERMISSION = {
  ios: { allowAlert: true, allowBadge: true, allowSound: true },
};

export function isExpoPushToken(token?: string | null): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(String(token || "").trim());
}

export function isPushPermissionGranted(perm?: { status?: string; granted?: boolean } | null): boolean {
  return perm?.status === "granted" || perm?.granted === true;
}

/** Native uygulamada açılışta sistem izin diyaloğu; web'de yok. */
export function shouldAskPushOnOpen(platform: string): boolean {
  return platform === "ios" || platform === "android";
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

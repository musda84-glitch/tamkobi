import { mobileTargetHref } from "./notifications";
import { can, type SessionUser } from "./permissions";
import { modulePathForHref, resolveMobilePath } from "./quickMenu";

type PushAudienceUser = (SessionUser & { id?: string; _id?: string }) | null | undefined;

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

/** Push data.link / target_route → mobil rota; yoksa bildirim listesi. */
export function notificationHref(data?: Record<string, unknown> | null): string {
  const targetRoute = String(data?.target_route || "").trim();
  if (targetRoute) {
    const mapped = mobileTargetHref(targetRoute);
    if (mapped) return mapped;
  }
  const link = String(data?.link || "").trim();
  if (link) {
    const [path, query] = link.split("?");
    const mapped = resolveMobilePath(path);
    if (mapped) return query ? `${mapped}?${query}` : mapped;
    if (path.startsWith("/")) return link;
  }
  return "/notifications";
}

function filledId(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

/** data.user_id / company_id doluysa oturumla eşleşmeli. Eski yüklerde alan yoksa geçer. */
function sameNotificationAudience(
  data: Record<string, unknown> | null | undefined,
  user: PushAudienceUser,
  companyId?: string | null,
): boolean {
  const targetUser = filledId(data?.user_id);
  if (targetUser) {
    const ids = [filledId(user?.id), filledId(user?._id)].filter(Boolean);
    if (!ids.includes(targetUser)) return false;
  }
  const targetCompany = filledId(data?.company_id);
  if (targetCompany && filledId(companyId) !== targetCompany) return false;
  return true;
}

/**
 * notificationHref sonucu, oturum kullanıcısı ve yetkisiyle süzülür.
 * Hedef kullanıcı/şirket uyuşmazsa null (navigate etme).
 * Yetki yoksa veya modül yolu çözülemezse "/notifications" (fail closed).
 * "/notifications" ve "/" her zaman serbest. Kullanıcı yoksa null.
 */
export function guardedNotificationHref(
  data: Record<string, unknown> | null | undefined,
  user: PushAudienceUser,
  companyId?: string | null,
): string | null {
  if (!user) return null;
  if (!sameNotificationAudience(data, user, companyId)) return null;
  const href = notificationHref(data);
  const pathname = href.split("?")[0];
  if (pathname === "/" || pathname === "/notifications") return href;
  const modulePath = modulePathForHref(href);
  if (!modulePath) return "/notifications";
  if (modulePath === "/" || modulePath === "/notifications") return href;
  if (!can(user, modulePath, "view")) return "/notifications";
  return href;
}

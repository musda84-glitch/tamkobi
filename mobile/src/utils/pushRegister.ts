import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { del, post, type ApiClient } from "../api/client";
import { IOS_PUSH_PERMISSION, isExpoPushToken, isPushPermissionGranted, PUSH_CHANNEL, PUSH_SOUND, PUSH_SOUND_ANDROID, shouldAskPushOnOpen } from "./push";
import { localPushContent, planLocalPush } from "./pushLocal";
import { getStableDeviceId } from "./punchAuth";
import type { Notification } from "../types";

const TOKEN_KEY = "tamkobi.pushToken";
const SEEN_KEY = "tamkobi.pushLocalSeen";
const SEEDED_KEY = "tamkobi.pushLocalSeeded";
export const PUSH_LAST_ERROR_KEY = "tamkobi_push_last_error";
export const FCM_PUSH_UNAVAILABLE = "Uzak bildirim yapılandırılmamış (FCM). Uygulama açıkken bildirimler çalışır.";

export type PushStatus = "idle" | "ok" | "denied" | "web" | "unavailable";
export type PushResult = { status: PushStatus; token?: string; error?: string };

export function classifyPushTokenError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Push token alınamadı.";
  const text = raw || "Push token alınamadı.";
  if (text.includes("FirebaseApp") || text.includes("FCM") || text.includes("SERVICE_NOT_AVAILABLE")) {
    return FCM_PUSH_UNAVAILABLE;
  }
  return text;
}

export function isFcmPushError(error?: string | null): boolean {
  const text = String(error || "");
  return text.includes("FirebaseApp") || text.includes("FCM") || text.includes("SERVICE_NOT_AVAILABLE");
}

export async function readPushLastError(): Promise<{ status: PushStatus; error: string } | null> {
  const raw = await AsyncStorage.getItem(PUSH_LAST_ERROR_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { status?: PushStatus; error?: string };
    const error = String(parsed?.error || "").trim();
    const status = (parsed?.status || "unavailable") as PushStatus;
    if (!error && status === "ok") return null;
    return { status, error };
  } catch {
    return { status: "unavailable", error: raw };
  }
}

async function persistPushResult(result: PushResult): Promise<void> {
  try {
    if (result.status === "ok") {
      await AsyncStorage.removeItem(PUSH_LAST_ERROR_KEY);
      return;
    }
    await AsyncStorage.setItem(PUSH_LAST_ERROR_KEY, JSON.stringify({
      status: result.status,
      error: result.error || "",
    }));
  } catch {
    /* depolama yoksa sonuç yine döner */
  }
}

function projectId(): string {
  try {
    const Constants = require("expo-constants").default as {
      expoConfig?: { extra?: { eas?: { projectId?: string } } };
      easConfig?: { projectId?: string };
    };
    return Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId || "";
  } catch {
    return "";
  }
}

async function nativeNotifications() {
  if (Platform.OS === "web") return null;
  try {
    return await import("expo-notifications");
  } catch {
    return null;
  }
}

export async function setAppIconBadge(count: number): Promise<void> {
  const Notifications = await nativeNotifications();
  if (!Notifications?.setBadgeCountAsync) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(Number(count) || 0)));
  } catch {
    /* web / izin yok */
  }
}

export async function enablePushHandler(): Promise<void> {
  const Notifications = await nativeNotifications();
  if (!Notifications?.setNotificationHandler) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldShowAlert: true,
    }),
  });
}

export async function getStoredPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function askPushPermission(): Promise<PushStatus> {
  if (!shouldAskPushOnOpen(Platform.OS)) return "web";
  const Notifications = await nativeNotifications();
  if (!Notifications) return "unavailable";
  try {
    if (Platform.OS === "android" && Notifications.setNotificationChannelAsync) {
      await Notifications.setNotificationChannelAsync(PUSH_CHANNEL, {
        name: "TamKobi",
        importance: Notifications.AndroidImportance?.HIGH ?? 4,
        vibrationPattern: [0, 180, 80, 180],
        lightColor: "#059669",
        sound: PUSH_SOUND_ANDROID,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    if (isPushPermissionGranted(existing)) return "ok";
    const asked = await Notifications.requestPermissionsAsync(IOS_PUSH_PERMISSION);
    return isPushPermissionGranted(asked) ? "ok" : "denied";
  } catch {
    return "unavailable";
  }
}

export async function requestPushToken(): Promise<PushResult> {
  const perm = await askPushPermission();
  if (perm !== "ok") return { status: perm };
  const Notifications = await nativeNotifications();
  if (!Notifications) return { status: "unavailable", error: "Bildirim modülü yok." };
  try {
    const Device = await import("expo-device");
    if (Device.isDevice === false) {
      return { status: "unavailable", error: "Emülatörde uzak bildirim yok." };
    }
    const pid = projectId();
    const tokenRes = pid
      ? await Notifications.getExpoPushTokenAsync({ projectId: pid })
      : await Notifications.getExpoPushTokenAsync();
    const token = String(tokenRes?.data || "");
    if (!isExpoPushToken(token)) return { status: "unavailable", error: "Push token alınamadı." };
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return { status: "ok", token };
  } catch (err) {
    return { status: "unavailable", error: classifyPushTokenError(err) };
  }
}

export async function registerDevicePush(client: ApiClient): Promise<PushResult> {
  const got = await requestPushToken();
  if (got.status !== "ok" || !got.token) {
    await persistPushResult(got);
    return got;
  }
  try {
    const deviceId = await getStableDeviceId();
    await post(client, "/notifications/push-token", {
      token: got.token,
      platform: Platform.OS,
      device_id: deviceId,
    });
    await persistPushResult(got);
    return got;
  } catch (err) {
    const failed: PushResult = {
      status: "unavailable",
      token: got.token,
      error: err instanceof Error ? err.message : "Token sunucuya yazılamadı.",
    };
    await persistPushResult(failed);
    return failed;
  }
}

export async function loadLocalPushState(): Promise<{ seen: string[]; seeded: boolean }> {
  const [raw, seeded] = await Promise.all([
    AsyncStorage.getItem(SEEN_KEY),
    AsyncStorage.getItem(SEEDED_KEY),
  ]);
  let seen: string[] = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) seen = parsed.map((x) => String(x || "")).filter(Boolean);
  } catch {
    seen = [];
  }
  return { seen, seeded: seeded === "1" };
}

export async function saveLocalPushState(seen: string[], seeded: boolean): Promise<void> {
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  if (seeded) await AsyncStorage.setItem(SEEDED_KEY, "1");
}

export async function presentLocalNotification(note: {
  title: string;
  body?: string;
  data?: Record<string, string>;
}): Promise<boolean> {
  const perm = await askPushPermission();
  if (perm !== "ok") return false;
  const Notifications = await nativeNotifications();
  if (!Notifications?.scheduleNotificationAsync) return false;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: note.title || "TamKobi",
        body: note.body || "",
        sound: PUSH_SOUND,
        data: note.data || {},
        ...(Platform.OS === "android" ? { channelId: PUSH_CHANNEL } : {}),
      },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}

export async function presentLocalForNotes(notes: Notification[]): Promise<number> {
  let shown = 0;
  for (const note of notes) {
    const content = localPushContent(note);
    if (await presentLocalNotification(content)) shown += 1;
  }
  return shown;
}

export async function syncLocalPhoneAlerts(rows: Notification[] | null | undefined): Promise<number> {
  const state = await loadLocalPushState();
  const plan = planLocalPush(rows, state.seen, state.seeded);
  const shown = await presentLocalForNotes(plan.alerts);
  await saveLocalPushState(plan.nextSeen, plan.seeded);
  return shown;
}

export async function unregisterDevicePush(client: ApiClient): Promise<void> {
  const token = await getStoredPushToken();
  if (!token) return;
  try {
    await post(client, "/notifications/push-token/unregister", { token });
  } catch {
    try {
      await del(client, "/notifications/push-token", { token });
    } catch {
      /* çıkış yine de devam eder */
    }
  }
  await AsyncStorage.removeItem(TOKEN_KEY);
}

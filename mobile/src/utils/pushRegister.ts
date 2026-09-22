import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { del, post, type ApiClient } from "../api/client";
import { IOS_PUSH_PERMISSION, isExpoPushToken, isPushPermissionGranted, PUSH_CHANNEL, shouldAskPushOnOpen } from "./push";
import { localPushContent, planLocalPush } from "./pushLocal";
import type { Notification } from "../types";

const TOKEN_KEY = "tamkobi.pushToken";
const SEEN_KEY = "tamkobi.pushLocalSeen";
const SEEDED_KEY = "tamkobi.pushLocalSeeded";

export type PushStatus = "idle" | "ok" | "denied" | "web" | "unavailable";
export type PushResult = { status: PushStatus; token?: string; error?: string };

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
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#059669",
        sound: "default",
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
    return { status: "unavailable", error: err instanceof Error ? err.message : "Push token alınamadı." };
  }
}

export async function registerDevicePush(client: ApiClient): Promise<PushResult> {
  const got = await requestPushToken();
  if (got.status !== "ok" || !got.token) return got;
  try {
    const Device = await import("expo-device");
    await post(client, "/notifications/push-token", {
      token: got.token,
      platform: Platform.OS,
      device_id: Device.modelName || Device.osInternalBuildId || Device.osName || "",
    });
    return got;
  } catch (err) {
    return {
      status: "unavailable",
      token: got.token,
      error: err instanceof Error ? err.message : "Token sunucuya yazılamadı.",
    };
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
        sound: "default",
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

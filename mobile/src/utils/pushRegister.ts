import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { del, post, type ApiClient } from "../api/client";
import { isExpoPushToken, PUSH_CHANNEL } from "./push";

const TOKEN_KEY = "tamkobi.pushToken";

export type PushStatus = "idle" | "ok" | "denied" | "web" | "unavailable";

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

export async function requestPushToken(): Promise<{ status: PushStatus; token?: string }> {
  if (Platform.OS === "web") return { status: "web" };
  const Notifications = await nativeNotifications();
  if (!Notifications) return { status: "unavailable" };
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
    let granted = existing.status === "granted" || existing.granted === true;
    if (!granted) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.status === "granted" || asked.granted === true;
    }
    if (!granted) return { status: "denied" };
    const pid = projectId();
    const tokenRes = pid
      ? await Notifications.getExpoPushTokenAsync({ projectId: pid })
      : await Notifications.getExpoPushTokenAsync();
    const token = String(tokenRes?.data || "");
    if (!isExpoPushToken(token)) return { status: "unavailable" };
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return { status: "ok", token };
  } catch {
    return { status: "unavailable" };
  }
}

export async function registerDevicePush(client: ApiClient): Promise<{ status: PushStatus; token?: string }> {
  const got = await requestPushToken();
  if (got.status !== "ok" || !got.token) return got;
  try {
    const Device = await import("expo-device");
    await post(client, "/notifications/push-token", {
      token: got.token,
      platform: Platform.OS,
      device_id: Device.modelName || Device.osInternalBuildId || Device.osName || "",
    });
  } catch {
    /* token cihazda durur; sonraki açılışta tekrar dener */
  }
  return got;
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

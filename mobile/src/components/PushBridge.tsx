import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { goHref } from "../nav";
import { notificationHref } from "../utils/push";
import { enablePushHandler, registerDevicePush } from "../utils/pushRegister";

/** Girişli oturumda Expo token kaydı + bildirime dokununca ilgili ekranı açar. */
export function PushBridge() {
  const { client, user, token, sessionKind } = useAuth();
  const lastId = useRef("");

  useEffect(() => {
    enablePushHandler().catch(() => { /* native yoksa sessiz */ });
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" || sessionKind === "b2b" || !user || !token) return;
    registerDevicePush(client).catch(() => { /* izin / emülatör */ });

    let remove = () => { /* no-op */ };
    (async () => {
      try {
        const Notifications = await import("expo-notifications");
        const open = (response: { notification?: { request?: { identifier?: string; content?: { data?: Record<string, unknown> } } } } | null) => {
          const id = String(response?.notification?.request?.identifier || "");
          const data = response?.notification?.request?.content?.data;
          if (!data) return;
          if (id && lastId.current === id) return;
          if (id) lastId.current = id;
          goHref(notificationHref(data));
        };
        const sub = Notifications.addNotificationResponseReceivedListener(open);
        const last = await Notifications.getLastNotificationResponseAsync();
        open(last);
        remove = () => sub.remove();
      } catch {
        /* web / tests */
      }
    })();
    return () => remove();
  }, [client, sessionKind, token, user]);

  return null;
}

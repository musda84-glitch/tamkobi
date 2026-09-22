import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { get } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useBadges } from "../auth/BadgeContext";
import { goHref } from "../nav";
import type { Notification } from "../types";
import { visibleNotifications } from "../utils/notifications";
import { notificationHref } from "../utils/push";
import { askPushPermission, enablePushHandler, registerDevicePush, syncLocalPhoneAlerts } from "../utils/pushRegister";

const POLL_MS = 30000;

/** Açılışta izin, okunmamışları telefona yansıt, uzak token dene; dokununca ilgili ekranı aç. */
export function PushBridge() {
  const { client, user, token, sessionKind, companyId } = useAuth();
  const { refresh } = useBadges();
  const lastId = useRef("");

  useEffect(() => {
    (async () => {
      await enablePushHandler();
      await askPushPermission();
    })().catch(() => { /* web / native yoksa sessiz */ });
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" || sessionKind === "b2b" || !user || !token || !companyId) return;
    registerDevicePush(client).catch(() => { /* FCM yoksa yerel kanal çalışır */ });

    let cancelled = false;
    const pullPhoneAlerts = async () => {
      try {
        const list = await get<Notification[]>(client, "/notifications", { company_id: companyId });
        if (cancelled) return;
        await syncLocalPhoneAlerts(visibleNotifications(list || [], user));
      } catch {
        /* çevrimdışı */
      }
    };
    pullPhoneAlerts();
    const timer = setInterval(pullPhoneAlerts, POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") pullPhoneAlerts();
    });

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
        const tap = Notifications.addNotificationResponseReceivedListener(open);
        const received = Notifications.addNotificationReceivedListener(() => {
          refresh();
        });
        const last = await Notifications.getLastNotificationResponseAsync();
        open(last);
        remove = () => {
          tap.remove();
          received.remove();
        };
      } catch {
        /* web / tests */
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
      remove();
    };
  }, [client, companyId, refresh, sessionKind, token, user]);

  return null;
}

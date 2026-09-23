import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { get } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useBadges } from "../auth/BadgeContext";
import { goHref } from "../nav";
import type { Notification } from "../types";
import { notifySoundPlan, playTamkobiNotify, unlockTamkobiNotify } from "../utils/notifySound";
import { visibleNotifications } from "../utils/notifications";
import { notificationHref } from "../utils/push";
import { askPushPermission, enablePushHandler, registerDevicePush, syncLocalPhoneAlerts } from "../utils/pushRegister";

const POLL_MS = 30000;

function unreadNotifyIds(list: Notification[] | null | undefined, user: Parameters<typeof visibleNotifications>[1]): string[] {
  return visibleNotifications(list || [], user)
    .filter((n) => !n.is_read)
    .map((n) => String(n.id || n._id || ""))
    .filter(Boolean);
}

/** Açılışta izin, okunmamışları telefona yansıt, uzak token dene; dokununca ilgili ekranı aç. */
export function PushBridge() {
  const { client, user, token, sessionKind, companyId } = useAuth();
  const { refresh } = useBadges();
  const lastId = useRef("");
  const webSound = useRef({ seen: [] as string[], seeded: false });

  useEffect(() => {
    (async () => {
      await enablePushHandler();
      await askPushPermission();
    })().catch(() => { /* web / native yoksa sessiz */ });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const unlock = () => unlockTamkobiNotify();
    document.addEventListener("pointerdown", unlock, { once: true });
    return () => document.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (sessionKind === "b2b" || !user || !token || !companyId) return;

    if (Platform.OS === "web") {
      let cancelled = false;
      const pullWebChime = async () => {
        try {
          const list = await get<Notification[]>(client, "/notifications", { company_id: companyId });
          if (cancelled) return;
          const plan = notifySoundPlan(webSound.current.seen, unreadNotifyIds(list, user), webSound.current.seeded);
          webSound.current = { seen: plan.seen, seeded: plan.seeded };
          if (plan.play) playTamkobiNotify();
        } catch {
          /* çevrimdışı */
        }
      };
      pullWebChime();
      const timer = setInterval(pullWebChime, POLL_MS);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }
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

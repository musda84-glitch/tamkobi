import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { useBadges } from "../auth/BadgeContext";
import { Empty, ErrorBanner, ListRow, Screen } from "../components/kit";
import { goHref } from "../nav";
import type { Notification } from "../types";
import { fmtDate, idOf } from "../utils/money";
import { notificationLook, notificationRoute, notificationText, notificationTitle, visibleNotifications } from "../utils/notifications";
import { QUICK_TONE_COLORS } from "../utils/quickMenu";

export function NotificationsScreen() {
  const { client, companyId, user } = useAuth();
  const { refresh: refreshBadges } = useBadges();
  const [rows, setRows] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await get<Notification[]>(client, "/notifications", { company_id: companyId });
      setRows(visibleNotifications(data || [], user));
      setError(null);
      refreshBadges();
    } catch (err) {
      setError(apiErrorMessage(err, "Bildirimler yüklenemedi."));
    }
  }, [client, companyId, refreshBadges, user]);

  useEffect(() => { load(); }, [load]);

  const open = (n: Notification) => {
    const id = idOf(n);
    if (id && !n.is_read) {
      setRows((prev) => prev.map((x) => (idOf(x) === id ? { ...x, is_read: true } : x)));
      post(client, `/notifications/${id}/read`, {}).then(() => refreshBadges()).catch(() => { /* okundu işareti kritik değil */ });
    }
    const route = notificationRoute(n);
    if (route) goHref(route);
  };

  return (
    <Screen onRefresh={load}>
      <ErrorBanner message={error} />
      {!rows.length ? <Empty icon="notifications-outline" title="Bildirim yok" /> : rows.map((n) => {
        const look = notificationLook(n);
        return (
          <ListRow
            key={idOf(n)}
            title={notificationTitle(n)}
            subtitle={`${notificationText(n)} · ${fmtDate(n.created_at)}`}
            right={n.is_read ? "" : "Yeni"}
            leading={<Ionicons name={look.icon} size={20} color={QUICK_TONE_COLORS[look.tone].solid} />}
            onPress={() => open(n)}
          />
        );
      })}
    </Screen>
  );
}

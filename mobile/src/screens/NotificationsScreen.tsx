import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { useBadges } from "../auth/BadgeContext";
import { Empty, ErrorBanner, ListRow, Screen } from "../components/kit";
import { SwipeRevealRow } from "../components/SwipeRevealRow";
import { goHref } from "../nav";
import type { Notification } from "../types";
import { fmtDate, idOf } from "../utils/money";
import {
  notificationCanDelete,
  notificationDeletePath,
  notificationLook,
  notificationRoute,
  notificationText,
  notificationTitle,
  visibleNotifications,
} from "../utils/notifications";
import { QUICK_TONE_COLORS } from "../utils/quickMenu";

export function NotificationsScreen() {
  const { client, companyId, user } = useAuth();
  const { refresh: refreshBadges } = useBadges();
  const [rows, setRows] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

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

  const remove = async (n: Notification) => {
    const path = notificationDeletePath(n);
    if (!path) return;
    const id = idOf(n);
    setRows((prev) => prev.filter((x) => idOf(x) !== id));
    setOpenRow(null);
    try {
      await del(client, path);
      setError(null);
      refreshBadges();
    } catch (err) {
      setError(apiErrorMessage(err, "Bildirim silinemedi."));
      await load();
    }
  };

  return (
    <Screen onRefresh={load}>
      <ErrorBanner message={error} />
      {!rows.length ? <Empty icon="notifications-outline" title="Bildirim yok" /> : rows.map((n) => {
        const look = notificationLook(n);
        const key = idOf(n) || n.created_at || notificationTitle(n);
        const row = (
          <ListRow
            title={notificationTitle(n)}
            subtitle={`${notificationText(n)} · ${fmtDate(n.created_at)}`}
            right={n.is_read ? "" : "Yeni"}
            leading={<Ionicons name={look.icon} size={20} color={QUICK_TONE_COLORS[look.tone].solid} />}
            onPress={notificationCanDelete(n) ? undefined : () => open(n)}
          />
        );
        if (!notificationCanDelete(n)) {
          return <React.Fragment key={key}>{row}</React.Fragment>;
        }
        return (
          <SwipeRevealRow
            key={key}
            rowKey={key}
            openKey={openRow}
            onOpen={setOpenRow}
            onPress={() => open(n)}
            onDelete={() => { void remove(n); }}
            testID={`notification-row-${idOf(n)}`}
          >
            {row}
          </SwipeRevealRow>
        );
      })}
    </Screen>
  );
}

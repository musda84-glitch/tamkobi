import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { useBadges } from "../auth/BadgeContext";
import { Empty, ErrorBanner, ListRow, Screen } from "../components/kit";
import { SwipeRevealRow } from "../components/SwipeRevealRow";
import { goHref } from "../nav";
import { colors } from "../theme";
import type { Notification } from "../types";
import { requestConfirm } from "../utils/confirmDialog";
import { fmtDate, idOf } from "../utils/money";
import {
  NOTIFICATIONS_CLEAR_PATH,
  notificationCanDelete,
  notificationClearableCount,
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
  const [clearing, setClearing] = useState(false);

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

  const clearAll = async () => {
    if (!companyId || !notificationClearableCount(rows) || clearing) return;
    const ok = await requestConfirm(
      "Tümünü sil",
      "Listedeki tüm bildirimler silinecek. Bu işlem geri alınamaz.",
      "Tümünü sil",
    );
    if (!ok) return;
    setClearing(true);
    const prev = rows;
    setRows([]);
    setOpenRow(null);
    try {
      await post(client, NOTIFICATIONS_CLEAR_PATH, {}, { company_id: companyId });
      setError(null);
      refreshBadges();
    } catch (err) {
      setRows(prev);
      setError(apiErrorMessage(err, "Bildirimler silinemedi."));
    } finally {
      setClearing(false);
    }
  };

  return (
    <Screen onRefresh={load}>
      <ErrorBanner message={error} />
      {rows.length ? (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 4 }}>
          <Pressable
            testID="notifications-clear-all"
            onPress={() => { void clearAll(); }}
            disabled={clearing}
            style={({ pressed }) => ({
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.danger,
              backgroundColor: "#fff",
              opacity: clearing ? 0.5 : pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.danger, fontSize: 11, fontWeight: "800" }}>
              {clearing ? "Siliniyor…" : "Tümünü sil"}
            </Text>
          </Pressable>
        </View>
      ) : null}
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

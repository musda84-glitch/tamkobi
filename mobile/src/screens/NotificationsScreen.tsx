import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
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
  MISSING_RECORD,
  NOTIFICATIONS_CLEAR_PATH,
  NOTIFICATIONS_READ_ALL_PATH,
  notificationCanDelete,
  notificationClearableCount,
  notificationDeletePath,
  notificationLook,
  notificationOpenPlan,
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

  const open = async (n: Notification) => {
    const id = idOf(n);
    if (id && !n.is_read) {
      setRows((prev) => prev.map((x) => (idOf(x) === id ? { ...x, is_read: true } : x)));
      post(client, `/notifications/${id}/read`, {}).then(() => refreshBadges()).catch(() => { /* okundu işareti kritik değil */ });
    }
    let plan = notificationOpenPlan(null, n);
    if (id) {
      try {
        const res = await get<{ exists?: boolean; target?: { route?: string } }>(client, `/notifications/${id}/target`);
        plan = notificationOpenPlan(res, n);
      } catch {
        /* yerel rota */
      }
    }
    if (plan.missing) {
      Alert.alert(MISSING_RECORD);
      return;
    }
    const route = plan.href || notificationRoute(n);
    if (route) goHref(route);
  };

  const markAllRead = async () => {
    if (!rows.some((n) => !n.is_read)) return;
    setRows((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await post(client, NOTIFICATIONS_READ_ALL_PATH, {}, { company_id: companyId });
      refreshBadges();
    } catch (err) {
      setError(apiErrorMessage(err, "Bildirimler okundu işaretlenemedi."));
      await load();
    }
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
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginBottom: 4 }}>
          <Pressable
            testID="notifications-read-all"
            onPress={() => { void markAllRead(); }}
            style={({ pressed }) => ({
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.primary,
              backgroundColor: "#fff",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "800" }}>Tümünü okundu işaretle</Text>
          </Pressable>
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
            right={n.is_read ? "Okundu" : "Yeni"}
            rightColor={n.is_read ? colors.muted : colors.danger}
            leading={<Ionicons name={look.icon} size={20} color={QUICK_TONE_COLORS[look.tone].solid} />}
            onPress={notificationCanDelete(n) ? undefined : () => open(n)}
          />
        );
        if (!notificationCanDelete(n)) {
          const posPending = n.ref_type === "pos_approval" && n.ref_id && !n.is_read;
          return (
            <React.Fragment key={key}>
              {row}
              {posPending ? (
                <View style={{ flexDirection: "row", gap: 8, marginTop: -4, marginBottom: 8, paddingHorizontal: 4 }}>
                  <Pressable
                    testID={`pos-notify-approve-${n.ref_id}`}
                    onPress={() => {
                      void post(client, `/pos/approvals/${n.ref_id}/approve`, {}).then(() => load()).catch(() => {});
                    }}
                    style={{ backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 }}
                  >
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>Onayla</Text>
                  </Pressable>
                  <Pressable
                    testID={`pos-notify-reject-${n.ref_id}`}
                    onPress={() => {
                      void post(client, `/pos/approvals/${n.ref_id}/reject`, {}).then(() => load()).catch(() => {});
                    }}
                    style={{ backgroundColor: colors.danger, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 }}
                  >
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>Reddet</Text>
                  </Pressable>
                </View>
              ) : null}
            </React.Fragment>
          );
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

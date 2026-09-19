import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles, type ActionTile } from "../components/ActionTiles";
import { Badge, Card, ErrorBanner, Muted, Row, Screen, StatRows } from "../components/kit";
import { NotificationsPanel } from "../components/NotificationsPanel";
import { goHref } from "../nav";
import { colors } from "../theme";
import type { DashboardStats, Notification, Overview } from "../types";
import { monthlySalesRow, netProfitRow } from "../utils/dashboard";
import { fmtMoney, idOf } from "../utils/money";
import { latestNotifications, notificationRoute, unreadCount, visibleNotifications } from "../utils/notifications";
import { resolveMobilePath, splitNotificationsTile, visibleQuickTiles } from "../utils/quickMenu";

export function HomeScreen() {
  const { client, companyId, user, license } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [notes, setNotes] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { tiles, notifications } = useMemo(
    () => splitNotificationsTile(visibleQuickTiles(user, license)),
    [user, license]
  );

  const quickItems: ActionTile[] = useMemo(
    () => tiles.map((tile) => ({
      key: tile.id,
      label: tile.label,
      icon: tile.icon as ActionTile["icon"],
      tone: tile.tone,
      testID: `home-quick-${tile.id}`,
      onPress: () => goHref(tile.href),
    })),
    [tiles]
  );

  const load = useCallback(async () => {
    if (!companyId) return;
    setRefreshing(true);
    try {
      const [ov, list, st] = await Promise.all([
        get<Overview>(client, "/dashboard/overview", { company_id: companyId }),
        get<Notification[]>(client, "/notifications", { company_id: companyId }).catch(() => []),
        get<DashboardStats>(client, "/dashboard/stats", { company_id: companyId }).catch(() => null),
      ]);
      setOverview(ov);
      setNotes(visibleNotifications(list || [], user));
      setStats(st);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Özet yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, user]);

  useEffect(() => { load(); }, [load]);

  const openNotification = useCallback((n: Notification) => {
    const id = idOf(n);
    if (id && !n.is_read) {
      setNotes((prev) => prev.map((x) => (idOf(x) === id ? { ...x, is_read: true } : x)));
      post(client, `/notifications/${id}/read`, {}).catch(() => { /* okundu işareti kritik değil */ });
    }
    goHref(notificationRoute(n) || "/notifications");
  }, [client]);

  const profitRow = netProfitRow(stats);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <ErrorBanner message={error} />

      <View testID="home-quick-menu">
        <ActionTiles size="md" items={quickItems} />
        {notifications ? (
          <View style={{ marginTop: 4 }}>
            <NotificationsPanel
              items={latestNotifications(notes)}
              unread={unreadCount(notes)}
              onOpenAll={() => goHref(notifications.href)}
              onOpenItem={openNotification}
            />
          </View>
        ) : null}
      </View>

      <StatRows
        testID="home-summary"
        items={[
          { key: "sales", ...monthlySalesRow(stats, overview) },
          ...(profitRow ? [{ key: "profit", ...profitRow, valueColor: (stats?.net_profit ?? 0) < 0 ? colors.danger : colors.primaryHover }] : []),
          { key: "collections", label: "Tahsilat", value: fmtMoney(overview?.collections.total), hint: `Gecikmiş ${fmtMoney(overview?.collections.overdue)}` },
          { key: "payments", label: "Ödeme", value: fmtMoney(overview?.payments.total), hint: `Gecikmiş ${fmtMoney(overview?.payments.overdue)}` },
          { key: "vat", label: "KDV ödenecek", value: fmtMoney(overview?.vat.payable), hint: `${overview?.vat.days_left ?? "—"} gün` },
        ]}
      />
      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>Bugünkü işler</Text>
        {!overview?.tasks?.length ? <Muted>Bekleyen görev yok.</Muted> : overview.tasks.map((t) => {
          const href = resolveMobilePath(t.path);
          const row = (
            <Row style={{ justifyContent: "space-between", paddingVertical: 6 }}>
              <Text style={{ color: colors.text, flex: 1 }}>{t.label}{t.extra ? ` · ${t.extra}` : ""}</Text>
              <Badge label={String(t.count)} tone={t.count ? "amber" : "slate"} />
            </Row>
          );
          if (!href) return <View key={t.key}>{row}</View>;
          return (
            <Pressable key={t.key} onPress={() => goHref(href)} testID={`home-task-${t.key}`}>
              {row}
            </Pressable>
          );
        })}
      </Card>
    </Screen>
  );
}

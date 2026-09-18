import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles, type ActionTile } from "../components/ActionTiles";
import { Badge, Card, ErrorBanner, H1, Muted, Row, Screen, StatRows } from "../components/kit";
import { go, goHref } from "../nav";
import { colors } from "../theme";
import type { Notification, Overview } from "../types";
import { fmtMoney } from "../utils/money";
import { resolveMobilePath, visibleQuickTiles } from "../utils/quickMenu";

export function HomeScreen() {
  const { client, companyId, user, activeCompany, license } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const tiles = useMemo(
    () => visibleQuickTiles(user, license),
    [user, license]
  );

  const quickItems: ActionTile[] = useMemo(
    () => tiles.map((tile) => ({
      key: tile.id,
      label: tile.label,
      icon: tile.icon as ActionTile["icon"],
      tone: tile.tone,
      testID: `home-quick-${tile.id}`,
      badge: tile.id === "notifications" && unread ? String(unread) : undefined,
      onPress: () => goHref(tile.href),
    })),
    [tiles, unread]
  );

  const load = useCallback(async () => {
    if (!companyId) return;
    setRefreshing(true);
    try {
      const [ov, notes] = await Promise.all([
        get<Overview>(client, "/dashboard/overview", { company_id: companyId }),
        get<Notification[]>(client, "/notifications", { company_id: companyId, unread_only: true }),
      ]);
      setOverview(ov);
      setUnread((notes || []).length);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Özet yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <Row style={{ justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <H1>Merhaba{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</H1>
          <Muted>{activeCompany?.name || "TamKobi"}</Muted>
        </View>
        <Pressable onPress={() => go("Search")} style={{ padding: 8 }} testID="home-search">
          <Ionicons name="search" size={22} color={colors.text} />
        </Pressable>
        <Pressable onPress={() => go("Notifications")} style={{ padding: 8 }} testID="home-bell">
          <Ionicons name="notifications" size={22} color={colors.text} />
          {unread ? <Badge label={String(unread)} tone="red" /> : null}
        </Pressable>
      </Row>
      <ErrorBanner message={error} />

      <View testID="home-quick-menu">
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 16, marginBottom: 4 }}>Hızlı menü</Text>
        <Muted>Modüllere ve sık kullanılan işlemlere tek dokunuş.</Muted>
        <View style={{ marginTop: 8 }}>
          <ActionTiles size="md" items={quickItems} />
        </View>
      </View>

      <StatRows
        testID="home-summary"
        items={[
          { key: "collections", label: "Tahsilat", value: fmtMoney(overview?.collections.total), hint: `Gecikmiş ${fmtMoney(overview?.collections.overdue)}` },
          { key: "payments", label: "Ödeme", value: fmtMoney(overview?.payments.total), hint: `Gecikmiş ${fmtMoney(overview?.payments.overdue)}` },
          { key: "sales", label: "Bu ay satış", value: String(overview?.invoices.outgoing.month ?? "—"), hint: "Fatura adedi" },
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

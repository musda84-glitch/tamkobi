import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Badge, Card, ErrorBanner, H1, Kpi, Muted, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import type { Notification, Overview } from "../types";
import { fmtMoney } from "../utils/money";

export function HomeScreen() {
  const { client, companyId, user, activeCompany } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
      <Row>
        <Kpi label="Tahsilat" value={fmtMoney(overview?.collections.total)} sub={`Gecikmiş ${fmtMoney(overview?.collections.overdue)}`} />
        <Kpi label="Ödeme" value={fmtMoney(overview?.payments.total)} sub={`Gecikmiş ${fmtMoney(overview?.payments.overdue)}`} />
      </Row>
      <Row>
        <Kpi label="Bu ay satış" value={String(overview?.invoices.outgoing.month ?? "—")} sub="Fatura adedi" />
        <Kpi label="KDV ödenecek" value={fmtMoney(overview?.vat.payable)} sub={`${overview?.vat.days_left ?? "—"} gün`} />
      </Row>
      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>Bugünkü işler</Text>
        {!overview?.tasks?.length ? <Muted>Bekleyen görev yok.</Muted> : overview.tasks.map((t) => (
          <Row key={t.key} style={{ justifyContent: "space-between", paddingVertical: 6 }}>
            <Text style={{ color: colors.text, flex: 1 }}>{t.label}{t.extra ? ` · ${t.extra}` : ""}</Text>
            <Badge label={String(t.count)} tone={t.count ? "amber" : "slate"} />
          </Row>
        ))}
      </Card>
    </Screen>
  );
}

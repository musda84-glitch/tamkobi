import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { Badge, Card, Empty, ErrorBanner, Field, Muted, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { fmtDate, idOf } from "../utils/money";
import { pickPercent, pickStatusTone, pickStatusTr, pickSummaryText, type PickRow } from "../utils/orderPick";

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <View style={{ height: 6, borderRadius: 999, backgroundColor: colors.slate100, overflow: "hidden" }}>
      <View style={{ width: `${percent}%`, height: "100%", backgroundColor: percent >= 100 ? colors.primary : colors.indigo }} />
    </View>
  );
}

export function SevkScreen() {
  const { client, companyId } = useAuth();
  const [rows, setRows] = useState<PickRow[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<PickRow[]>(client, "/order-picks", { company_id: companyId });
      setRows(data || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Sevkiyat listesi yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.order_number, r.customer_name, r.city].some((v) => String(v || "").toLowerCase().includes(s)));
  }, [q, rows]);

  return (
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyTop={<Field label="Ara" testID="sevk-search" value={q} onChangeText={setQ} placeholder="Sipariş no, müşteri, şehir" />}
    >
      <ActionTiles
        columns={3}
        items={[
          { key: "refresh", label: "Yenile", icon: "refresh", tone: "slate", testID: "sevk-refresh", onPress: load },
          { key: "orders", label: "Siparişler", icon: "cart", tone: "amber", testID: "sevk-orders", onPress: () => go("Orders") },
          { key: "stock", label: "Stok", icon: "cube", tone: "indigo", testID: "sevk-stock", onPress: () => go("Stock") },
        ]}
      />
      <ErrorBanner message={error} />
      {!filtered.length ? (
        <Empty icon="cube-outline" title="Toplanacak sipariş yok" hint="Yeni siparişler geldiğinde burada listelenir." />
      ) : filtered.map((r) => {
        const percent = pickPercent(r.progress);
        return (
          <Card key={idOf(r)} testID={`sevk-row-${idOf(r)}`}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text style={{ fontWeight: "800", color: colors.text }}>{r.order_number || "Sipariş"}</Text>
              <Badge label={pickStatusTr(r.pick_status)} tone={pickStatusTone(r.pick_status)} />
            </Row>
            <Muted>{[r.customer_name, r.city, fmtDate(r.order_date)].filter(Boolean).join(" · ")}</Muted>
            <ProgressBar percent={percent} />
            <Row style={{ justifyContent: "space-between" }}>
              <Muted>{pickSummaryText(r.progress, r.item_count)}</Muted>
              <Text style={{ fontWeight: "800", color: colors.text }}>%{percent}</Text>
            </Row>
            <ActionTiles
              columns={3}
              items={[
                { key: "pick", label: "Topla", icon: "scan", tone: "emerald", testID: `sevk-open-${idOf(r)}`, onPress: () => go("SevkPick", { id: idOf(r), name: r.order_number }) },
              ]}
            />
          </Card>
        );
      })}
    </Screen>
  );
}

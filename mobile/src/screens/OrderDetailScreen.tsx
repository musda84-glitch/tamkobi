import { useRoute } from "@react-navigation/native";
import React, { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Badge, Card, ErrorBanner, H1, ListRow, Muted, Screen } from "../components/ui";
import { colors } from "../theme";
import type { Order } from "../types";
import { channelTr, statusTr } from "../utils/labels";
import { fmtDate, fmtMoney } from "../utils/money";

export function OrderDetailScreen() {
  const { client } = useAuth();
  const route = useRoute<any>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await get<Order>(client, `/orders/${route.params.id}`);
      setOrder(data);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Sipariş yüklenemedi."));
    }
  }, [client, route.params.id]);

  useEffect(() => { load(); }, [load]);
  if (!order) return <Screen><ErrorBanner message={error || "Yükleniyor…"} /></Screen>;

  return (
    <Screen onRefresh={load}>
      <H1>{order.order_number}</H1>
      <Muted>{order.customer_name} · {fmtDate(order.order_date)}</Muted>
      <Card>
        <Badge label={channelTr(order.channel)} tone="indigo" />
        <Badge label={statusTr(order.order_status)} tone="amber" />
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>{fmtMoney(order.grand_total || order.total_amount)}</Text>
        {order.notes ? <Muted>{order.notes}</Muted> : null}
      </Card>
      {(order.items || []).map((it, i) => (
        <ListRow
          key={i}
          title={String(it.product_name || "Kalem")}
          subtitle={`${it.quantity} × ${fmtMoney(it.unit_price)}`}
          right={fmtMoney(it.total_incl || it.total)}
        />
      ))}
    </Screen>
  );
}

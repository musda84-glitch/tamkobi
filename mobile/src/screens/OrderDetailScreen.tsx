import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ChannelLogo } from "../components/ChannelLogo";
import { OrderActions } from "../components/OrderActions";
import { Badge, Card, ErrorBanner, H1, ListRow, Muted, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { Order } from "../types";
import { channelTr, orderNumberLabel, statusTr } from "../utils/labels";
import { fmtDate, fmtMoney } from "../utils/money";

export function OrderDetailScreen() {
  const { client } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await get<Order>(client, `/orders/${id}`);
      setOrder(data);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Sipariş yüklenemedi."));
    }
  }, [client, id]);

  useEffect(() => { load(); }, [load]);
  if (!order) return <Screen><ErrorBanner message={error || "Yükleniyor…"} /></Screen>;

  return (
    <Screen onRefresh={load}>
      <Row style={{ alignItems: "center", gap: 10 }}>
        <ChannelLogo channel={order.channel} size={40} testID="order-detail-channel" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <H1>{orderNumberLabel(order)}</H1>
        </View>
      </Row>
      <Muted>{order.customer_name} · {fmtDate(order.order_date)}</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}
      <OrderActions order={order} size="sm" onMessage={setMessage} onError={setError} onChanged={load} onDeleted={() => router.back()} />
      <Card>
        <Badge label={channelTr(order.channel)} tone="indigo" />
        <Badge label={statusTr(order.order_status)} tone="amber" />
        {order.marketplace_status ? <Badge label={order.marketplace_status} tone="slate" /> : null}
        {order.cargo_carrier_name || order.cargo_carrier ? <Badge label={String(order.cargo_carrier_name || order.cargo_carrier)} tone="teal" /> : null}
        {order.cargo_tracking_number ? <Badge label={order.cargo_tracking_number} tone="green" /> : null}
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>{fmtMoney(order.grand_total || order.total_amount)}</Text>
        {order.shipping_address ? <Muted>{order.shipping_address} {order.city || ""}</Muted> : null}
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

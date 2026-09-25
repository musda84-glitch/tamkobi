import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { get, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ChannelLogo } from "../components/ChannelLogo";
import { confirmAction } from "../components/chips";
import { OrderActions } from "../components/OrderActions";
import { SwipeRevealRow } from "../components/SwipeRevealRow";
import { Badge, Card, ErrorBanner, H1, ListRow, Muted, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { Order, Product } from "../types";
import { channelTr, orderNumberLabel, statusTr, marketplaceStatusTr } from "../utils/labels";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { canStaffEditOrder, cartFromOrderItems, orderUpdatePayload, removeOrderLine } from "../utils/orderEdit";
import { orderInvoiceBadgeLabel, orderInvoiceBadgeTone } from "../utils/orderInvoice";
import { indexProductsByKey, lineItemImage, lineProductIds } from "../utils/productDisplay";

export function OrderDetailScreen() {
  const { client, companyId, can } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Record<string, Product>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);
  const canEditItems = (can("/orders", "edit") || can("/saha", "edit")) && canStaffEditOrder(order);

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

  useEffect(() => {
    const ids = lineProductIds(order?.items);
    if (!ids.length) {
      setCatalog({});
      return;
    }
    let cancelled = false;
    get<Product[]>(client, "/products", { company_id: companyId, lite: 1, ids: ids.join(",") })
      .then((rows) => { if (!cancelled) setCatalog(indexProductsByKey(rows)); })
      .catch(() => { if (!cancelled) setCatalog({}); });
    return () => { cancelled = true; };
  }, [client, companyId, order?.items]);

  const removeItem = (index: number) => {
    if (!order || !canEditItems) return;
    const next = removeOrderLine(order.items || [], index);
    if (!next) {
      setOpenRow(null);
      setError("En az bir kalem gerekli.");
      return;
    }
    const label = String(order.items?.[index]?.product_name || order.items?.[index]?.name || "Kalem");
    confirmAction("Kalemi sil", `${label} satırı silinsin mi?`, async () => {
      setOpenRow(null);
      try {
        const cart = cartFromOrderItems(next);
        const r = await put<{ message?: string; order?: Order }>(
          client,
          `/orders/${idOf(order)}`,
          orderUpdatePayload(cart, String(order.notes || ""), String(order.customer_order_number || "")),
        );
        if (r.order) setOrder(r.order);
        else await load();
        setMessage(r.message || "Kalem silindi.");
        setError(null);
      } catch (err) {
        setError(apiErrorMessage(err, "Kalem silinemedi."));
      }
    });
  };

  if (!order) return <Screen><ErrorBanner message={error || "Yükleniyor…"} /></Screen>;

  const isCart = !!(order as { is_held_cart?: boolean; is_active_cart?: boolean }).is_held_cart
    || !!(order as { is_active_cart?: boolean }).is_active_cart
    || order.order_status === "held_cart"
    || order.order_status === "active_cart";
  const title = isCart
    ? String((order as { held_label?: string }).held_label || order.order_number)
    : orderNumberLabel(order);

  return (
    <Screen onRefresh={load}>
      <Row style={{ alignItems: "center", gap: 10 }}>
        <ChannelLogo channel={order.channel} size={40} testID="order-detail-channel" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <H1>{title}</H1>
        </View>
      </Row>
      <Muted>{order.customer_name} · {fmtDate(order.order_date)}</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}
      {!isCart ? <OrderActions order={order} size="sm" onMessage={setMessage} onError={setError} onChanged={load} onDeleted={() => router.back()} /> : null}
      <Card>
        <Badge label={channelTr(order.channel)} tone="indigo" />
        <Badge label={statusTr(order.order_status)} tone="amber" />
        {(() => {
          const invTone = orderInvoiceBadgeTone(order);
          const invLabel = orderInvoiceBadgeLabel(order);
          if (!invLabel || !invTone) return null;
          return <Badge label={invLabel} tone={invTone === "green" ? "green" : "amber"} />;
        })()}
        {order.marketplace_status ? <Badge label={marketplaceStatusTr(order.marketplace_status)} tone="slate" /> : null}
        {order.cargo_carrier_name || order.cargo_carrier ? <Badge label={String(order.cargo_carrier_name || order.cargo_carrier)} tone="teal" /> : null}
        {order.cargo_tracking_number ? <Badge label={order.cargo_tracking_number} tone="green" /> : null}
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>{fmtMoney(order.grand_total || order.total_amount)}</Text>
        {order.shipping_address ? <Muted>{order.shipping_address} {order.city || ""}</Muted> : null}
        {order.notes ? <Muted>{order.notes}</Muted> : null}
      </Card>
      {canEditItems ? <Muted>Kalemi silmek için satırı sola kaydırın.</Muted> : null}
      {(order.items || []).map((it, i) => {
        const row = (
          <ListRow
            testID={canEditItems ? undefined : `order-item-${i}`}
            title={String(it.product_name || it.name || "Kalem")}
            subtitle={`${it.quantity} × ${fmtMoney(it.unit_price)}`}
            right={fmtMoney(it.total_incl || it.total)}
            image={lineItemImage(it, catalog)}
          />
        );
        if (!canEditItems) return <React.Fragment key={i}>{row}</React.Fragment>;
        return (
          <SwipeRevealRow
            key={i}
            rowKey={String(i)}
            openKey={openRow}
            onOpen={setOpenRow}
            onDelete={() => removeItem(i)}
            testID={`order-item-${i}`}
          >
            {row}
          </SwipeRevealRow>
        );
      })}
    </Screen>
  );
}

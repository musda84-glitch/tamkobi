import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { OrderActions } from "../components/OrderActions";
import { ChannelLogo } from "../components/ChannelLogo";
import { TabStrip } from "../components/TabStrip";
import { Empty, ErrorBanner, Field, ListRow, Muted, Screen, Badge, Row } from "../components/kit";
import { go } from "../nav";
import type { Order } from "../types";
import { orderNumberLabel, statusTr, marketplaceStatusTr } from "../utils/labels";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { orderInvoiceBadgeLabel, orderInvoiceBadgeTone } from "../utils/orderInvoice";
import {
  ORDER_LIST_FILTERS,
  ORDER_LIST_FILTER_DEFAULT,
  filterOrders,
  orderListEmptyTitle,
  orderListFilterCounts,
  type OrderListFilter,
} from "../utils/orderListFilter";

export function OrdersScreen() {
  const { client, companyId } = useAuth();
  const [rows, setRows] = useState<Order[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<OrderListFilter>(ORDER_LIST_FILTER_DEFAULT);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<Order[]>(client, "/orders", { company_id: companyId });
      setRows(data || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Siparişler yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);
  const counts = useMemo(() => orderListFilterCounts(rows), [rows]);
  const filtered = useMemo(() => filterOrders(rows, filter, q), [filter, q, rows]);
  const tabs = useMemo(
    () => ORDER_LIST_FILTERS.map((t) => ({ ...t, count: t.key === "all" ? counts.all : counts[t.key] || undefined })),
    [counts],
  );

  return (
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyTop={(
        <>
          <TabStrip
            testID="order-filter"
            columns={3}
            items={tabs}
            value={filter}
            onChange={setFilter}
          />
          <Field label="Ara" value={q} onChangeText={setQ} placeholder="Sipariş no / müşteri" />
        </>
      )}
    >
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}
      {!filtered.length ? <Empty icon="cart-outline" title={orderListEmptyTitle(filter)} /> : filtered.map((o) => {
        const invTone = orderInvoiceBadgeTone(o);
        const invLabel = orderInvoiceBadgeLabel(o);
        return (
        <View key={idOf(o)} style={{ marginBottom: 8 }}>
          <ListRow
            testID={`order-row-${idOf(o)}`}
            title={orderNumberLabel(o)}
            subtitle={[o.customer_name, o.marketplace_status ? marketplaceStatusTr(o.marketplace_status) : null, statusTr(o.order_status), fmtDate(o.order_date)].filter(Boolean).join(" · ")}
            leading={<ChannelLogo channel={o.channel} testID={`order-channel-${idOf(o)}`} />}
            right={fmtMoney(o.grand_total || o.total_amount)}
            onPress={() => go("OrderDetail", { id: idOf(o) })}
          />
          {invLabel && invTone ? (
            <Row style={{ paddingHorizontal: 4, paddingBottom: 2 }}>
              <Badge label={invLabel} tone={invTone === "green" ? "green" : "amber"} />
            </Row>
          ) : null}
          <OrderActions order={o} compact onMessage={setMessage} onError={setError} onChanged={load} />
        </View>
      );})}
    </Screen>
  );
}

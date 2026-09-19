import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { OrderActions } from "../components/OrderActions";
import { Empty, ErrorBanner, Field, ListRow, Muted, Screen } from "../components/kit";
import { go } from "../nav";
import type { Order } from "../types";
import { channelTr, statusTr } from "../utils/labels";
import { fmtDate, fmtMoney, idOf } from "../utils/money";

export function OrdersScreen() {
  const { client, companyId } = useAuth();
  const [rows, setRows] = useState<Order[]>([]);
  const [q, setQ] = useState("");
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
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? rows.filter((o) => [o.order_number, o.customer_name].some((v) => String(v || "").toLowerCase().includes(s))) : rows;
    return list.slice(0, 80);
  }, [q, rows]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <Field label="Ara" value={q} onChangeText={setQ} placeholder="Sipariş no / müşteri" />
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}
      {!filtered.length ? <Empty icon="cart-outline" title="Sipariş yok" /> : filtered.map((o) => (
        <View key={idOf(o)} style={{ marginBottom: 8 }}>
          <ListRow
            testID={`order-row-${idOf(o)}`}
            title={o.order_number || "Sipariş"}
            subtitle={`${o.customer_name} · ${channelTr(o.channel)} · ${statusTr(o.order_status)} · ${fmtDate(o.order_date)}`}
            right={fmtMoney(o.grand_total || o.total_amount)}
            onPress={() => go("OrderDetail", { id: idOf(o) })}
          />
          <OrderActions order={o} compact onMessage={setMessage} onError={setError} />
        </View>
      ))}
    </Screen>
  );
}

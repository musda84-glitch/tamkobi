import { useNavigation } from "@react-navigation/native";
import React, { useState } from "react";
import { Text } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Card, ErrorBanner, Field, ListRow, Screen } from "../components/ui";
import { colors } from "../theme";
import { fmtMoney, idOf } from "../utils/money";

type SearchHit = {
  contacts: { id?: string; _id?: string; name: string; balance?: number }[];
  products: { id?: string; _id?: string; name: string; sku?: string; sale_price?: number }[];
  orders: { id?: string; _id?: string; order_number?: string; customer_name?: string }[];
  invoices: { id?: string; _id?: string; invoice_number?: string; contact_name?: string; grand_total?: number }[];
};

export function SearchScreen() {
  const { client, companyId } = useAuth();
  const navigation = useNavigation<any>();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (value: string) => {
    setQ(value);
    if (value.trim().length < 2) { setHits(null); return; }
    try {
      const data = await get<SearchHit>(client, "/search", { q: value.trim(), company_id: companyId });
      setHits(data);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Arama yapılamadı."));
    }
  };

  return (
    <Screen>
      <Field label="Genel arama" testID="global-search" value={q} onChangeText={run} placeholder="Cari, ürün, sipariş, fatura" autoFocus />
      <ErrorBanner message={error} />
      {hits?.contacts?.length ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Cariler</Text>
          {hits.contacts.map((c) => (
            <ListRow key={idOf(c)} title={c.name} right={fmtMoney(c.balance)} onPress={() => navigation.navigate("ContactDetail", { id: idOf(c), name: c.name })} />
          ))}
        </Card>
      ) : null}
      {hits?.products?.length ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Ürünler</Text>
          {hits.products.map((p) => (
            <ListRow key={idOf(p)} title={p.name} subtitle={p.sku} right={fmtMoney(p.sale_price)} />
          ))}
        </Card>
      ) : null}
      {hits?.orders?.length ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Siparişler</Text>
          {hits.orders.map((o) => (
            <ListRow key={idOf(o)} title={o.order_number || "Sipariş"} subtitle={o.customer_name} onPress={() => navigation.navigate("OrderDetail", { id: idOf(o) })} />
          ))}
        </Card>
      ) : null}
      {hits?.invoices?.length ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Faturalar</Text>
          {hits.invoices.map((i) => (
            <ListRow key={idOf(i)} title={i.invoice_number || "Fatura"} subtitle={i.contact_name} right={fmtMoney(i.grand_total)} onPress={() => navigation.navigate("InvoiceDetail", { id: idOf(i) })} />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

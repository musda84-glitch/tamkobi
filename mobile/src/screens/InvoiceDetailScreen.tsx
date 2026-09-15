import { useRoute } from "@react-navigation/native";
import React, { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Badge, Card, ErrorBanner, H1, ListRow, Muted, Screen } from "../components/ui";
import { colors } from "../theme";
import type { Invoice } from "../types";
import { eTypeTr, invoiceTypeTr, statusTr } from "../utils/labels";
import { fmtDate, fmtMoney } from "../utils/money";

export function InvoiceDetailScreen() {
  const { client } = useAuth();
  const route = useRoute<any>();
  const [inv, setInv] = useState<Invoice | null>(route.params.invoice || null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await get<Invoice>(client, `/invoices/${route.params.id}`);
      setInv(data);
      setError(null);
    } catch (err) {
      if (!route.params.invoice) setError(apiErrorMessage(err, "Fatura yüklenemedi."));
    }
  }, [client, route.params.id, route.params.invoice]);

  useEffect(() => { load(); }, [load]);
  if (!inv) return <Screen><ErrorBanner message={error || "Fatura bulunamadı."} /></Screen>;

  return (
    <Screen onRefresh={load}>
      <H1>{inv.invoice_number}</H1>
      <Muted>{inv.contact_name} · {fmtDate(inv.issue_date)}</Muted>
      <ErrorBanner message={error} />
      <Card>
        <Badge label={invoiceTypeTr(inv.invoice_type)} tone="indigo" />
        <Badge label={eTypeTr(inv.e_type)} tone="slate" />
        <Badge label={statusTr(inv.status)} tone={inv.status === "draft" ? "amber" : "green"} />
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text, marginTop: 8 }}>{fmtMoney(inv.grand_total, inv.currency)}</Text>
        <Muted>Ödenen {fmtMoney(inv.paid_amount, inv.currency)} · vade {fmtDate(inv.due_date)}</Muted>
      </Card>
      {(inv.items || []).map((it, i) => (
        <ListRow
          key={i}
          title={String(it.product_name || it.name || "Kalem")}
          subtitle={`${it.quantity} × ${fmtMoney(it.unit_price)}`}
          right={fmtMoney(it.total_incl || it.total)}
        />
      ))}
    </Screen>
  );
}

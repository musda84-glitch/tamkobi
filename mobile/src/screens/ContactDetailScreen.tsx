import { useRoute } from "@react-navigation/native";
import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Badge, Card, ErrorBanner, H1, Muted, PrimaryButton, Screen } from "../components/ui";
import { colors } from "../theme";
import { fmtMoney } from "../utils/money";

export function ContactDetailScreen() {
  const { client } = useAuth();
  const route = useRoute<any>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const ov = await get<any>(client, `/contacts/${route.params.id}/overview`);
      setData(ov);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Cari detayı yüklenemedi."));
    }
  }, [client, route.params.id]);

  useEffect(() => { load(); }, [load]);
  const c = data?.contact || data || {};
  const summary = data?.summary || {};

  return (
    <Screen onRefresh={load}>
      <H1>{c.name || route.params.name || "Cari"}</H1>
      <Muted>{c.tax_number_or_id || ""} {c.city ? `· ${c.city}` : ""}</Muted>
      <ErrorBanner message={error} />
      <Card>
        <Text style={{ color: colors.muted, fontWeight: "700" }}>Bakiye</Text>
        <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>{fmtMoney(c.balance)}</Text>
        {c.type ? <Badge label={c.type === "supplier" ? "Tedarikçi" : c.type === "both" ? "Müşteri/Tedarikçi" : "Müşteri"} tone="indigo" /> : null}
        {summary.invoice_count != null ? <Muted>{summary.invoice_count} fatura · açık {fmtMoney(summary.open_amount)}</Muted> : null}
      </Card>
      {c.phone ? <PrimaryButton title={`Ara ${c.phone}`} onPress={() => Linking.openURL(`tel:${c.phone}`)} /> : null}
      {c.phone ? <PrimaryButton title="WhatsApp" color="#128C7E" onPress={() => Linking.openURL(`https://wa.me/${String(c.phone).replace(/\D/g, "")}`)} /> : null}
      {(c.location_url || (c.latitude && c.longitude)) ? (
        <PrimaryButton
          title="Konuma git"
          color={colors.primary}
          onPress={() => Linking.openURL(c.location_url || `https://maps.google.com/?q=${c.latitude},${c.longitude}`)}
        />
      ) : null}
    </Screen>
  );
}

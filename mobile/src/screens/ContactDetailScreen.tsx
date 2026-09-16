import { useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Badge, Card, ErrorBanner, H1, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import { riskStatusTr } from "../utils/labels";
import { balanceHint, contactInfoRows, contactSummaryRows, contactTypeLabel } from "../utils/contactDisplay";
import { fmtMoney } from "../utils/money";

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 11, textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: "600", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function ContactDetailScreen() {
  const { client } = useAuth();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const ov = await get<any>(client, `/contacts/${id}/overview`);
      setData(ov);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Cari detayı yüklenemedi."));
    }
  }, [client, id]);

  useEffect(() => { load(); }, [load]);
  const c = data?.contact || data || {};
  const summary = data?.summary || {};
  const hint = balanceHint(c.balance);
  const infoRows = useMemo(() => contactInfoRows(c), [c]);
  const summaryRows = useMemo(() => contactSummaryRows(summary), [summary]);

  return (
    <Screen onRefresh={load}>
      <H1>{c.name || name || "Cari"}</H1>
      <Muted>{[c.company_title, c.tax_number_or_id, c.city].filter(Boolean).join(" · ")}</Muted>
      <ErrorBanner message={error} />
      <Card testID="contact-card">
        <Text style={{ color: colors.muted, fontWeight: "700" }}>Bakiye</Text>
        <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>{fmtMoney(c.balance)}</Text>
        <Row style={{ flexWrap: "wrap" }}>
          <Badge label={contactTypeLabel(c.type)} tone="indigo" />
          <Badge label={hint.label} tone={hint.tone} />
          {c.is_e_invoice_user ? <Badge label="E-Fatura" tone="green" /> : null}
          {c.b2b_enabled ? <Badge label="B2B" tone="indigo" /> : null}
          {c.risk_status && c.risk_status !== "normal" ? <Badge label={riskStatusTr(c.risk_status)} tone="red" /> : null}
        </Row>
        {summaryRows.length ? (
          <View>
            {summaryRows.map((r) => (
              <Muted key={r.key}>{r.label}: {r.value}</Muted>
            ))}
          </View>
        ) : (
          <Muted>0 fatura · açık {fmtMoney(0)}</Muted>
        )}
        {infoRows.map((r) => (
          <InfoLine key={r.key} label={r.label} value={r.value} />
        ))}
      </Card>
      {c.phone ? <PrimaryButton title={`Ara ${c.phone}`} onPress={() => Linking.openURL(`tel:${c.phone}`)} /> : null}
      {c.email ? <PrimaryButton title={`E-posta ${c.email}`} color={colors.primary} onPress={() => Linking.openURL(`mailto:${c.email}`)} /> : null}
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

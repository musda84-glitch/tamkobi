import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "../components/chips";
import { Empty, ErrorBanner, Field, ListRow, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import type { Contact } from "../types";
import { fmtMoney, idOf } from "../utils/money";

const TYPE_FILTERS = [
  { key: "all", label: "Tümü" },
  { key: "customer", label: "Müşteri" },
  { key: "supplier", label: "Tedarikçi" },
  { key: "both", label: "Her ikisi" },
] as const;

const FIN_FILTERS = [
  { key: "all", label: "Hepsi" },
  { key: "debtors", label: "Bize borçlu" },
  { key: "creditors", label: "Bize alacaklı" },
  { key: "clear", label: "Bakiyesi sıfır" },
] as const;

export function ContactsScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/contacts", "edit");
  const [rows, setRows] = useState<Contact[]>([]);
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState<(typeof TYPE_FILTERS)[number]["key"]>("all");
  const [finF, setFinF] = useState<(typeof FIN_FILTERS)[number]["key"]>("all");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true });
      setRows(data || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Cariler yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((c) => {
      if (typeF !== "all" && c.type !== typeF) return false;
      const bal = Number(c.balance) || 0;
      if (finF === "debtors" && !(bal > 0)) return false;
      if (finF === "creditors" && !(bal < 0)) return false;
      if (finF === "clear" && !!bal) return false;
      if (s.length < 1) return true;
      return [c.name, c.phone, c.email, c.tax_number_or_id, c.city, c.company_title].some((v) => String(v || "").toLowerCase().includes(s));
    }).slice(0, 80);
  }, [q, rows, typeF, finF]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      {canEdit ? (
        <PrimaryButton title="Yeni cari ekle" onPress={() => go("ContactNew")} color={colors.primary} testID="add-contact-btn" />
      ) : null}
      <Field label="Ara" testID="contacts-search" value={q} onChangeText={setQ} placeholder="Ad, telefon, VKN" />
      <Row style={{ flexWrap: "wrap" }}>
        {TYPE_FILTERS.map((t) => (
          <Chip key={t.key} label={t.label} active={typeF === t.key} testID={`contacts-type-${t.key}`} onPress={() => setTypeF(t.key)} />
        ))}
      </Row>
      <Row style={{ flexWrap: "wrap" }}>
        {FIN_FILTERS.map((t) => (
          <Chip key={t.key} label={t.label} active={finF === t.key} testID={`contacts-fin-${t.key}`} onPress={() => setFinF(t.key)} />
        ))}
      </Row>
      <ErrorBanner message={error} />
      {!filtered.length ? <Empty icon="people-outline" title="Cari bulunamadı" hint={canEdit ? "Yeni cari kartı ekleyin." : undefined} /> : filtered.map((c) => (
        <ListRow
          key={idOf(c)}
          testID={`contact-row-${idOf(c)}`}
          title={c.name}
          subtitle={[c.city, c.phone].filter(Boolean).join(" · ")}
          right={fmtMoney(c.balance)}
          onPress={() => go("ContactDetail", { id: idOf(c), name: c.name })}
        />
      ))}
    </Screen>
  );
}

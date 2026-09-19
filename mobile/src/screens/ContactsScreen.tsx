import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "../components/chips";
import { Empty, ErrorBanner, Field, ListRow, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import type { Contact } from "../types";
import { contactDisplayBalance } from "../utils/contactDisplay";
import { CONTACT_TYPE_FILTERS, filterContacts, type ContactTypeFilter } from "../utils/contactFilters";
import { fmtMoney, idOf } from "../utils/money";

export function ContactsScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/contacts", "edit");
  const [rows, setRows] = useState<Contact[]>([]);
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState<ContactTypeFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<Contact[]>(client, "/contacts", { company_id: companyId });
      setRows(data || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Cariler yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => filterContacts(rows, typeF, q), [q, rows, typeF]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      {canEdit ? (
        <PrimaryButton title="Yeni cari ekle" onPress={() => go("ContactNew")} color={colors.primary} testID="add-contact-btn" />
      ) : null}
      <Field label="Ara" testID="contacts-search" value={q} onChangeText={setQ} placeholder="Ad, telefon, VKN" />
      <Row style={{ flexWrap: "wrap" }}>
        {CONTACT_TYPE_FILTERS.map((t) => (
          <Chip key={t.key} label={t.label} active={typeF === t.key} testID={`contacts-type-${t.key}`} onPress={() => setTypeF(t.key)} />
        ))}
      </Row>
      <ErrorBanner message={error} />
      {!filtered.length ? <Empty icon="people-outline" title="Cari bulunamadı" hint={canEdit ? "Yeni cari kartı ekleyin." : undefined} /> : filtered.map((c) => {
        const bal = contactDisplayBalance(c);
        return (
          <ListRow
            key={idOf(c)}
            testID={`contact-row-${idOf(c)}`}
            title={c.name}
            subtitle={[c.city, c.phone].filter(Boolean).join(" · ")}
            right={fmtMoney(bal)}
            rightSub={bal > 0 ? "Alacak" : bal < 0 ? "Borç" : undefined}
            onPress={() => go("ContactDetail", { id: idOf(c), name: c.name })}
          />
        );
      })}
    </Screen>
  );
}

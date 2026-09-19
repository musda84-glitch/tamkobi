import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "../components/chips";
import { Empty, ErrorBanner, Field, ListRow, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import type { Contact, Invoice } from "../types";
import { contactDisplayBalance, invoiceOpenByContact, type ContactBalanceFlag } from "../utils/contactDisplay";
import { CONTACT_TYPE_FILTERS, filterContacts, type ContactTypeFilter } from "../utils/contactFilters";
import { fmtMoney, idOf } from "../utils/money";

export function ContactsScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/contacts", "edit");
  const [rows, setRows] = useState<Contact[]>([]);
  const [openById, setOpenById] = useState<Record<string, number>>({});
  const [flags, setFlags] = useState<Record<string, ContactBalanceFlag>>({});
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState<ContactTypeFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [data, invoiceRows, flagRows] = await Promise.all([
        get<Contact[]>(client, "/contacts", { company_id: companyId }),
        get<Invoice[]>(client, "/invoices", { company_id: companyId }).catch(() => []),
        get<Record<string, ContactBalanceFlag>>(client, "/contacts/flags", { company_id: companyId }).catch(() => ({})),
      ]);
      setRows(data || []);
      setOpenById(invoiceOpenByContact(invoiceRows || []));
      setFlags(flagRows || {});
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
        const id = idOf(c);
        const bal = contactDisplayBalance(c, { open_amount: openById[id] }, flags[id]);
        return (
          <ListRow
            key={id}
            testID={`contact-row-${id}`}
            title={c.name}
            subtitle={[c.city, c.phone].filter(Boolean).join(" · ")}
            right={fmtMoney(bal)}
            rightColor={bal > 0 ? colors.primaryHover : bal < 0 ? colors.danger : colors.text}
            rightSub={bal > 0 ? "Alacaklı" : bal < 0 ? "Borçlu" : "Cari bakiye"}
            rightSubColor={bal > 0 ? colors.primaryHover : bal < 0 ? colors.danger : colors.muted}
            onPress={() => go("ContactDetail", { id, name: c.name })}
          />
        );
      })}
    </Screen>
  );
}

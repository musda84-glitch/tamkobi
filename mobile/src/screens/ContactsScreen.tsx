import React, { useCallback, useEffect, useMemo, useState } from "react";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Empty, ErrorBanner, Field, ListRow, Screen } from "../components/kit";
import { go } from "../nav";
import type { Contact } from "../types";
import { fmtMoney, idOf } from "../utils/money";

export function ContactsScreen() {
  const { client, companyId } = useAuth();
  const [rows, setRows] = useState<Contact[]>([]);
  const [q, setQ] = useState("");
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

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 1) return rows.slice(0, 80);
    return rows.filter((c) => [c.name, c.phone, c.email, c.tax_number_or_id, c.city].some((v) => String(v || "").toLowerCase().includes(s))).slice(0, 80);
  }, [q, rows]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <Field label="Ara" testID="contacts-search" value={q} onChangeText={setQ} placeholder="Ad, telefon, VKN" />
      <ErrorBanner message={error} />
      {!filtered.length ? <Empty icon="people-outline" title="Cari bulunamadı" /> : filtered.map((c) => (
        <ListRow
          key={idOf(c)}
          title={c.name}
          subtitle={[c.city, c.phone].filter(Boolean).join(" · ")}
          right={fmtMoney(c.balance)}
          onPress={() => go("ContactDetail", { id: idOf(c), name: c.name })}
        />
      ))}
    </Screen>
  );
}

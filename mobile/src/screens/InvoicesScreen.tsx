import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Empty, ErrorBanner, Field, ListRow, Row, Screen } from "../components/ui";
import { colors } from "../theme";
import type { Invoice } from "../types";
import { eTypeTr, invoiceTypeTr, statusTr } from "../utils/labels";
import { fmtDate, fmtMoney, idOf } from "../utils/money";

const FILTERS = [
  { key: "all", label: "Tümü" },
  { key: "sales", label: "Satış" },
  { key: "purchase", label: "Alış" },
];

export function InvoicesScreen() {
  const { client, companyId } = useAuth();
  const navigation = useNavigation<any>();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<Invoice[]>(client, "/invoices", { company_id: companyId, type: type === "all" ? undefined : type });
      setRows(data || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Faturalar yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, type]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? rows.filter((i) => [i.invoice_number, i.contact_name].some((v) => String(v || "").toLowerCase().includes(s)))
      : rows;
    return list.slice(0, 80);
  }, [q, rows]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <Row>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => setType(f.key)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: type === f.key ? colors.secondary : "#fff", borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: type === f.key ? "#fff" : colors.text, fontWeight: "700" }}>{f.label}</Text>
          </Pressable>
        ))}
      </Row>
      <Field label="Ara" value={q} onChangeText={setQ} placeholder="Fatura no / cari" />
      <ErrorBanner message={error} />
      {!filtered.length ? <Empty icon="document-outline" title="Fatura yok" /> : filtered.map((inv) => (
        <ListRow
          key={idOf(inv)}
          title={inv.invoice_number || "Fatura"}
          subtitle={`${invoiceTypeTr(inv.invoice_type)} · ${eTypeTr(inv.e_type)} · ${statusTr(inv.status)} · ${fmtDate(inv.issue_date)}`}
          right={fmtMoney(inv.grand_total, inv.currency)}
          onPress={() => navigation.navigate("InvoiceDetail", { id: idOf(inv), invoice: inv })}
        />
      ))}
    </Screen>
  );
}

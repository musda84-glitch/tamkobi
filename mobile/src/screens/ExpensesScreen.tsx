import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "../components/chips";
import { ExpenseScanButtons } from "../components/ExpenseScanButtons";
import { Card, Empty, ErrorBanner, Field, ListRow, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import type { Expense } from "../utils/finance";
import { statusTr } from "../utils/labels";
import { expenseScanNavParams } from "../utils/expenseScan";
import { fmtDate, fmtMoney, idOf } from "../utils/money";

type ExpenseList = {
  expenses?: Expense[];
  summary?: { this_month_total?: number; total?: number; unpaid_total?: number; unpaid_count?: number; count?: number };
};

export function ExpensesScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/expenses", "edit");
  const [data, setData] = useState<ExpenseList>({ expenses: [] });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await get<ExpenseList>(client, "/expenses", {
        company_id: companyId,
        status: status === "all" ? undefined : status,
      });
      setData(res || { expenses: [] });
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Masraflar yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, status]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = data.expenses || [];
    return (s
      ? list.filter((e) => [e.description, e.expense_number, e.category, e.contact_name].some((v) => String(v || "").toLowerCase().includes(s)))
      : list
    ).slice(0, 80);
  }, [data.expenses, q]);
  const s = data.summary;

  return (
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyTop={(
        <>
          {canEdit ? (
            <>
              <PrimaryButton title="Yeni masraf" onPress={() => go("ExpenseNew")} color={colors.danger} testID="exp-new-btn" />
              <ExpenseScanButtons
                testID="exp-scan"
                onDraft={(draft, match) => {
                  setError(null);
                  go("ExpenseNew", expenseScanNavParams(draft, match));
                }}
                onError={setError}
              />
            </>
          ) : null}
          {s ? (
            <Card>
              <Text style={{ fontWeight: "800", color: colors.text }}>Bu ay {fmtMoney(s.this_month_total)}</Text>
              <Row style={{ justifyContent: "space-between" }}>
                <Text style={{ color: colors.muted }}>Ödenmemiş</Text>
                <Text style={{ fontWeight: "700", color: colors.warning }}>{fmtMoney(s.unpaid_total)} · {s.unpaid_count || 0}</Text>
              </Row>
            </Card>
          ) : null}
          <Row>
            {[["all", "Tümü"], ["unpaid", "Ödenmedi"], ["paid", "Ödendi"]].map(([k, l]) => (
              <Chip key={k} label={l} active={status === k} onPress={() => setStatus(k)} testID={`exp-status-${k}`} />
            ))}
          </Row>
          <Field label="Ara" testID="exp-search" value={q} onChangeText={setQ} placeholder="Açıklama / no / kategori" />
        </>
      )}
    >
      <ErrorBanner message={error} />
      {!rows.length ? (
        <Empty icon="receipt-outline" title="Masraf yok" hint={canEdit ? "Kira, yakıt, yemek gibi gider ekleyin." : undefined} />
      ) : rows.map((e) => (
        <ListRow
          key={idOf(e)}
          testID={`exp-row-${idOf(e)}`}
          title={e.description || e.expense_number || "Masraf"}
          subtitle={`${e.expense_number || ""} · ${e.category || ""} · ${statusTr(e.payment_status)} · ${fmtDate(e.date)}`}
          right={fmtMoney(e.total)}
          onPress={() => go("ExpenseDetail", { id: idOf(e) })}
        />
      ))}
    </Screen>
  );
}

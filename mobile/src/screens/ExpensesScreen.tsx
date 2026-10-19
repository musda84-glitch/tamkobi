import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "../components/chips";
import { ExpenseCard } from "../components/ExpenseCard";
import { ExpenseScanButtons } from "../components/ExpenseScanButtons";
import { Empty, ErrorBanner, Field, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { groupExpensesByMonth } from "../utils/expenseDisplay";
import { expenseScanNavParams } from "../utils/expenseScan";
import type { Expense } from "../utils/finance";
import { fmtMoney, idOf } from "../utils/money";

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
  const groups = useMemo(() => groupExpensesByMonth(rows), [rows]);
  const s = data.summary;

  return (
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyCompact
      stickyTop={(
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 22, fontWeight: "800", color: colors.text }}>Masraflar</Text>
            {canEdit ? (
              <>
                <ExpenseScanButtons
                  variant="sheet"
                  testID="exp-scan"
                  onManual={() => go("ExpenseNew")}
                  onDraft={(draft, match) => {
                    setError(null);
                    go("ExpenseNew", expenseScanNavParams(draft, match));
                  }}
                  onError={setError}
                />
                <Pressable
                  testID="exp-new-btn"
                  accessibilityRole="button"
                  accessibilityLabel="Yeni masraf"
                  onPress={() => go("ExpenseNew")}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: colors.danger,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 24, fontWeight: "700", lineHeight: 26 }}>+</Text>
                </Pressable>
              </>
            ) : null}
          </View>
          {s ? (
            <View
              testID="exp-summary"
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "700", color: colors.muted }}>
                Bu ay toplam <Text style={{ color: colors.text, fontWeight: "800" }}>{fmtMoney(s.this_month_total)}</Text>
                {" · "}
                Ödenmemiş <Text style={{ color: colors.warning, fontWeight: "800" }}>{fmtMoney(s.unpaid_total)} / {s.unpaid_count || 0}</Text>
              </Text>
            </View>
          ) : null}
          <Field dense label="Ara" testID="exp-search" value={q} onChangeText={setQ} placeholder="Açıklama / no / kategori" />
          <Row>
            {([["all", "Tümü"], ["unpaid", "Ödenmedi"], ["paid", "Ödendi"]] as const).map(([k, l]) => (
              <Chip key={k} fill label={l} active={status === k} onPress={() => setStatus(k)} testID={`exp-status-${k}`} />
            ))}
          </Row>
        </View>
      )}
    >
      <ErrorBanner message={error} />
      {!rows.length ? (
        <Empty icon="receipt-outline" title="Masraf yok" hint={canEdit ? "Kira, yakıt, yemek gibi gider ekleyin." : undefined} />
      ) : groups.map((group) => {
        const [main, ...rest] = group.totals.length ? group.totals : [{ currency: "TRY", amount: 0 }];
        return (
          <View key={group.key} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Text testID={`exp-month-${group.key}`} style={{ flex: 1, fontWeight: "800", fontSize: 13, color: colors.text }}>
                {group.label}
              </Text>
              <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
                <Text testID={`exp-month-${group.key}-total`} style={{ fontWeight: "800", fontSize: 13, color: colors.text }}>
                  {fmtMoney(main.amount, main.currency)}
                </Text>
                {rest.map((line) => (
                  <Text
                    key={line.currency}
                    testID={`exp-month-${group.key}-total-${line.currency}`}
                    style={{ fontWeight: "700", fontSize: 11, color: colors.muted }}
                  >
                    {fmtMoney(line.amount, line.currency)}
                  </Text>
                ))}
              </View>
            </View>
            {group.items.map((expense) => (
              <ExpenseCard
                key={idOf(expense)}
                expense={expense}
                onPress={() => go("ExpenseDetail", { id: idOf(expense) })}
              />
            ))}
          </View>
        );
      })}
    </Screen>
  );
}

import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Empty, ErrorBanner, Field, ListRow, PrimaryButton, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { ACCOUNT_TYPES, accountTypeTr, type BankAccount } from "../utils/finance";
import { fmtMoney, idOf } from "../utils/money";

export function BankingScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const [rows, setRows] = useState<BankAccount[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId });
      setRows(data || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Hesaplar yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? rows.filter((a) => [a.account_name, a.bank_name, a.iban, a.type].some((v) => String(v || "").toLowerCase().includes(s)))
      : rows;
    return list.slice(0, 100);
  }, [q, rows]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      {canEdit ? (
        <PrimaryButton title="Yeni hesap" onPress={() => go("BankingNew")} color={colors.primary} testID="bank-new" />
      ) : null}
      {canEdit && rows.length > 1 ? (
        <PrimaryButton title="Virman" onPress={() => go("BankingVirman")} color={colors.indigo} testID="bank-virman" />
      ) : null}
      <Field label="Ara" testID="bank-search" value={q} onChangeText={setQ} placeholder="Hesap / IBAN / kasa" />
      <ErrorBanner message={error} />
      {!filtered.length ? (
        <Empty icon="wallet-outline" title="Hesap yok" hint={canEdit ? "Banka, kasa veya POS hesabı ekleyin." : undefined} />
      ) : ACCOUNT_TYPES.map((g) => {
        const group = filtered.filter((a) => (a.type || "bank") === g.key);
        if (!group.length) return null;
        return (
          <React.Fragment key={g.key}>
            <Text style={{ fontWeight: "800", color: colors.text, marginTop: 8 }}>{g.label}</Text>
            {group.map((a) => (
              <ListRow
                key={idOf(a)}
                testID={`bank-row-${idOf(a)}`}
                title={a.account_name || a.bank_name || "Hesap"}
                subtitle={[accountTypeTr(a.type), a.iban || a.account_number, a.bank_name].filter(Boolean).join(" · ")}
                right={fmtMoney(a.current_balance, a.currency)}
                onPress={() => go("BankingAccount", { id: idOf(a), name: a.account_name || "" })}
              />
            ))}
          </React.Fragment>
        );
      })}
    </Screen>
  );
}

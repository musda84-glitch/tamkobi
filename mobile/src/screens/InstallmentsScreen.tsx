import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip, n } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row, Screen, StatRows } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { collectableAccounts, splitPaymentTarget } from "../utils/contactDraft";
import { paymentTargetGroups, type BankAccount } from "../utils/finance";
import { installmentSummary, remainingOf, type Installment } from "../utils/installments";
import { fmtDate, fmtMoney, idOf } from "../utils/money";

type Partner = { id?: string; _id?: string; name?: string; is_active?: boolean; balance?: number };

const FILTERS = [
  { key: "pending", label: "Bekleyen" },
  { key: "overdue", label: "Gecikmiş" },
  { key: "paid", label: "Ödenen" },
  { key: "all", label: "Tümü" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export function InstallmentsScreen() {
  const { client, companyId, can } = useAuth();
  const canPay = can("/banking", "edit");
  const [rows, setRows] = useState<Installment[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [q, setQ] = useState("");
  const [pay, setPay] = useState<{ row: Installment; amount: string; account_id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<Installment[]>(client, "/installments", { company_id: companyId });
      setRows(data || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Taksitler yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (filter === "pending" && r.status === "paid") return false;
      if (filter === "overdue" && !r.is_overdue) return false;
      if (filter === "paid" && r.status !== "paid") return false;
      if (!s) return true;
      return [r.invoice_number, r.label, (r as { contact_name?: string }).contact_name]
        .some((v) => String(v || "").toLowerCase().includes(s));
    });
  }, [filter, q, rows]);

  const summary = useMemo(() => installmentSummary(rows), [rows]);
  const paidTotal = useMemo(
    () => rows.filter((r) => r.status === "paid").reduce((s, r) => s + (Number(r.paid_amount) || 0), 0),
    [rows]
  );

  const openPay = async (row: Installment) => {
    if (!canPay) { setError("Tahsilat yetkiniz yok."); return; }
    const [accs, pars] = await Promise.all([
      get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }).catch(() => []),
      get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
    ]);
    setAccounts(accs || []);
    setPartners(pars || []);
    const pool = collectableAccounts(accs || []);
    setPay({ row, amount: remainingOf(row).toFixed(2), account_id: pool[0] ? idOf(pool[0]) : "" });
  };

  const savePay = async () => {
    if (!pay) return;
    const amount = n(pay.amount);
    if (!(amount > 0)) { setError("Geçerli bir tutar girin."); return; }
    setBusy(true);
    try {
      const target = splitPaymentTarget(pay.account_id);
      const r = await post<{ message?: string }>(client, `/installments/${idOf(pay.row)}/pay`, {
        amount,
        account_id: target.account_id,
        partner_id: target.partner_id,
      });
      setPay(null);
      setMessage(r?.message || "Taksit ödemesi kaydedildi.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Taksit ödemesi kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyTop={<Field label="Ara" testID="inst-search" value={q} onChangeText={setQ} placeholder="Fatura no, cari, taksit" />}
    >
      <StatRows
        testID="installments-summary"
        items={[
          { key: "pending", label: "Bekleyen taksit", value: String(summary.pending), hint: `Kalan ${fmtMoney(summary.remaining)}` },
          { key: "overdue", label: "Vadesi geçen", value: String(summary.overdue), valueColor: summary.overdue ? colors.danger : undefined },
          { key: "paid", label: "Ödenen", value: fmtMoney(paidTotal) },
        ]}
      />
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}

      {pay ? (
        <Card testID="inst-pay-form">
          <Muted>{pay.row.invoice_number || "Taksit"} · {pay.row.label} · kalan {fmtMoney(remainingOf(pay.row))}</Muted>
          <Field label="Tutar" testID="inst-pay-amount" value={pay.amount} onChangeText={(v) => setPay({ ...pay, amount: v })} keyboardType="decimal-pad" />
          <GroupedSelect
            label="Kasa / banka / ortak"
            testID="inst-pay-account"
            value={pay.account_id}
            onChange={(v) => setPay({ ...pay, account_id: v })}
            emptyLabel="Hesapsız — cariye işle"
            groups={paymentTargetGroups(accounts, partners, { collectableOnly: true })}
          />
          <PrimaryButton title="Ödemeyi kaydet" onPress={savePay} loading={busy} color={colors.primary} testID="inst-pay-save" />
          <PrimaryButton title="Vazgeç" onPress={() => setPay(null)} testID="inst-pay-cancel" />
        </Card>
      ) : null}

      <Row style={{ flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} active={filter === f.key} testID={`inst-filter-${f.key}`} onPress={() => setFilter(f.key)} />
        ))}
      </Row>

      {!filtered.length ? (
        <Empty icon="calendar-outline" title="Taksit yok" hint="Fatura veya cari bakiyesinden taksit planı oluşturun." />
      ) : filtered.map((r) => (
        <ListRow
          key={idOf(r)}
          testID={`inst-row-${idOf(r)}`}
          title={`${r.invoice_number || "Taksit"} · ${r.label || `${r.no}. taksit`}`}
          subtitle={[
            (r as { contact_name?: string }).contact_name,
            fmtDate(r.due_date),
            r.status === "paid" ? "Ödendi" : r.is_overdue ? "Vadesi geçti" : "Bekliyor",
            r.status === "paid" ? "" : `kalan ${fmtMoney(remainingOf(r))}`,
          ].filter(Boolean).join(" · ")}
          right={fmtMoney(r.amount)}
          onPress={canPay && r.status !== "paid" ? () => openPay(r) : () => go("ContactDetail", { id: (r as { contact_id?: string }).contact_id || "" })}
        />
      ))}
    </Screen>
  );
}

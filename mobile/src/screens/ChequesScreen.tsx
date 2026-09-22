import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { Chip } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row, Screen, StatRows } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { collectableAccounts, splitPaymentTarget } from "../utils/contactDraft";
import {
  CHEQUE_FILTERS,
  chequeAction,
  chequeStatusTr,
  chequeTitle,
  filterCheques,
  type Cheque,
  type ChequeFilter,
  type ChequeSummary,
} from "../utils/cheques";
import { paymentTargetGroups, type BankAccount } from "../utils/finance";
import { fmtDate, fmtMoney, idOf, todayIso } from "../utils/money";

type Partner = { id?: string; _id?: string; name?: string; is_active?: boolean; balance?: number };
type Settle = { row: Cheque; path: "collect" | "pay"; account_id: string; date: string };

export function ChequesScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/cheques", "edit");
  const [rows, setRows] = useState<Cheque[]>([]);
  const [summary, setSummary] = useState<ChequeSummary | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [filter, setFilter] = useState<ChequeFilter>("all");
  const [q, setQ] = useState("");
  const [settle, setSettle] = useState<Settle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<{ cheques?: Cheque[]; summary?: ChequeSummary }>(client, "/cheques", { company_id: companyId });
      setRows(data?.cheques || []);
      setSummary(data?.summary || null);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Çek / senet listesi yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => filterCheques(rows, filter, q), [filter, q, rows]);

  const openSettle = async (row: Cheque) => {
    const action = chequeAction(row);
    if (!action) return;
    if (!canEdit) { setError("Çek / senet yetkiniz yok."); return; }
    const [accs, pars] = await Promise.all([
      get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }).catch(() => []),
      get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
    ]);
    setAccounts(accs || []);
    setPartners(pars || []);
    // Tahsilatta kredi kartı seçilemez; ödemede tüm hesaplar açık.
    const pool = action.path === "collect" ? collectableAccounts(accs || []) : (accs || []);
    setSettle({ row, path: action.path, account_id: pool[0] ? idOf(pool[0]) : "", date: todayIso() });
  };

  const saveSettle = async () => {
    if (!settle) return;
    const target = splitPaymentTarget(settle.account_id);
    if (!target.account_id && !target.partner_id) { setError("Kasa / banka veya ortak seçin."); return; }
    setBusy(true);
    try {
      await post(client, `/cheques/${idOf(settle.row)}/${settle.path}`, {
        account_id: target.account_id,
        partner_id: target.partner_id,
        date: settle.date,
      });
      setMessage(settle.path === "collect" ? "Çek / senet tahsil edildi." : "Çek / senet ödendi.");
      setSettle(null);
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyTop={<Field label="Ara" testID="cheque-search" value={q} onChangeText={setQ} placeholder="No, seri, cari, banka" />}
    >
      <StatRows
        testID="cheques-summary"
        items={[
          { key: "portfolio", label: "Portföy (alınan)", value: fmtMoney(summary?.portfolio), hint: `${summary?.received_count ?? 0} kayıt` },
          { key: "issued", label: "Verilen açık", value: fmtMoney(summary?.issued_open), hint: `${summary?.issued_count ?? 0} kayıt` },
          { key: "week", label: "Bu hafta vadeli", value: fmtMoney(summary?.due_this_week) },
          {
            key: "overdue",
            label: "Vadesi geçen",
            value: fmtMoney((summary?.overdue_received || 0) + (summary?.overdue_issued || 0)),
            valueColor: (summary?.overdue_received || 0) + (summary?.overdue_issued || 0) > 0 ? colors.danger : undefined,
          },
          ...(summary?.bounced ? [{ key: "bounced", label: "Karşılıksız", value: fmtMoney(summary.bounced), valueColor: colors.danger }] : []),
        ]}
      />
      {canEdit ? (
        <ActionTiles
          columns={3}
          items={[
            { key: "new", label: "Yeni kayıt", icon: "add-circle", tone: "emerald", testID: "cheque-new", onPress: () => go("ChequeNew") },
            { key: "installments", label: "Taksitler", icon: "calendar", tone: "violet", testID: "cheque-installments", onPress: () => go("Installments") },
            { key: "refresh", label: "Yenile", icon: "refresh", tone: "slate", testID: "cheque-refresh", onPress: load },
          ]}
        />
      ) : null}
      <Row style={{ flexWrap: "wrap" }}>
        {CHEQUE_FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} active={filter === f.key} testID={`cheque-filter-${f.key}`} onPress={() => setFilter(f.key)} />
        ))}
      </Row>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}

      {settle ? (
        <Card testID="cheque-settle-form">
          <Muted>
            {chequeTitle(settle.row)} · {fmtMoney(settle.row.amount)} · vade {fmtDate(settle.row.due_date)}
          </Muted>
          <GroupedSelect
            label={settle.path === "collect" ? "Tahsil hesabı (kredi kartı yok)" : "Ödeme hesabı"}
            testID="cheque-settle-account"
            value={settle.account_id}
            onChange={(v) => setSettle({ ...settle, account_id: v })}
            emptyLabel="Hesap seçin"
            groups={paymentTargetGroups(accounts, partners, { collectableOnly: settle.path === "collect" })}
          />
          <Field label="Tarih" testID="cheque-settle-date" value={settle.date} onChangeText={(v) => setSettle({ ...settle, date: v })} placeholder="YYYY-AA-GG" />
          <PrimaryButton
            title={settle.path === "collect" ? "Tahsil et" : "Öde"}
            onPress={saveSettle}
            loading={busy}
            color={colors.primary}
            testID="cheque-settle-save"
          />
          <PrimaryButton title="Vazgeç" onPress={() => setSettle(null)} testID="cheque-settle-cancel" />
        </Card>
      ) : null}

      {!filtered.length ? (
        <Empty icon="card-outline" title="Çek / senet yok" hint="Aramayı değiştirin veya web panelinden kayıt ekleyin." />
      ) : filtered.map((r) => {
        const action = chequeAction(r);
        return (
          <ListRow
            key={idOf(r)}
            testID={`cheque-row-${idOf(r)}`}
            title={chequeTitle(r)}
            subtitle={[
              r.contact_name,
              `vade ${fmtDate(r.due_date)}`,
              chequeStatusTr(r),
              r.overdue ? "gecikmiş" : r.due_soon ? "bu hafta" : "",
              r.bank_name,
            ].filter(Boolean).join(" · ")}
            right={fmtMoney(r.amount, r.currency)}
            onPress={idOf(r) ? () => go("ChequeDetail", { id: idOf(r) }) : action && canEdit ? () => openSettle(r) : undefined}
          />
        );
      })}
      {filtered.length ? (
        <Muted>Kayıta dokunarak düzenleyin, tahsilat / tediye makbuzu yazdırın veya tahsil / ödeme yapın.</Muted>
      ) : null}
    </Screen>
  );
}

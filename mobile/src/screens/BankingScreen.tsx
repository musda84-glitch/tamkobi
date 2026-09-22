import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles, type ActionTile } from "../components/ActionTiles";
import { BankMark } from "../components/BankMark";
import { confirmAction } from "../components/chips";
import { Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { TabStrip } from "../components/TabStrip";
import { go } from "../nav";
import { colors } from "../theme";
import {
  accountBalance,
  accountGroupTone,
  accountTypeTr,
  bankMovementNotice,
  groupedAccounts,
  isBankingBankAccount,
  isBankingCashAccount,
  isBankingPosAccount,
  partnerMovementNotice,
  recentPartnerTx,
  recentTxForAccounts,
  totalLiquidity,
  virmanAccounts,
  type BankAccount,
  type BankTx,
  type GroupMovementNotice,
  type Partner,
  type PartnerSummary,
  type PartnerTx,
} from "../utils/finance";
import { resolveBankBrand } from "../utils/bankBrand";
import { fmtMoney, idOf } from "../utils/money";
import { BankingMatchPanel } from "./BankingMatchPanel";
import { BankingPartnersPanel } from "./BankingPartnersScreen";

type CashApproval = {
  id?: string;
  _id?: string;
  kind?: string;
  kind_label?: string;
  summary?: string;
  requested_by_name?: string;
  can_approve?: boolean;
};

function MovementNotices({ items, testID }: { items: GroupMovementNotice[]; testID: string }) {
  if (!items.length) return null;
  return (
    <View testID={testID} style={{ marginTop: 8, gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: "rgba(15,23,42,0.08)" }}>
      {items.map((m) => {
        const tone = m.signed < 0 ? colors.danger : m.signed > 0 ? colors.primary : colors.muted;
        return (
          <View key={m.id} testID={`${testID}-${m.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone, flexShrink: 0 }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>{m.title}</Text>
              {m.detail ? <Text numberOfLines={1} style={{ fontSize: 10, color: colors.muted }}>{m.detail}</Text> : null}
            </View>
            <Text style={{ fontSize: 12, fontWeight: "800", color: tone }}>
              {m.signed > 0 ? "+" : ""}{fmtMoney(m.signed, m.currency)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Approvals({
  items,
  onAct,
}: {
  items: CashApproval[];
  onAct: (id: string, action: "approve" | "reject") => void;
}) {
  if (!items.length) return null;
  return (
    <Card testID="cash-approvals-banner">
      <Muted>Nakit onayları</Muted>
      {items.map((r) => {
        const id = idOf(r);
        return (
          <View key={id} testID={`cash-approval-${id}`} style={{ gap: 6, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ fontWeight: "800", color: colors.text }}>{r.kind_label || r.kind} · onay bekliyor</Text>
            <Muted>{[r.summary, r.requested_by_name].filter(Boolean).join(" · ")}</Muted>
            {r.can_approve ? (
              <Row>
                <PrimaryButton title="Onayla" color={colors.primary} testID={`cash-approve-${id}`} onPress={() => onAct(id, "approve")} />
                <PrimaryButton title="Reddet" color={colors.danger} testID={`cash-reject-${id}`} onPress={() => onAct(id, "reject")} />
              </Row>
            ) : (
              <Muted>Diğer yönetici onayı bekleniyor</Muted>
            )}
          </View>
        );
      })}
    </Card>
  );
}

export function BankingScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const [tab, setTab] = useState<"all" | "cash" | "banks" | "partners" | "pos" | "match">("all");
  const [rows, setRows] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerSummary, setPartnerSummary] = useState<PartnerSummary | null>(null);
  const [approvals, setApprovals] = useState<CashApproval[]>([]);
  const [txs, setTxs] = useState<BankTx[]>([]);
  const [partnerTxs, setPartnerTxs] = useState<PartnerTx[]>([]);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [q, setQ] = useState("");
  const [groupF, setGroupF] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [accs, pts, ps, appr, unmatched, movements, partnerMoves] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
        get<PartnerSummary>(client, "/banking/partners/summary", { company_id: companyId }).catch(() => null),
        get<CashApproval[]>(client, "/banking/cash-approvals", { company_id: companyId, status: "pending" }).catch(() => []),
        get<unknown[]>(client, "/banking/transactions/unmatched", { company_id: companyId }).catch(() => []),
        get<BankTx[]>(client, "/banking/transactions", { company_id: companyId }).catch(() => []),
        get<PartnerTx[]>(client, "/banking/partners/transactions", { company_id: companyId }).catch(() => []),
      ]);
      setRows(accs || []);
      setPartners(pts || []);
      setPartnerSummary(ps);
      setApprovals(appr || []);
      setUnmatchedCount((unmatched || []).length);
      setTxs(movements || []);
      setPartnerTxs(partnerMoves || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Hesaplar yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pool = useMemo(() => {
    if (tab === "banks") return rows.filter(isBankingBankAccount);
    if (tab === "pos") return rows.filter(isBankingPosAccount);
    if (tab === "cash") return rows.filter(isBankingCashAccount);
    return rows;
  }, [rows, tab]);
  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pool;
    return pool.filter((a) => [a.account_name, a.bank_name, a.iban, a.account_number, a.type, a.integration_provider].some((v) => String(v || "").toLowerCase().includes(s)));
  }, [q, pool]);

  const overviewGroups = useMemo(() => groupedAccounts(rows), [rows]);
  const visibleGroups = useMemo(() => {
    const list = groupedAccounts(searched);
    return groupF === "all" ? list : list.filter((g) => g.key === groupF);
  }, [searched, groupF]);
  const liquidity = totalLiquidity(rows);
  const activePartners = useMemo(() => (partners || []).filter((p) => p.is_active !== false), [partners]);
  const searching = q.trim().length > 0;
  const showAccountList = tab !== "all" || groupF !== "all" || searching;
  const bankCount = useMemo(() => rows.filter(isBankingBankAccount).length, [rows]);
  const cashCount = useMemo(() => rows.filter(isBankingCashAccount).length, [rows]);
  const posCount = useMemo(() => rows.filter(isBankingPosAccount).length, [rows]);
  const partnerNotices = useMemo(
    () => recentPartnerTx(partnerTxs, 3).map(partnerMovementNotice),
    [partnerTxs]
  );
  const virmanOk = virmanAccounts(rows).length + activePartners.length > 1;

  const actions: ActionTile[] = [
    canEdit && { key: "new", label: "Yeni hesap", icon: "add-circle" as const, tone: "emerald" as const, testID: "bank-new", onPress: () => go("BankingNew") },
    canEdit && virmanOk && { key: "virman", label: "Virman", icon: "swap-horizontal" as const, tone: "indigo" as const, testID: "bank-virman", onPress: () => go("BankingVirman") },
    { key: "match", label: "Eşleşme", icon: "git-compare" as const, tone: "violet" as const, testID: "bank-match-tile", badge: unmatchedCount ? String(unmatchedCount) : undefined, onPress: () => setTab("match") },
    { key: "refresh", label: "Yenile", icon: "refresh" as const, tone: "slate" as const, testID: "bank-refresh", onPress: load },
  ].filter(Boolean) as ActionTile[];

  const actApproval = (id: string, action: "approve" | "reject") => {
    confirmAction(action === "approve" ? "Onayla" : "Reddet", "Bu nakit talebi işlensin mi?", async () => {
      try {
        await post(client, `/banking/cash-approvals/${id}/${action}`, {});
        await load();
      } catch (err) {
        setError(apiErrorMessage(err, "Onay işlemi yapılamadı."));
      }
    });
  };

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <TabStrip
        testID="banking-tab"
        variant="icons"
        value={tab}
        onChange={(key) => { setTab(key); setGroupF("all"); }}
        items={[
          { key: "all", label: "Tümü", icon: "apps", color: colors.primary },
          { key: "cash", label: "Kasa", icon: "wallet", color: accountGroupTone("cash_box").accent, count: cashCount || undefined },
          { key: "banks", label: "Bankalar", icon: "business", color: accountGroupTone("bank").accent, count: bankCount || undefined },
          { key: "partners", label: "Ortaklar", icon: "people", color: accountGroupTone("partners").accent, count: partnerSummary?.partner_count || undefined },
          { key: "pos", label: "POS", icon: "card", color: accountGroupTone("pos").accent, count: posCount || undefined },
        ]}
      />

      {tab === "partners" ? (
        <BankingPartnersPanel accounts={rows} onChanged={load} />
      ) : tab === "match" ? (
        <BankingMatchPanel accounts={rows} onChanged={load} />
      ) : (
        <>
          {actions.length ? <ActionTiles items={actions} /> : null}
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <Muted>Toplam likidite</Muted>
              <Text style={{ fontWeight: "800", color: colors.text, fontSize: 18 }} testID="bank-liquidity">{fmtMoney(liquidity)}</Text>
            </Row>
            <Muted>Kredi kartı hariç kasa + banka + POS</Muted>
            {partnerSummary && (partnerSummary.partner_count || 0) > 0 ? (
              <Pressable onPress={() => setTab("partners")} testID="partners-account-card" style={{ paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Muted>Ortaklar · {partnerSummary.partner_count} ortak</Muted>
                  <Text style={{ fontWeight: "700", color: colors.text }}>{fmtMoney(partnerSummary.total_balance)}</Text>
                </Row>
              </Pressable>
            ) : null}
          </Card>
          <Approvals items={approvals} onAct={actApproval} />
          {tab === "all" ? (
            <View style={{ gap: 8 }} testID="account-groups-stack">
              {overviewGroups.map((g) => {
                const total = g.items.reduce((s, a) => s + accountBalance(a), 0);
                const active = groupF === g.key;
                const tone = accountGroupTone(g.key);
                const notices = recentTxForAccounts(txs, g.items, 3).map((tx) => bankMovementNotice(tx, g.items));
                return (
                  <Pressable
                    key={g.key}
                    onPress={() => {
                      if (g.key === "bank") { setTab("banks"); setGroupF("all"); return; }
                      if (g.key === "pos") { setTab("pos"); setGroupF("all"); return; }
                      if (g.key === "cash_box") { setTab("cash"); setGroupF("all"); return; }
                      setGroupF(active ? "all" : g.key);
                    }}
                    testID={`account-group-${g.key}`}
                    style={{
                      width: "100%",
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: active ? tone.accent : tone.border,
                      backgroundColor: tone.bg,
                    }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: "800", color: tone.label, textTransform: "uppercase" }}>{g.label}</Text>
                    <Text style={{ fontWeight: "800", color: tone.amount, fontSize: 18 }}>{fmtMoney(total)}</Text>
                    <Text style={{ fontSize: 11, color: tone.label, opacity: 0.8 }}>{g.items.length} hesap{g.key === "credit_card" ? " · tahsilat kapalı" : ""}</Text>
                    <MovementNotices items={notices} testID={`account-group-${g.key}-moves`} />
                  </Pressable>
                );
              })}
              {activePartners.length ? (
                <Pressable
                  onPress={() => setTab("partners")}
                  testID="account-group-partners"
                  style={{
                    width: "100%",
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: accountGroupTone("partners").border,
                    backgroundColor: accountGroupTone("partners").bg,
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: "800", color: accountGroupTone("partners").label, textTransform: "uppercase" }}>Ortaklar</Text>
                  <Text style={{ fontWeight: "800", color: accountGroupTone("partners").amount, fontSize: 18 }}>{fmtMoney(partnerSummary?.total_balance)}</Text>
                  <Text style={{ fontSize: 11, color: accountGroupTone("partners").label, opacity: 0.8 }}>{activePartners.length} ortak</Text>
                  <MovementNotices items={partnerNotices} testID="account-group-partners-moves" />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {showAccountList ? <Field label="Ara" testID="bank-search" value={q} onChangeText={setQ} placeholder="Hesap / IBAN / kasa" /> : null}
          <ErrorBanner message={error} />
          {!showAccountList ? (
            !overviewGroups.length && !activePartners.length ? (
              <Empty icon="wallet-outline" title="Hesap yok" hint={canEdit ? "Banka, kasa, POS, kart veya ortak ekleyin." : undefined} />
            ) : null
          ) : !visibleGroups.length ? (
            <Empty icon="wallet-outline" title="Hesap yok" hint={canEdit ? "Banka, kasa, POS, kart veya ortak ekleyin." : undefined} />
          ) : (
            visibleGroups.map((g) => {
              const tone = accountGroupTone(g.key);
              const isCash = g.key === "cash_box";
              return g.items.map((a) => {
                const brand = resolveBankBrand(a);
                const branded = !isCash;
                return (
                <View
                  key={idOf(a)}
                  testID={`bank-group-item-${g.key}`}
                  style={{
                    backgroundColor: branded ? brand.bg : tone.bg,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: branded ? brand.border : tone.border,
                    paddingHorizontal: 8,
                  }}
                >
                  <ListRow
                    testID={`bank-row-${idOf(a)}`}
                    leading={isCash ? (
                      <View style={{ width: 8, height: 36, borderRadius: 4, backgroundColor: tone.accent }} />
                    ) : (
                      <BankMark brand={brand} />
                    )}
                    title={a.account_name || a.bank_name || "Hesap"}
                    subtitle={[
                      accountTypeTr(a.type),
                      a.iban || a.account_number,
                      a.bank_name,
                      a.is_integrated ? (a.integration_provider || "Entegre") : "",
                    ].filter(Boolean).join(" · ")}
                    right={fmtMoney(accountBalance(a), a.currency)}
                    rightColor={branded ? brand.text : undefined}
                    onPress={() => go("BankingAccount", { id: idOf(a), name: a.account_name || "" })}
                  />
                </View>
                );
              });
            })
          )}
        </>
      )}
    </Screen>
  );
}

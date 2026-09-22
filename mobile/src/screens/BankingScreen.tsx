import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles, type ActionTile } from "../components/ActionTiles";
import { Chip, confirmAction } from "../components/chips";
import { Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import {
  accountBalance,
  accountGroupTone,
  accountTypeTr,
  bankingFilterLabel,
  bankingListFilterKeys,
  filterPartners,
  groupedAccounts,
  isBankingBankAccount,
  totalLiquidity,
  virmanAccounts,
  type BankAccount,
  type Partner,
  type PartnerSummary,
} from "../utils/finance";
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
  const [tab, setTab] = useState<"accounts" | "banks" | "partners" | "match">("accounts");
  const [rows, setRows] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerSummary, setPartnerSummary] = useState<PartnerSummary | null>(null);
  const [approvals, setApprovals] = useState<CashApproval[]>([]);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [q, setQ] = useState("");
  const [groupF, setGroupF] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [accs, pts, ps, appr, unmatched] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
        get<PartnerSummary>(client, "/banking/partners/summary", { company_id: companyId }).catch(() => null),
        get<CashApproval[]>(client, "/banking/cash-approvals", { company_id: companyId, status: "pending" }).catch(() => []),
        get<unknown[]>(client, "/banking/transactions/unmatched", { company_id: companyId }).catch(() => []),
      ]);
      setRows(accs || []);
      setPartners(pts || []);
      setPartnerSummary(ps);
      setApprovals(appr || []);
      setUnmatchedCount((unmatched || []).length);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Hesaplar yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pool = useMemo(
    () => (tab === "banks" ? rows.filter(isBankingBankAccount) : rows),
    [rows, tab]
  );
  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pool;
    return pool.filter((a) => [a.account_name, a.bank_name, a.iban, a.account_number, a.type, a.integration_provider].some((v) => String(v || "").toLowerCase().includes(s)));
  }, [q, pool]);

  const groups = useMemo(() => groupedAccounts(searched), [searched]);
  const poolGroups = useMemo(() => groupedAccounts(pool), [pool]);
  const visibleGroups = groupF === "all" ? groups : groupF === "partners" ? [] : groups.filter((g) => g.key === groupF);
  const liquidity = totalLiquidity(rows);
  const activePartners = useMemo(() => (partners || []).filter((p) => p.is_active !== false), [partners]);
  const searchedPartners = useMemo(() => filterPartners(activePartners, q), [activePartners, q]);
  const showPartnersInList = groupF === "all" || groupF === "partners";
  const listPartners = showPartnersInList ? searchedPartners : [];
  const filterKeys = useMemo(
    () => bankingListFilterKeys(poolGroups.map((g) => g.key), activePartners.length > 0),
    [activePartners.length, poolGroups],
  );
  const bankCount = useMemo(() => rows.filter(isBankingBankAccount).length, [rows]);
  const virmanOk = virmanAccounts(rows).length + activePartners.length > 1;

  const actions: ActionTile[] = [
    canEdit && { key: "new", label: "Yeni hesap", icon: "add-circle" as const, tone: "emerald" as const, testID: "bank-new", onPress: () => go("BankingNew") },
    canEdit && virmanOk && { key: "virman", label: "Virman", icon: "swap-horizontal" as const, tone: "indigo" as const, testID: "bank-virman", onPress: () => go("BankingVirman") },
    { key: "partners", label: "Ortaklar", icon: "people" as const, tone: "amber" as const, testID: "bank-partners-tile", onPress: () => setTab("partners") },
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
      <Row style={{ flexWrap: "wrap" }}>
        <Chip label="Hesaplar" active={tab === "accounts"} testID="banking-tab-accounts" onPress={() => { setTab("accounts"); setGroupF("all"); }} />
        <Chip label={`Bankalar${bankCount ? ` (${bankCount})` : ""}`} active={tab === "banks"} testID="banking-tab-banks" onPress={() => { setTab("banks"); setGroupF("all"); }} />
        <Chip label={`Ortaklar${partnerSummary?.partner_count ? ` (${partnerSummary.partner_count})` : ""}`} active={tab === "partners"} testID="banking-tab-partners" color="#B45309" onPress={() => setTab("partners")} />
        <Chip label={`Eşleşme${unmatchedCount ? ` (${unmatchedCount})` : ""}`} active={tab === "match"} testID="banking-tab-match" color="#7C3AED" onPress={() => setTab("match")} />
      </Row>

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
          <View style={{ gap: 8 }} testID="account-groups-stack">
            {groups.map((g) => {
              const total = g.items.reduce((s, a) => s + accountBalance(a), 0);
              const active = groupF === g.key;
              const tone = accountGroupTone(g.key);
              return (
                <Pressable
                  key={g.key}
                  onPress={() => setGroupF(active ? "all" : g.key)}
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
                </Pressable>
              );
            })}
            {activePartners.length ? (
              <Pressable
                onPress={() => setGroupF(groupF === "partners" ? "all" : "partners")}
                testID="account-group-partners"
                style={{
                  width: "100%",
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: groupF === "partners" ? accountGroupTone("partners").accent : accountGroupTone("partners").border,
                  backgroundColor: accountGroupTone("partners").bg,
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: "800", color: accountGroupTone("partners").label, textTransform: "uppercase" }}>Ortaklar</Text>
                <Text style={{ fontWeight: "800", color: accountGroupTone("partners").amount, fontSize: 18 }}>{fmtMoney(partnerSummary?.total_balance)}</Text>
                <Text style={{ fontSize: 11, color: accountGroupTone("partners").label, opacity: 0.8 }}>{activePartners.length} ortak</Text>
              </Pressable>
            ) : null}
          </View>
          <Field label="Ara" testID="bank-search" value={q} onChangeText={setQ} placeholder="Hesap / IBAN / kasa" />
          <Row style={{ flexWrap: "wrap" }} testID="bank-filter-row">
            {filterKeys.map((key) => (
              <Chip
                key={key}
                label={bankingFilterLabel(key)}
                active={groupF === key}
                testID={`bank-filter-${key}`}
                color={key === "partners" ? accountGroupTone("partners").accent : key === "bank" ? accountGroupTone("bank").accent : undefined}
                onPress={() => setGroupF(groupF === key && key !== "all" ? "all" : key)}
              />
            ))}
          </Row>
          <ErrorBanner message={error} />
          {groupF === "partners" && !listPartners.length ? (
            <Empty icon="people-outline" title="Ortak yok" />
          ) : !visibleGroups.length && !listPartners.length ? (
            <Empty icon="wallet-outline" title="Hesap yok" hint={canEdit ? "Banka, kasa, POS, kart veya ortak ekleyin." : undefined} />
          ) : (
            <>
          {visibleGroups.map((g) => {
            const tone = accountGroupTone(g.key);
            const isCash = g.key === "cash_box";
            return (
              <React.Fragment key={g.key}>
                <Text style={{ fontWeight: "800", color: tone.label, marginTop: 8 }} testID={`bank-group-label-${g.key}`}>{g.label}</Text>
                {g.items.map((a) => (
                  <View
                    key={idOf(a)}
                    style={isCash ? {
                      backgroundColor: tone.bg,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: tone.border,
                      paddingHorizontal: 8,
                    } : undefined}
                  >
                    <ListRow
                      testID={`bank-row-${idOf(a)}`}
                      leading={isCash ? (
                        <View style={{ width: 8, height: 36, borderRadius: 4, backgroundColor: tone.accent }} />
                      ) : undefined}
                      title={a.account_name || a.bank_name || "Hesap"}
                      subtitle={[
                        accountTypeTr(a.type),
                        a.iban || a.account_number,
                        a.bank_name,
                        a.is_integrated ? (a.integration_provider || "Entegre") : "",
                      ].filter(Boolean).join(" · ")}
                      right={fmtMoney(accountBalance(a), a.currency)}
                      onPress={() => go("BankingAccount", { id: idOf(a), name: a.account_name || "" })}
                    />
                  </View>
                ))}
              </React.Fragment>
            );
          })}
              {listPartners.length ? (
                <>
                  <Text style={{ fontWeight: "800", color: accountGroupTone("partners").label, marginTop: 8 }} testID="bank-group-label-partners">Ortaklar Hesabı</Text>
                  {listPartners.map((p) => {
                    const tone = accountGroupTone("partners");
                    return (
                      <View
                        key={idOf(p)}
                        style={{
                          backgroundColor: tone.bg,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: tone.border,
                          paddingHorizontal: 8,
                        }}
                      >
                        <ListRow
                          testID={`bank-partner-row-${idOf(p)}`}
                          leading={<View style={{ width: 8, height: 36, borderRadius: 4, backgroundColor: tone.accent }} />}
                          title={p.name || "Ortak"}
                          subtitle={[`%${p.share_percent ?? 0}`, p.phone, p.email].filter(Boolean).join(" · ")}
                          right={fmtMoney(p.balance)}
                          onPress={() => setTab("partners")}
                        />
                      </View>
                    );
                  })}
                </>
              ) : null}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

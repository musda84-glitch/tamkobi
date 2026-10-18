import { useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles, type ActionTile } from "../components/ActionTiles";
import { BankMark } from "../components/BankMark";
import { confirmAction } from "../components/chips";
import { Card, Empty, ErrorBanner, Field, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { TabStrip } from "../components/TabStrip";
import { useLiveRefresh } from "../live/useLiveRefresh";
import { go } from "../nav";
import { colors } from "../theme";
import {
  accountBalance,
  accountGroupTone,
  accountMaskedRef,
  groupedAccounts,
  isBankingBankAccount,
  isBankingCashAccount,
  isBankingPosAccount,
  partnerSummaryCardMeta,
  sumShownBalances,
  totalLiquidity,
  virmanAccounts,
  type BankAccount,
  type Partner,
  type PartnerSummary,
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

const GROUP_SHORT: Record<string, string> = {
  bank: "BANKA",
  pos: "POS",
  okc_pos: "ÖKC",
  cash_box: "KASA",
  credit_card: "KART",
  other: "DİĞER",
};

const GROUP_ORDER = ["bank", "pos", "cash_box", "okc_pos", "credit_card", "other"];

function groupRank(key: string): number {
  const index = GROUP_ORDER.indexOf(key);
  return index < 0 ? GROUP_ORDER.length : index;
}

function integrationBadge(account: BankAccount): "CANLI" | "API" | null {
  if (!account.is_integrated) return null;
  return account.integration_status === "connected" ? "CANLI" : "API";
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

type BankingTab = "all" | "cash" | "banks" | "partners" | "pos" | "match";
const BANKING_TABS: BankingTab[] = ["all", "cash", "banks", "partners", "pos", "match"];

function bankingTabFromParam(raw?: string | string[] | null): BankingTab | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return BANKING_TABS.includes(v as BankingTab) ? (v as BankingTab) : null;
}

export function BankingScreen() {
  const { client, companyId, can } = useAuth();
  const params = useLocalSearchParams<{ tab?: string | string[]; account_id?: string | string[]; account?: string | string[]; tx?: string | string[] }>();
  const firstParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) || "";
  const focusAccountId = firstParam(params.account_id);
  const focusAccountName = firstParam(params.account);
  const focusTxId = firstParam(params.tx);
  const canEdit = can("/banking", "edit");
  const [tab, setTab] = useState<BankingTab>("all");
  const [rows, setRows] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerSummary, setPartnerSummary] = useState<PartnerSummary | null>(null);
  const [approvals, setApprovals] = useState<CashApproval[]>([]);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [q, setQ] = useState("");
  const [groupF, setGroupF] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [partnerDock, setPartnerDock] = useState<React.ReactNode>(null);
  const accountsReady = useRef(false);

  useEffect(() => {
    const next = bankingTabFromParam(params.tab);
    if (next) setTab(next);
    else if (focusTxId) setTab("match");
  }, [params.tab, focusTxId]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [accs, pts, ps, appr, unmatched] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId, with_month: 1 }),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
        get<PartnerSummary>(client, "/banking/partners/summary", { company_id: companyId }).catch(() => null),
        get<CashApproval[]>(client, "/banking/cash-approvals", { company_id: companyId, status: "pending" }).catch(() => []),
        get<unknown[]>(client, "/banking/transactions/unmatched", { company_id: companyId }).catch(() => []),
      ]);
      setRows(accs || []);
      accountsReady.current = true;
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

  useEffect(() => {
    if (!accountsReady.current || refreshing || !focusAccountName || focusAccountId) return;
    const needle = focusAccountName.toLocaleLowerCase("tr-TR");
    const hit = rows.some((a) => String(a.account_name || "").toLocaleLowerCase("tr-TR").includes(needle));
    if (hit) return;
    setError("Kayıt bulunamadı");
  }, [rows, refreshing, focusAccountName, focusAccountId]);
  useLiveRefresh(load, ["cash", "contacts"]);

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
  const bankCount = useMemo(() => rows.filter(isBankingBankAccount).length, [rows]);
  const cashCount = useMemo(() => rows.filter(isBankingCashAccount).length, [rows]);
  const posCount = useMemo(() => rows.filter(isBankingPosAccount).length, [rows]);
  const summaryGroups = useMemo(
    () => [...overviewGroups].sort((a, b) => groupRank(a.key) - groupRank(b.key)),
    [overviewGroups],
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
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyBottom={tab === "partners" ? partnerDock : undefined}
    >
      {tab !== "partners" && tab !== "match" ? <Field label="Ara" testID="bank-search" value={q} onChangeText={setQ} placeholder="Hesap / IBAN / kasa" /> : null}
      <TabStrip
        testID="banking-tab"
        variant="icons"
        value={tab}
        onChange={(key) => { setTab(key); setGroupF("all"); setPartnerDock(null); }}
        items={[
          { key: "all", label: "Tümü", icon: "apps", color: colors.primary },
          { key: "cash", label: "Kasa", icon: "wallet", color: accountGroupTone("cash_box").accent, count: cashCount || undefined },
          { key: "banks", label: "Bankalar", icon: "business", color: accountGroupTone("bank").accent, count: bankCount || undefined },
          { key: "partners", label: "Ortaklar", icon: "people", color: accountGroupTone("partners").accent, count: partnerSummary?.partner_count || undefined },
          { key: "pos", label: "POS", icon: "card", color: accountGroupTone("pos").accent, count: posCount || undefined },
        ]}
      />

      {tab === "partners" ? (
        <BankingPartnersPanel accounts={rows} onChanged={load} onSelectedDock={setPartnerDock} />
      ) : tab === "match" ? (
        <BankingMatchPanel
          accounts={rows}
          onChanged={load}
          focusAccountId={focusAccountId || idOf(rows.find((a) => focusAccountName && String(a.account_name || "").toLocaleLowerCase("tr-TR").includes(focusAccountName.toLocaleLowerCase("tr-TR"))))}
          focusTxId={focusTxId}
        />
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
                  <Text style={{ fontWeight: "700", color: partnerSummaryCardMeta(partnerSummary).color }}>
                    {fmtMoney(partnerSummaryCardMeta(partnerSummary).display)} {partnerSummaryCardMeta(partnerSummary).label}
                  </Text>
                </Row>
              </Pressable>
            ) : null}
          </Card>
          <Approvals items={approvals} onAct={actApproval} />
          {tab === "all" && !searching ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              testID="account-groups-stack"
              contentContainerStyle={{ gap: 8, paddingRight: 4 }}
            >
              {summaryGroups.map((g) => {
                const total = sumShownBalances(g.items);
                const tone = accountGroupTone(g.key);
                return (
                  <Pressable
                    key={g.key}
                    onPress={() => {
                      if (g.key === "bank") { setTab("banks"); setGroupF("all"); return; }
                      if (g.key === "pos") { setTab("pos"); setGroupF("all"); return; }
                      if (g.key === "cash_box") { setTab("cash"); setGroupF("all"); return; }
                      setGroupF(groupF === g.key ? "all" : g.key);
                    }}
                    testID={`account-group-${g.key}`}
                    style={{
                      width: 156,
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: tone.border,
                      backgroundColor: tone.bg,
                    }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: "800", color: tone.label }}>{GROUP_SHORT[g.key] || g.label}</Text>
                    <Text style={{ fontWeight: "800", color: tone.amount, fontSize: 16 }}>{fmtMoney(total)}</Text>
                    <Text style={{ fontSize: 11, color: tone.label }}>{g.items.length} hesap</Text>
                  </Pressable>
                );
              })}
              {activePartners.length ? (
                <Pressable
                  onPress={() => setTab("partners")}
                  testID="account-group-partners"
                  style={{
                    width: 156,
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: accountGroupTone("partners").border,
                    backgroundColor: accountGroupTone("partners").bg,
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: "800", color: accountGroupTone("partners").label }}>ORTAKLAR</Text>
                  <Text style={{ fontWeight: "800", color: partnerSummaryCardMeta(partnerSummary).color, fontSize: 16 }}>{fmtMoney(partnerSummaryCardMeta(partnerSummary).display)}</Text>
                  <Text style={{ fontSize: 11, color: accountGroupTone("partners").label }}>{activePartners.length} ortak</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          ) : null}
          <ErrorBanner message={error} />
          {!visibleGroups.length ? (
            !activePartners.length ? (
              <Empty icon="wallet-outline" title="Hesap yok" hint={canEdit ? "Banka, kasa, POS, kart veya ortak ekleyin." : undefined} />
            ) : null
          ) : (
            visibleGroups.map((g) => (
              <View key={g.key} style={{ gap: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: "800", color: colors.muted, letterSpacing: 0.4 }}>
                  {GROUP_SHORT[g.key] || g.label} · {g.items.length}
                </Text>
                {g.items.map((a) => {
                  const brand = resolveBankBrand(a);
                  const id = idOf(a);
                  const meta = [accountMaskedRef(a), a.is_integrated ? "entegre" : ""].filter(Boolean).join(" · ");
                  const badge = integrationBadge(a);
                  const unmatched = Number(a.unmatched_count) || 0;
                  return (
                    <Pressable
                      key={id}
                      testID={`bank-row-${id}`}
                      onPress={() => go("BankingAccount", { id, name: a.account_name || "" })}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        backgroundColor: "#fff",
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: brand.border,
                        padding: 12,
                      }}
                    >
                      <BankMark brand={brand} />
                      <View style={{ flex: 1, minWidth: 0 }} testID={`bank-group-item-${g.key}`}>
                        <Text numberOfLines={1} style={{ fontWeight: "800", color: colors.text }}>{a.account_name || a.bank_name || "Hesap"}</Text>
                        {meta ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{meta}</Text> : null}
                        <Text style={{ color: brand.text, fontWeight: "800", fontSize: 13 }}>{fmtMoney(accountBalance(a), a.currency)}</Text>
                      </View>
                      {badge ? (
                        <View style={{ backgroundColor: badge === "CANLI" ? "#D1FAE5" : "#EEF2FF", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ color: badge === "CANLI" ? "#047857" : "#3730A3", fontSize: 10, fontWeight: "800" }}>{badge}</Text>
                        </View>
                      ) : null}
                      {unmatched > 0 ? (
                        <View testID={`bank-unmatched-${id}`} style={{ minWidth: 22, borderRadius: 999, backgroundColor: "#F59E0B", paddingHorizontal: 6, paddingVertical: 2, alignItems: "center" }}>
                          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>{unmatched}</Text>
                        </View>
                      ) : null}
                      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                    </Pressable>
                  );
                })}
              </View>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

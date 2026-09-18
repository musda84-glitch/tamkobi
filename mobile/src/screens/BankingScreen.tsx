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
  accountTypeTr,
  groupedAccounts,
  totalLiquidity,
  virmanAccounts,
  type BankAccount,
  type PartnerSummary,
} from "../utils/finance";
import { fmtMoney, idOf } from "../utils/money";
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
  const [tab, setTab] = useState<"accounts" | "partners">("accounts");
  const [rows, setRows] = useState<BankAccount[]>([]);
  const [partnerSummary, setPartnerSummary] = useState<PartnerSummary | null>(null);
  const [approvals, setApprovals] = useState<CashApproval[]>([]);
  const [q, setQ] = useState("");
  const [groupF, setGroupF] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [accs, ps, appr] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<PartnerSummary>(client, "/banking/partners/summary", { company_id: companyId }).catch(() => null),
        get<CashApproval[]>(client, "/banking/cash-approvals", { company_id: companyId, status: "pending" }).catch(() => []),
      ]);
      setRows(accs || []);
      setPartnerSummary(ps);
      setApprovals(appr || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Hesaplar yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((a) => [a.account_name, a.bank_name, a.iban, a.account_number, a.type, a.integration_provider].some((v) => String(v || "").toLowerCase().includes(s)));
  }, [q, rows]);

  const groups = useMemo(() => groupedAccounts(searched), [searched]);
  const visibleGroups = groupF === "all" ? groups : groups.filter((g) => g.key === groupF);
  const liquidity = totalLiquidity(rows);
  const virmanOk = virmanAccounts(rows).length > 1;

  const actions: ActionTile[] = [
    canEdit && { key: "new", label: "Yeni hesap", icon: "add-circle" as const, tone: "emerald" as const, testID: "bank-new", onPress: () => go("BankingNew") },
    canEdit && virmanOk && { key: "virman", label: "Virman", icon: "swap-horizontal" as const, tone: "indigo" as const, testID: "bank-virman", onPress: () => go("BankingVirman") },
    { key: "partners", label: "Ortaklar", icon: "people" as const, tone: "amber" as const, testID: "bank-partners-tile", onPress: () => setTab("partners") },
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
        <Chip label="Hesaplar" active={tab === "accounts"} testID="banking-tab-accounts" onPress={() => setTab("accounts")} />
        <Chip label={`Ortaklar${partnerSummary?.partner_count ? ` (${partnerSummary.partner_count})` : ""}`} active={tab === "partners"} testID="banking-tab-partners" color="#B45309" onPress={() => setTab("partners")} />
      </Row>

      {tab === "partners" ? (
        <BankingPartnersPanel accounts={rows} onChanged={load} />
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
          <Row style={{ flexWrap: "wrap" }}>
            {groups.map((g) => {
              const total = g.items.reduce((s, a) => s + accountBalance(a), 0);
              const active = groupF === g.key;
              return (
                <Pressable
                  key={g.key}
                  onPress={() => setGroupF(active ? "all" : g.key)}
                  testID={`account-group-${g.key}`}
                  style={{
                    flexGrow: 1,
                    flexBasis: "30%",
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.emerald50 : colors.surface,
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: "700", color: colors.muted, textTransform: "uppercase" }}>{g.label}</Text>
                  <Text style={{ fontWeight: "800", color: colors.text, fontSize: 14 }}>{fmtMoney(total)}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{g.items.length} hesap{g.key === "credit_card" ? " · tahsilat kapalı" : ""}</Text>
                </Pressable>
              );
            })}
          </Row>
          <Field label="Ara" testID="bank-search" value={q} onChangeText={setQ} placeholder="Hesap / IBAN / kasa" />
          <Row style={{ flexWrap: "wrap" }}>
            <Chip label="Tümü" active={groupF === "all"} testID="bank-filter-all" onPress={() => setGroupF("all")} />
            {groups.map((g) => (
              <Chip key={g.key} label={g.label} active={groupF === g.key} testID={`bank-filter-${g.key}`} onPress={() => setGroupF(g.key)} />
            ))}
          </Row>
          <ErrorBanner message={error} />
          {!visibleGroups.length ? (
            <Empty icon="wallet-outline" title="Hesap yok" hint={canEdit ? "Banka, kasa, POS veya kart ekleyin." : undefined} />
          ) : visibleGroups.map((g) => (
            <React.Fragment key={g.key}>
              <Text style={{ fontWeight: "800", color: colors.text, marginTop: 8 }} testID={`bank-group-label-${g.key}`}>{g.label}</Text>
              {g.items.map((a) => (
                <ListRow
                  key={idOf(a)}
                  testID={`bank-row-${idOf(a)}`}
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
              ))}
            </React.Fragment>
          ))}
        </>
      )}
    </Screen>
  );
}

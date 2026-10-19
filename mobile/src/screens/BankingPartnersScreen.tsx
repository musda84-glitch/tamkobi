import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { Chip, n } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { MoneyInput } from "../components/MoneyInput";
import { Card, Empty, ErrorBanner, Field, Muted, PrimaryButton, Row } from "../components/kit";
import { PartnerAvatar } from "../components/PartnerAvatar";
import { PartnerDetail } from "../components/PartnerDetail";
import { PartnerTxSheet } from "../components/PartnerTxSheet";
import { useLiveRefresh } from "../live/useLiveRefresh";
import { go } from "../nav";
import { colors } from "../theme";
import {
  emptyProjectExpenseDraft,
  expenseCalc,
  expenseCategoryGroups,
  expensePayload,
  partnerBalanceMeta,
  partnerCardCashFlow,
  partnerCardTone,
  partnerSummaryCardMeta,
  validateExpenseDraft,
  type BankAccount,
  type ExpenseCategory,
  type ExpenseDraft,
  type Partner,
  type PartnerSummary,
  type PartnerTx,
} from "../utils/finance";
import { fmtMoney, idOf, todayIso } from "../utils/money";

export function BankingPartnersPanel({
  accounts,
  onChanged,
  onSelectedDock,
}: {
  accounts: BankAccount[];
  onChanged: () => void;
  onSelectedDock?: (node: React.ReactNode | null) => void;
}) {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const canExp = can("/expenses", "edit");
  const [partners, setPartners] = useState<Partner[]>([]);
  const [summary, setSummary] = useState<PartnerSummary | null>(null);
  const [txs, setTxs] = useState<PartnerTx[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openPartner, setOpenPartner] = useState<string | null>(null);
  const [txOpen, setTxOpen] = useState(false);
  const [expOpen, setExpOpen] = useState(false);
  const [expBusy, setExpBusy] = useState(false);
  const [expPartner, setExpPartner] = useState<{ id: string; name: string } | null>(null);
  const [expDraft, setExpDraft] = useState<ExpenseDraft>(emptyProjectExpenseDraft(todayIso()));
  const [expCats, setExpCats] = useState<ExpenseCategory[]>([]);

  const load = useCallback(async () => {
    try {
      const [p, s, t] = await Promise.all([
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }),
        get<PartnerSummary>(client, "/banking/partners/summary", { company_id: companyId }),
        get<PartnerTx[]>(client, "/banking/partners/transactions", { company_id: companyId }),
      ]);
      setPartners(p || []);
      setSummary(s);
      setTxs(t || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Ortak verileri yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["cash"]);

  const openPartnerExpense = useCallback((pid: string, name: string) => {
    if (!canExp || !pid) return;
    setExpPartner({ id: pid, name });
    setExpDraft({ ...emptyProjectExpenseDraft(todayIso()), account_id: `partner:${pid}` });
    setExpOpen(true);
    get<ExpenseCategory[]>(client, "/expenses/categories", { company_id: companyId })
      .then((cats) => setExpCats(Array.isArray(cats) ? cats : []))
      .catch(() => undefined);
  }, [canExp, client, companyId]);

  const selected = partners.find((p) => idOf(p) === openPartner) || null;

  useEffect(() => {
    if (openPartner && !partners.some((p) => idOf(p) === openPartner)) setOpenPartner(null);
  }, [partners, openPartner]);

  useLayoutEffect(() => {
    onSelectedDock?.(null);
  }, [onSelectedDock, openPartner]);

  useEffect(() => () => onSelectedDock?.(null), [onSelectedDock]);

  const savePartnerExpense = async () => {
    if (!expPartner || !canExp) return;
    const invalid = validateExpenseDraft(expDraft);
    if (invalid) { setError(invalid); return; }
    setExpBusy(true);
    try {
      await post(client, "/expenses", expensePayload(expDraft, companyId));
      setExpOpen(false);
      setExpPartner(null);
      setMessage(`${expPartner.name} kasasından masraf kaydedildi.`);
      setError(null);
      await load();
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "Masraf kaydedilemedi."));
    } finally {
      setExpBusy(false);
    }
  };

  const afterChange = async (text?: string) => {
    if (text) {
      setMessage(text);
      setError(null);
    }
    await load();
    onChanged();
  };

  const card = summary ? partnerSummaryCardMeta(summary) : null;
  const received = summary
    ? (summary.total_cash_in != null ? summary.total_cash_in : (summary.total_capital_in || 0))
    : 0;
  const paid = summary
    ? (summary.total_cash_out != null ? summary.total_cash_out : (summary.total_withdrawn || 0))
    : 0;

  return (
    <View testID="partners-panel" style={{ gap: 16 }}>
      <ErrorBanner message={error} />
      {!selected && message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}

      {selected ? (
        <View testID="partners-selected-dock">
          <PartnerDetail
            partner={selected}
            accounts={accounts}
            txs={txs}
            partners={partners}
            onBack={() => setOpenPartner(null)}
            onExpense={() => openPartnerExpense(idOf(selected), selected.name || "Ortak")}
            onChanged={() => afterChange()}
            onMessage={setMessage}
          />
        </View>
      ) : (
        <>
          {card ? (
            <View
              testID="partners-summary"
              style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 10 }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ color: colors.muted, fontWeight: "700" }}>Toplam aldığı</Text>
                <Text style={{ color: "#059669", fontWeight: "800" }}>{fmtMoney(received)}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ color: colors.muted, fontWeight: "700" }}>Toplam ödediği</Text>
                <Text style={{ color: "#E11D48", fontWeight: "800" }}>{fmtMoney(paid)}</Text>
              </View>
              <View
                testID="partners-summary-net"
                style={{ borderRadius: 12, padding: 10, backgroundColor: "#F8FAFC", flexDirection: "row", justifyContent: "space-between", gap: 8 }}
              >
                <Text style={{ color: card.color, fontWeight: "800" }}>{`NET · ${card.label}`}</Text>
                <Text style={{ color: card.color, fontWeight: "800" }}>{fmtMoney(card.display)}</Text>
              </View>
            </View>
          ) : null}

          <Text style={{ fontWeight: "800", color: colors.text }}>{`ORTAKLAR · ${partners.length}`}</Text>
          {!partners.length ? (
            <Empty icon="people-outline" title="Henüz ortak yok" hint="Ortak eklemek için web panelini kullanın." />
          ) : partners.map((partner) => {
            const pid = idOf(partner);
            const tone = partnerCardTone(pid || partner.name || "");
            const flow = partnerCardCashFlow(partner, txs, pid);
            const meta = partnerBalanceMeta(partner.balance);
            return (
              <Pressable
                key={pid}
                testID={`partner-row-${pid}`}
                onPress={() => setOpenPartner(pid)}
                style={{
                  backgroundColor: "#fff",
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 14,
                  padding: 12,
                }}
              >
                <View testID={`partner-card-${partner.name}`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View testID={`partner-card-toggle-${partner.name}`} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <PartnerAvatar
                      name={partner.name}
                      photoUrl={partner.photo_url}
                      tone={tone}
                      size={44}
                      testID={`partner-avatar-${pid}`}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontWeight: "800", color: colors.text }}>{partner.name}</Text>
                      <Text testID={`partner-flow-${pid}`} style={{ color: colors.muted, fontSize: 12 }}>
                        {`${flow.receivedLabel} ${fmtMoney(flow.giris)} · ${flow.paidLabel} ${fmtMoney(flow.cikis)}`}
                      </Text>
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text testID={`partner-balance-${pid}`} style={{ fontWeight: "800", color: meta.color }}>{fmtMoney(meta.display)}</Text>
                    <Text testID={`partner-badge-${pid}`} style={{ fontSize: 11, fontWeight: "800", color: meta.color }}>{meta.badge}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </View>
              </Pressable>
            );
          })}

          {canEdit ? (
            <Row>
              <PrimaryButton title="Para Giriş / Çıkış" onPress={() => setTxOpen(true)} color={colors.indigo} testID="partner-cash-btn" />
              <PrimaryButton title="Virman" onPress={() => go("BankingVirman")} color={colors.secondary} testID="partner-virman-btn" />
            </Row>
          ) : null}
        </>
      )}

      <PartnerTxSheet
        visible={txOpen && !selected}
        onClose={() => setTxOpen(false)}
        partners={partners}
        accounts={accounts}
        lockPartner={false}
        lockType={false}
        onSaved={(text) => afterChange(text)}
      />

      <B2BSheet
        visible={expOpen}
        title="Masraf ekle"
        subtitle={expPartner ? `${expPartner.name} · Ortaklar Hesabı` : undefined}
        onClose={() => { setExpOpen(false); setExpPartner(null); }}
        testID="partner-expense-modal"
      >
        <Field label="Tarih" testID="partner-exp-date" value={expDraft.date} onChangeText={(v) => setExpDraft((d) => ({ ...d, date: v }))} placeholder="YYYY-MM-DD" />
        <GroupedSelect
          label="Kategori"
          testID="partner-exp-category"
          value={expDraft.category}
          onChange={(v) => setExpDraft((d) => ({ ...d, category: v }))}
          groups={expenseCategoryGroups(expCats, [expDraft.category])}
        />
        <Field label="Açıklama" testID="partner-exp-description" value={expDraft.description} onChangeText={(v) => setExpDraft((d) => ({ ...d, description: v }))} placeholder="Örn: Ofis malzemesi" />
        <MoneyInput label="Tutar (₺)" testID="partner-exp-amount" value={expDraft.amount} onChange={(n) => setExpDraft((d) => ({ ...d, amount: n ?? "" }))} />
        <Muted>KDV %</Muted>
        <Row style={{ justifyContent: "space-between" }}>
          <Row style={{ flexShrink: 1 }}>
            {[0, 1, 10, 20].map((v) => (
              <Chip key={v} label={`%${v}`} active={n(expDraft.vat_rate) === v} onPress={() => setExpDraft((d) => ({ ...d, vat_rate: String(v) }))} />
            ))}
          </Row>
          <Chip
            compact
            label="Tutar KDV dahil"
            active={expDraft.vat_included}
            onPress={() => setExpDraft((d) => ({ ...d, vat_included: !d.vat_included }))}
            testID="partner-exp-vat-included"
          />
        </Row>
        <Card>
          <Row style={{ justifyContent: "space-between" }}><Muted>Toplam</Muted><Text style={{ fontWeight: "800", color: colors.danger }}>{fmtMoney(expenseCalc(expDraft).total)}</Text></Row>
        </Card>
        <Muted>Ödeme {expPartner?.name || "ortak"} kasasından düşülür.</Muted>
        <Field label="Not" testID="partner-exp-notes" value={expDraft.notes} onChangeText={(v) => setExpDraft((d) => ({ ...d, notes: v }))} />
        <PrimaryButton
          title={expBusy ? "Kaydediliyor…" : "Masrafı kaydet"}
          color={colors.danger}
          loading={expBusy}
          onPress={savePartnerExpense}
          testID="partner-exp-save"
        />
      </B2BSheet>
    </View>
  );
}

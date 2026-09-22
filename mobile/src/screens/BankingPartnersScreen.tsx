import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { Chip, n } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row, StatRows } from "../components/kit";
import { PartnerAvatar } from "../components/PartnerAvatar";
import { colors } from "../theme";
import {
  emptyProjectExpenseDraft,
  expenseCalc,
  expenseCategoryGroups,
  expensePayload,
  filterPartnerTxs,
  partnerCardTone,
  partnerTxTr,
  validateExpenseDraft,
  type BankAccount,
  type ExpenseCategory,
  type ExpenseDraft,
  type Partner,
  type PartnerSummary,
  type PartnerTx,
} from "../utils/finance";
import { fmtDate, fmtMoney, idOf, todayIso } from "../utils/money";

function PartnerCard({
  partner,
  open,
  docked,
  txs,
  canExp,
  onToggle,
  onExpense,
}: {
  partner: Partner;
  open: boolean;
  docked?: boolean;
  txs: PartnerTx[];
  canExp: boolean;
  onToggle: () => void;
  onExpense: () => void;
}) {
  const { height } = useWindowDimensions();
  const pid = idOf(partner);
  const tone = partnerCardTone(pid || partner.name || "");
  const mine = filterPartnerTxs(txs, pid);
  const moves = open ? (
    <View testID={`partner-moves-${pid}`} style={{ borderTopWidth: 1, borderTopColor: tone.border, paddingTop: 8, gap: 4 }}>
      <Text style={{ fontWeight: "800", color: tone.label }}>Hareketler</Text>
      {!mine.length ? (
        <Muted>Hareket yok.</Muted>
      ) : mine.slice(0, 40).map((tx) => (
        <ListRow
          key={idOf(tx)}
          testID={`partner-tx-${idOf(tx)}`}
          title={partnerTxTr(tx.type)}
          subtitle={[fmtDate(tx.date), tx.account_name, tx.description].filter(Boolean).join(" · ")}
          right={fmtMoney(tx.amount)}
          rightColor={tx.type === "withdrawal" ? colors.danger : colors.primary}
        />
      ))}
    </View>
  ) : null;

  return (
    <View
      testID={`partner-card-${partner.name}`}
      style={{
        backgroundColor: tone.bg,
        borderColor: open ? tone.accent : tone.border,
        borderWidth: 1,
        borderRadius: 16,
        padding: 14,
        gap: 8,
        maxHeight: docked ? Math.round(height * 0.52) : undefined,
      }}
    >
      <Pressable
        onPress={onToggle}
        testID={`partner-card-toggle-${partner.name}`}
        style={{ gap: 8 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <PartnerAvatar
            name={partner.name}
            photoUrl={partner.photo_url}
            tone={tone}
            size={56}
            testID={`partner-avatar-${pid}`}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontWeight: "800", color: tone.label }}>{partner.name}</Text>
            <Muted>{[partner.email, partner.phone, `%${partner.share_percent || 0}`].filter(Boolean).join(" · ")}</Muted>
          </View>
        </View>
        <Text style={{ fontSize: 20, fontWeight: "800", color: tone.amount }}>{fmtMoney(partner.balance)}</Text>
        <Muted>Giriş {fmtMoney(partner.total_capital_in)} · çekiş {fmtMoney(partner.total_withdrawn)} · kâr {fmtMoney(partner.total_profit_share)}</Muted>
      </Pressable>
      {canExp ? (
        <PrimaryButton
          title="Masraf ekle"
          onPress={onExpense}
          color={colors.danger}
          testID={`partner-expense-btn-${pid}`}
        />
      ) : null}
      {open && docked ? (
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: Math.round(height * 0.28) }}
        >
          {moves}
        </ScrollView>
      ) : moves}
    </View>
  );
}

export function BankingPartnersPanel({
  accounts: _accounts,
  onChanged,
  onSelectedDock,
}: {
  accounts: BankAccount[];
  onChanged: () => void;
  onSelectedDock?: (node: React.ReactNode | null) => void;
}) {
  const { client, companyId, can } = useAuth();
  const canExp = can("/expenses", "edit");
  const [partners, setPartners] = useState<Partner[]>([]);
  const [summary, setSummary] = useState<PartnerSummary | null>(null);
  const [txs, setTxs] = useState<PartnerTx[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openPartner, setOpenPartner] = useState<string | null>(null);
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
  const listed = selected ? partners.filter((p) => idOf(p) !== openPartner) : partners;

  useLayoutEffect(() => {
    if (!onSelectedDock) return;
    onSelectedDock(selected ? (
      <View testID="partners-selected-dock">
        <PartnerCard
          partner={selected}
          open
          docked
          txs={txs}
          canExp={canExp}
          onToggle={() => setOpenPartner(null)}
          onExpense={() => openPartnerExpense(idOf(selected), selected.name || "Ortak")}
        />
      </View>
    ) : null);
  }, [onSelectedDock, selected, txs, canExp, openPartnerExpense]);

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

  return (
    <View testID="partners-panel" style={{ gap: 16 }}>
      <Muted>Ortak bakiyesi ve hareketler. Ortak ekleme, para koy/çek ve kâr payı web panelinden yapılır.</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}
      {summary ? (
        <StatRows
          testID="partners-summary"
          items={[
            { key: "balance", label: "Ortak alacağı", value: fmtMoney(summary.total_balance) },
            { key: "capital", label: "Sermaye girişi", value: fmtMoney(summary.total_capital_in) },
            { key: "withdrawn", label: "Çekilen", value: fmtMoney(summary.total_withdrawn) },
            { key: "profit", label: "Dağıtılan kâr", value: fmtMoney(summary.total_profit_share) },
          ]}
        />
      ) : null}

      {!partners.length ? (
        <Empty icon="people-outline" title="Henüz ortak yok" hint="Ortak eklemek için web panelini kullanın." />
      ) : listed.map((p) => {
        const pid = idOf(p);
        return (
          <PartnerCard
            key={pid}
            partner={p}
            open={false}
            txs={txs}
            canExp={canExp}
            onToggle={() => setOpenPartner(pid)}
            onExpense={() => openPartnerExpense(pid, p.name || "Ortak")}
          />
        );
      })}

      {!openPartner ? (
        <>
          <Text style={{ fontWeight: "800", color: colors.text }}>Ortak hareketleri</Text>
          {!txs.length ? <Muted>Hareket yok.</Muted> : txs.slice(0, 40).map((tx) => (
            <ListRow
              key={idOf(tx)}
              title={`${partnerTxTr(tx.type)} · ${tx.partner_name || ""}`}
              subtitle={[fmtDate(tx.date), tx.account_name, tx.description].filter(Boolean).join(" · ")}
              right={fmtMoney(tx.amount)}
            />
          ))}
        </>
      ) : null}

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
        <Field label="Tutar (₺)" testID="partner-exp-amount" value={expDraft.amount} onChangeText={(v) => setExpDraft((d) => ({ ...d, amount: v }))} keyboardType="decimal-pad" />
        <Muted>KDV %</Muted>
        <Row>
          {[0, 1, 10, 20].map((v) => (
            <Chip key={v} label={`%${v}`} active={n(expDraft.vat_rate) === v} onPress={() => setExpDraft((d) => ({ ...d, vat_rate: String(v) }))} />
          ))}
        </Row>
        <Chip
          label="Tutar KDV dahil"
          active={expDraft.vat_included}
          onPress={() => setExpDraft((d) => ({ ...d, vat_included: !d.vat_included }))}
          testID="partner-exp-vat-included"
        />
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

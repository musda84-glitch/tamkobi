import { useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import React, { useCallback, useMemo, useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles, type ActionTile } from "../components/ActionTiles";
import { Chip, confirmAction, n } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Badge, Card, ErrorBanner, Field, H1, Kpi, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { invoiceTypeTr, riskStatusTr, statusTr } from "../utils/labels";
import { collectableAccounts, splitPaymentTarget } from "../utils/contactDraft";
import { paymentTargetGroups } from "../utils/finance";
import { balanceHint, contactInfoRows, contactSummaryRows, contactTypeLabel } from "../utils/contactDisplay";
import { balanceMessage, waDigits } from "../utils/contactStatement";
import { mapsLink } from "../utils/geo";
import {
  emptyPlanDraft,
  groupInstallments,
  installmentSummary,
  isLockedPayment,
  lockedPaymentLabel,
  paymentEditFrom,
  paymentEditPayload,
  planPayload,
  PLAN_INTERVALS,
  remainingOf,
  TERM_QUICK_DAYS,
  termsPayload,
  validatePaymentEdit,
  validatePlanDraft,
  type ContactPayment,
  type Installment,
  type PaymentEdit,
  type PlanDraft,
  type TermsDraft,
} from "../utils/installments";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import type { BankAccount } from "../utils/finance";

type Partner = { id?: string; _id?: string; name?: string; is_active?: boolean; balance?: number };
type PayForm = { type: "inflow" | "outflow"; amount: string; account_id: string; description: string };
type MsgChannel = "sms" | "email" | "whatsapp";
type TabKey = "invoices" | "payments" | "installments" | "orders" | "quotes" | "projects" | "surveys" | "comm" | "cheques";
type Aging = { total_remaining?: number; total_overdue?: number; total_late_fee?: number; rows?: { invoice_id?: string; invoice_number?: string; due_date?: string; remaining?: number; overdue_days?: number; late_fee?: number }[] };

const TABS: { key: TabKey; label: string }[] = [
  { key: "invoices", label: "Faturalar" },
  { key: "payments", label: "Ödemeler" },
  { key: "installments", label: "Taksitler" },
  { key: "orders", label: "Siparişler" },
  { key: "quotes", label: "Teklifler" },
  { key: "projects", label: "Projeler" },
  { key: "surveys", label: "Keşifler" },
  { key: "comm", label: "İletişim" },
  { key: "cheques", label: "Çek" },
];

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 11, textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: "600", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function ContactDetailScreen() {
  const { client, companyId, can } = useAuth();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const canEditContact = can("/contacts", "edit");
  const canInvoice = can("/invoices", "edit");
  const canBank = can("/banking", "edit");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("invoices");
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [payForm, setPayForm] = useState<PayForm | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgChannel, setMsgChannel] = useState<MsgChannel>("sms");
  const [msgPhone, setMsgPhone] = useState("");
  const [msgEmail, setMsgEmail] = useState("");
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [msgBusy, setMsgBusy] = useState(false);
  const [b2bBusy, setB2bBusy] = useState(false);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState<PlanDraft>(emptyPlanDraft());
  const [planBusy, setPlanBusy] = useState(false);
  const [instPay, setInstPay] = useState<{ row: Installment; amount: string; account_id: string } | null>(null);
  const [payEdit, setPayEdit] = useState<PaymentEdit | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [terms, setTerms] = useState<TermsDraft>({ days: "0", late_fee_rate: "0", apply_to_open_invoices: true });
  const [aging, setAging] = useState<Aging | null>(null);
  const [termsBusy, setTermsBusy] = useState(false);

  const loadCash = useCallback(async () => {
    const [accs, pars] = await Promise.all([
      get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }).catch(() => []),
      get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
    ]);
    setAccounts(accs || []);
    setPartners(pars || []);
    return { accounts: accs || [], partners: pars || [] };
  }, [client, companyId]);

  const loadInstallments = useCallback(async () => {
    const rows = await get<Installment[]>(client, "/installments", { company_id: companyId, contact_id: id }).catch(() => []);
    setInstallments(rows || []);
  }, [client, companyId, id]);

  const load = useCallback(async () => {
    try {
      const ov = await get<any>(client, `/contacts/${id}/overview`);
      setData(ov);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Cari detayı yüklenemedi."));
    }
    await loadInstallments();
  }, [client, id, loadInstallments]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const c = data?.contact || data || {};
  const summary = data?.summary || {};
  const hint = balanceHint(c.balance);
  const infoRows = useMemo(() => contactInfoRows(c), [c]);
  const summaryRows = useMemo(() => contactSummaryRows(summary), [summary]);
  const invoices = data?.invoices || [];
  const payments = data?.payments || [];
  const orders = data?.orders || [];
  const quotes = data?.quotes || [];
  const projects = data?.projects || [];
  const surveys = data?.surveys || [];
  const comms = data?.communications || [];
  const cheques = data?.cheques || [];
  const bal = Number(c.balance) || 0;
  const invoiced = Number(summary.total_invoiced) || 0;
  const paid = Number(summary.total_paid) || 0;
  const openAmt = Number(summary.open_amount) || 0;
  const chequeBal = Number(c.cheque_bond_balance) || 0;
  const instSummary = useMemo(() => installmentSummary(installments), [installments]);
  const instGroups = useMemo(() => groupInstallments(installments), [installments]);
  const hasBalancePlan = installments.some((r) => !r.invoice_id);
  const counts: Record<TabKey, number> = {
    invoices: invoices.length,
    payments: payments.length,
    installments: instSummary.pending,
    orders: orders.length,
    quotes: quotes.length,
    projects: projects.length,
    surveys: surveys.length,
    comm: comms.length,
    cheques: cheques.length,
  };

  const payPool = useMemo(
    () => paymentTargetGroups(accounts, partners, { collectableOnly: payForm?.type === "inflow" }),
    [accounts, partners, payForm?.type]
  );

  const openPay = async () => {
    if (!canBank) { setError("Tahsilat yetkiniz yok."); return; }
    try {
      const { accounts: accs, partners: pars } = await loadCash();
      const isIn = bal >= 0;
      const pool = isIn ? collectableAccounts(accs) : accs;
      const firstAcc = pool[0] ? idOf(pool[0]) : "";
      const firstPartner = pars.find((p) => p.is_active !== false);
      setPayForm({
        type: isIn ? "inflow" : "outflow",
        amount: Math.max(0, bal).toFixed(2),
        account_id: firstAcc || (firstPartner ? `partner:${idOf(firstPartner)}` : ""),
        description: isIn ? "Cari tahsilat" : "Cari ödeme",
      });
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Hesaplar yüklenemedi."));
    }
  };

  const savePay = async () => {
    if (!payForm) return;
    const amt = n(payForm.amount);
    if (!(amt > 0)) { setError("Geçerli bir tutar girin."); return; }
    if (!payForm.account_id) { setError("Kasa / banka / ortak seçin."); return; }
    setPayBusy(true);
    try {
      const target = splitPaymentTarget(payForm.account_id);
      if (target.partner_id) {
        await post(client, `/contacts/${id}/record-payment`, {
          partner_id: target.partner_id,
          type: payForm.type,
          amount: amt,
          description: payForm.description,
        });
      } else {
        const acc = accounts.find((a) => idOf(a) === target.account_id);
        await post(client, "/banking/transactions", {
          company_id: companyId,
          account_id: target.account_id,
          account_name: acc?.account_name,
          type: payForm.type,
          category: payForm.type === "inflow" ? "Cari Tahsilat" : "Cari Ödeme",
          amount: amt,
          currency: "TRY",
          description: `${c.name || name}: ${payForm.description}`,
          contact_id: id,
          contact_name: c.name || name,
          source: "manual",
        });
      }
      setPayForm(null);
      setMessage(payForm.type === "inflow" ? "Tahsilat kaydedildi." : "Ödeme kaydedildi.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Tahsilat kaydedilemedi."));
    } finally {
      setPayBusy(false);
    }
  };

  const openPlan = async () => {
    await loadCash();
    setPlan(emptyPlanDraft());
    setPlanOpen(true);
    setTab("installments");
  };

  const savePlan = async () => {
    const total = Math.abs(bal);
    const invalid = validatePlanDraft(plan, total);
    if (invalid) { setError(invalid); return; }
    setPlanBusy(true);
    try {
      await post(client, `/contacts/${id}/installments`, planPayload(plan, total));
      setPlanOpen(false);
      setMessage("Bakiye taksit planı oluşturuldu.");
      setError(null);
      await loadInstallments();
    } catch (err) {
      setError(apiErrorMessage(err, "Taksit planı oluşturulamadı."));
    } finally {
      setPlanBusy(false);
    }
  };

  const removePlan = () => {
    confirmAction("Taksit planı", "Açık bakiye taksit planı silinsin mi?", async () => {
      try {
        await del(client, `/contacts/${id}/installments`);
        setMessage("Taksit planı silindi.");
        setError(null);
        await loadInstallments();
      } catch (err) {
        setError(apiErrorMessage(err, "Taksit planı silinemedi."));
      }
    });
  };

  const openInstallmentPay = async (row: Installment) => {
    if (!canBank) { setError("Tahsilat yetkiniz yok."); return; }
    const { accounts: accs, partners: pars } = await loadCash();
    const pool = collectableAccounts(accs);
    const firstPartner = pars.find((p) => p.is_active !== false);
    setInstPay({
      row,
      amount: remainingOf(row).toFixed(2),
      account_id: pool[0] ? idOf(pool[0]) : firstPartner ? `partner:${idOf(firstPartner)}` : "",
    });
  };

  const payInstallment = async () => {
    if (!instPay) return;
    const amount = n(instPay.amount);
    if (!(amount > 0)) { setError("Geçerli bir tutar girin."); return; }
    setPayBusy(true);
    try {
      const target = splitPaymentTarget(instPay.account_id);
      const r = await post<{ message?: string }>(client, `/installments/${idOf(instPay.row)}/pay`, {
        amount,
        account_id: target.account_id,
        partner_id: target.partner_id,
      });
      setInstPay(null);
      setMessage(r?.message || "Taksit ödemesi kaydedildi.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Taksit ödemesi kaydedilemedi."));
    } finally {
      setPayBusy(false);
    }
  };

  const openPaymentEdit = async (p: ContactPayment) => {
    if (!canBank) { setError("Hareket düzenleme yetkiniz yok."); return; }
    await loadCash();
    setPayEdit(paymentEditFrom(p));
  };

  const savePaymentEdit = async () => {
    if (!payEdit) return;
    const invalid = validatePaymentEdit(payEdit);
    if (invalid) { setError(invalid); return; }
    setPayBusy(true);
    try {
      await put(client, `/banking/transactions/${payEdit.id}`, paymentEditPayload(payEdit));
      setPayEdit(null);
      setMessage("Hareket güncellendi.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Hareket güncellenemedi."));
    } finally {
      setPayBusy(false);
    }
  };

  const removePayment = (p: ContactPayment) => {
    if (!canBank) { setError("Hareket silme yetkiniz yok."); return; }
    confirmAction(
      "Hareketi sil",
      `${fmtMoney(p.amount)} tutarındaki ${p.type === "inflow" ? "tahsilat" : "ödeme"} silinsin mi? Bakiyeler geri alınır.`,
      async () => {
        try {
          await del(client, `/banking/transactions/${idOf(p)}`);
          setMessage("Hareket silindi.");
          setError(null);
          await load();
        } catch (err) {
          setError(apiErrorMessage(err, "Hareket silinemedi."));
        }
      }
    );
  };

  const openTerms = async () => {
    setTerms({
      days: String(c.payment_term_days ?? 0),
      late_fee_rate: String(c.late_fee_rate ?? 0),
      apply_to_open_invoices: true,
    });
    setTermsOpen(true);
    const a = await get<Aging>(client, `/contacts/${id}/aging`).catch(() => null);
    setAging(a);
  };

  const saveTerms = async () => {
    setTermsBusy(true);
    try {
      const r = await post<{ message?: string }>(client, `/contacts/${id}/apply-terms`, termsPayload(terms));
      setTermsOpen(false);
      setMessage(r?.message || "Vade uygulandı.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Vade uygulanamadı."));
    } finally {
      setTermsBusy(false);
    }
  };

  const openMessage = () => {
    setMsgPhone(c.phone || "");
    setMsgEmail(c.email || "");
    setMsgSubject(`${c.name || name} — cari hesap`);
    setMsgBody(balanceMessage({ name: c.name || name, balance: c.balance }));
    setMsgChannel(c.phone ? "sms" : c.email ? "email" : "whatsapp");
    setMsgOpen(true);
  };

  const sendMessage = async () => {
    if (!msgBody.trim()) { setError("Mesaj boş olamaz."); return; }
    setMsgBusy(true);
    try {
      if (msgChannel === "sms") {
        if (!msgPhone) { setError("Telefon numarası yok."); setMsgBusy(false); return; }
        try {
          await post(client, "/comm/sms/send", {
            company_id: companyId,
            phone: msgPhone,
            message: msgBody,
            contact_id: id,
            contact_name: c.name,
            context: "manual",
            ref_id: id,
          });
          setMessage("SMS gönderildi.");
        } catch {
          Linking.openURL(`sms:${msgPhone}?body=${encodeURIComponent(msgBody)}`);
          setMessage("SMS uygulaması açıldı.");
        }
      } else if (msgChannel === "email") {
        if (!msgEmail) { setError("E-posta yok."); setMsgBusy(false); return; }
        Linking.openURL(`mailto:${msgEmail}?subject=${encodeURIComponent(msgSubject)}&body=${encodeURIComponent(msgBody)}`);
        setMessage("E-posta uygulaması açıldı.");
      } else {
        const phone = waDigits(msgPhone || c.phone);
        if (!phone) { setError("Telefon numarası yok."); setMsgBusy(false); return; }
        Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(msgBody)}`);
        await post(client, "/comm/whatsapp/logs", {
          company_id: companyId,
          contact_id: id,
          contact_name: c.name,
          phone: msgPhone || c.phone,
          message: msgBody,
          direction: "outbound",
        }).catch(() => null);
        setMessage("WhatsApp açıldı.");
      }
      setMsgOpen(false);
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Mesaj gönderilemedi."));
    } finally {
      setMsgBusy(false);
    }
  };

  const grantB2b = async () => {
    setB2bBusy(true);
    try {
      const r = await post<{ link?: string }>(client, `/contacts/${id}/b2b-access`, {
        enabled: true,
        discount: Number(c.b2b_discount) || 0,
      });
      const link = r?.link || "";
      if (link) {
        if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(link).catch(() => null);
        }
        await Share.share({ message: `B2B sipariş portalı: ${link}` }).catch(() => null);
      }
      setMessage(link ? `B2B portal linki: ${link}` : "B2B erişimi açıldı.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "B2B erişimi oluşturulamadı."));
    } finally {
      setB2bBusy(false);
    }
  };

  const docParams = { contact_id: String(id), contact_name: String(c.name || name || "") };

  const actionTiles: ActionTile[] = [
    canEditContact && { key: "edit", label: "Düzenle", icon: "create" as const, tone: "slate" as const, testID: "detail-edit-contact-btn", onPress: () => go("ContactEdit", { id }) },
    { key: "statement", label: "Ekstre", icon: "document-text" as const, tone: "indigo" as const, testID: "detail-statement-btn", onPress: () => go("ContactStatement", { id, name: c.name || name }) },
    canInvoice && { key: "sell", label: "Satış yap", icon: "arrow-up-circle" as const, tone: "emerald" as const, testID: "detail-sell-btn", onPress: () => go("InvoiceNew", { type: "sales", ...docParams }) },
    canInvoice && { key: "buy", label: "Alış yap", icon: "arrow-down-circle" as const, tone: "sky" as const, testID: "detail-buy-btn", onPress: () => go("InvoiceNew", { type: "purchase", ...docParams }) },
    canBank && { key: "collect", label: "Tahsilat", icon: "wallet" as const, tone: "emerald" as const, testID: "detail-collect-btn", onPress: openPay },
    { key: "message", label: "Mesaj", icon: "chatbubble-ellipses" as const, tone: "violet" as const, testID: "detail-message-btn", onPress: openMessage },
    canEditContact && {
      key: "terms",
      label: c.payment_term_days ? `Vade ${c.payment_term_days}g` : "Vade uygula",
      icon: "calendar" as const,
      tone: "amber" as const,
      testID: "detail-terms-btn",
      onPress: openTerms,
    },
    canBank && {
      key: "plan",
      label: "Taksitlendir",
      icon: "layers" as const,
      tone: "violet" as const,
      testID: "detail-balance-installments-btn",
      disabled: bal === 0,
      onPress: openPlan,
    },
    {
      key: "b2b",
      label: c.b2b_enabled ? "B2B linki" : "B2B erişimi",
      icon: "cart" as const,
      tone: "indigo" as const,
      testID: "detail-b2b-access-btn",
      busy: b2bBusy,
      onPress: grantB2b,
    },
    c.phone && { key: "call", label: "Ara", icon: "call" as const, tone: "teal" as const, testID: "detail-call-btn", onPress: () => Linking.openURL(`tel:${c.phone}`) },
    c.phone && { key: "wa", label: "WhatsApp", icon: "logo-whatsapp" as const, tone: "emerald" as const, testID: "detail-wa-btn", onPress: () => Linking.openURL(`https://wa.me/${waDigits(c.phone)}`) },
    c.email && { key: "mail", label: "E-posta", icon: "mail" as const, tone: "sky" as const, testID: "detail-mail-btn", onPress: () => Linking.openURL(`mailto:${c.email}`) },
    mapsLink(c) && { key: "map", label: "Konum", icon: "navigate" as const, tone: "rose" as const, testID: "detail-location-btn", onPress: () => Linking.openURL(String(mapsLink(c))) },
  ].filter(Boolean) as ActionTile[];

  return (
    <Screen onRefresh={load}>
      <H1>{c.name || name || "Cari"}</H1>
      <Muted>{[c.company_title, c.tax_number_or_id, c.city].filter(Boolean).join(" · ")}</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}

      <ActionTiles items={actionTiles} />

      {termsOpen ? (
        <Card testID="contact-terms-form">
          <Muted>Vade uygula — bu cariye kesilen faturalarda otomatik vade</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            {TERM_QUICK_DAYS.map((d) => (
              <Chip
                key={d}
                label={d === 0 ? "Peşin" : `${d} gün`}
                active={n(terms.days) === d}
                testID={`terms-quick-${d}`}
                onPress={() => setTerms({ ...terms, days: String(d) })}
              />
            ))}
          </Row>
          <Field label="Vade (gün)" testID="terms-days-input" value={terms.days} onChangeText={(v) => setTerms({ ...terms, days: v })} keyboardType="number-pad" />
          <Field label="Vade farkı (% / ay)" testID="terms-rate-input" value={terms.late_fee_rate} onChangeText={(v) => setTerms({ ...terms, late_fee_rate: v })} keyboardType="decimal-pad" />
          <Chip
            label="Açık faturaların vadesini yeniden hesapla"
            active={terms.apply_to_open_invoices}
            testID="terms-apply-open"
            onPress={() => setTerms({ ...terms, apply_to_open_invoices: !terms.apply_to_open_invoices })}
          />
          {aging ? (
            <>
              <Muted>
                Açık {fmtMoney(aging.total_remaining)} · vadesi geçen {fmtMoney(aging.total_overdue)}
                {aging.total_late_fee ? ` · vade farkı ${fmtMoney(aging.total_late_fee)}` : ""}
              </Muted>
              {(aging.rows || []).slice(0, 8).map((r) => (
                <ListRow
                  key={r.invoice_id}
                  testID={`aging-row-${r.invoice_id}`}
                  title={r.invoice_number || "Fatura"}
                  subtitle={[`vade ${fmtDate(r.due_date)}`, r.overdue_days ? `${r.overdue_days} gün gecikme` : "vadesinde"].join(" · ")}
                  right={fmtMoney(r.remaining)}
                />
              ))}
            </>
          ) : null}
          <PrimaryButton title="Vadeyi uygula" onPress={saveTerms} loading={termsBusy} color={colors.primary} testID="terms-save" />
          <PrimaryButton title="Vazgeç" onPress={() => setTermsOpen(false)} testID="terms-cancel" />
        </Card>
      ) : null}

      {payForm ? (
        <Card testID="collect-form">
          <Muted>Tahsilat / ödeme</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            <Chip label="Tahsilat (müşteriden)" active={payForm.type === "inflow"} testID="collect-type-in" onPress={() => setPayForm({ ...payForm, type: "inflow" })} />
            <Chip label="Ödeme (cariye)" active={payForm.type === "outflow"} testID="collect-type-out" color={colors.danger} onPress={() => setPayForm({ ...payForm, type: "outflow" })} />
          </Row>
          <GroupedSelect
            label={payForm.type === "inflow" ? "Kasa / banka / POS / ortak — kredi kartı yok" : "Kasa / banka / kart / ortak"}
            testID="collect-account-select"
            value={payForm.account_id}
            onChange={(id) => setPayForm({ ...payForm, account_id: id })}
            emptyLabel="Hesap seçin"
            groups={payPool}
          />
          <Field label="Tutar" testID="collect-amount" value={payForm.amount} onChangeText={(v) => setPayForm({ ...payForm, amount: v })} keyboardType="decimal-pad" />
          <Field label="Açıklama" testID="collect-desc" value={payForm.description} onChangeText={(v) => setPayForm({ ...payForm, description: v })} />
          <PrimaryButton title="Kaydet" onPress={savePay} loading={payBusy} color={colors.primary} testID="collect-save" />
          <PrimaryButton title="Vazgeç" onPress={() => setPayForm(null)} testID="collect-cancel" />
        </Card>
      ) : null}

      {msgOpen ? (
        <Card testID="message-form">
          <Muted>Mesaj gönder</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            <Chip label="SMS" active={msgChannel === "sms"} testID="qm-tab-sms" onPress={() => setMsgChannel("sms")} />
            <Chip label="E-posta" active={msgChannel === "email"} testID="qm-tab-email" color={colors.primary} onPress={() => setMsgChannel("email")} />
            <Chip label="WhatsApp" active={msgChannel === "whatsapp"} testID="qm-tab-whatsapp" color="#128C7E" onPress={() => setMsgChannel("whatsapp")} />
          </Row>
          <PrimaryButton title="Bakiye mesajı" onPress={() => setMsgBody(balanceMessage({ name: c.name || name, balance: c.balance }))} testID="qm-balance-tpl" />
          {msgChannel === "email" ? (
            <>
              <Field label="E-posta" testID="qm-email-input" value={msgEmail} onChangeText={setMsgEmail} autoCapitalize="none" />
              <Field label="Konu" testID="qm-subject-input" value={msgSubject} onChangeText={setMsgSubject} />
            </>
          ) : (
            <Field label="Telefon" testID="qm-phone-input" value={msgPhone} onChangeText={setMsgPhone} keyboardType="phone-pad" />
          )}
          <Field label="Mesaj" testID="qm-message-input" value={msgBody} onChangeText={setMsgBody} multiline />
          <PrimaryButton title="Gönder" onPress={sendMessage} loading={msgBusy} color={colors.primary} testID="qm-send" />
          <PrimaryButton title="Vazgeç" onPress={() => setMsgOpen(false)} testID="qm-cancel" />
        </Card>
      ) : null}

      <Row style={{ flexWrap: "wrap" }}>
        <Kpi label="Cari hesap" value={fmtMoney(bal)} sub={hint.label} />
        <Kpi label="Satış faturaları" value={fmtMoney(invoiced)} />
        <Kpi label="Tahsil edilen" value={fmtMoney(paid)} />
        <Kpi label="Kalan alacak" value={fmtMoney(openAmt)} />
        {chequeBal ? <Kpi label="Çek / senet" value={fmtMoney(chequeBal)} /> : null}
      </Row>

      <Card testID="contact-card">
        <Text style={{ color: colors.muted, fontWeight: "700" }}>Bakiye</Text>
        <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>{fmtMoney(c.balance)}</Text>
        <Row style={{ flexWrap: "wrap" }}>
          <Badge label={contactTypeLabel(c.type)} tone="indigo" />
          <Badge label={hint.label} tone={hint.tone} />
          {c.is_e_invoice_user ? <Badge label="E-Fatura" tone="green" /> : null}
          {c.b2b_enabled ? <Badge label="B2B" tone="indigo" /> : null}
          {c.risk_status && c.risk_status !== "normal" ? <Badge label={riskStatusTr(c.risk_status)} tone="red" /> : null}
        </Row>
        {summaryRows.length ? (
          <View>
            {summaryRows.map((r) => (
              <Muted key={r.key}>{r.label}: {r.value}</Muted>
            ))}
          </View>
        ) : (
          <Muted>0 fatura · açık {fmtMoney(0)}</Muted>
        )}
        {infoRows.map((r) => (
          <InfoLine key={r.key} label={r.label} value={r.value} />
        ))}
      </Card>

      <Row style={{ flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <Chip
            key={t.key}
            label={`${t.label} (${counts[t.key]})`}
            active={tab === t.key}
            testID={`detail-tab-${t.key}`}
            onPress={() => setTab(t.key)}
          />
        ))}
      </Row>

      {tab === "invoices" ? (
        !invoices.length ? <Muted>Fatura yok.</Muted> : invoices.map((inv: any, idx: number) => (
          <ListRow
            key={idOf(inv) || idx}
            testID={`detail-inv-${idOf(inv) || idx}`}
            title={inv.invoice_number || "Fatura"}
            subtitle={[invoiceTypeTr(inv.invoice_type), statusTr(inv.status), fmtDate(inv.issue_date)].filter(Boolean).join(" · ")}
            right={fmtMoney(inv.grand_total)}
            onPress={() => go("InvoiceDetail", { id: idOf(inv) })}
          />
        ))
      ) : null}

      {tab === "payments" ? (
        <>
          {payEdit ? (
            <Card testID="pay-edit-form">
              <Muted>Hareketi düzenle</Muted>
              <Field label="Tutar" testID="pay-edit-amount" value={payEdit.amount} onChangeText={(v) => setPayEdit({ ...payEdit, amount: v })} keyboardType="decimal-pad" />
              <Field label="Tarih" testID="pay-edit-date" value={payEdit.date} onChangeText={(v) => setPayEdit({ ...payEdit, date: v })} placeholder="YYYY-AA-GG" />
              <Field label="Açıklama" testID="pay-edit-desc" value={payEdit.description} onChangeText={(v) => setPayEdit({ ...payEdit, description: v })} />
              <GroupedSelect
                label="Kasa / banka"
                testID="pay-edit-account"
                value={payEdit.account_id}
                onChange={(v) => setPayEdit({ ...payEdit, account_id: v })}
                emptyLabel="Hesap seçin"
                groups={paymentTargetGroups(accounts, [], { includePartners: false })}
              />
              <PrimaryButton title="Güncelle" onPress={savePaymentEdit} loading={payBusy} color={colors.primary} testID="pay-edit-save" />
              <PrimaryButton title="Vazgeç" onPress={() => setPayEdit(null)} testID="pay-edit-cancel" />
            </Card>
          ) : null}
          {!payments.length ? <Muted>Ödeme yok.</Muted> : payments.map((p: ContactPayment, idx: number) => {
            const locked = isLockedPayment(p);
            return (
              <View key={idOf(p) || idx} style={{ gap: 4 }}>
                <ListRow
                  testID={`detail-pay-${idOf(p) || idx}`}
                  title={`${p.type === "inflow" ? "Tahsilat" : p.type === "outflow" ? "Ödeme" : p.type || "Hareket"}${locked ? ` · ${lockedPaymentLabel(p)}` : ""}`}
                  subtitle={[fmtDate(p.date), p.account_name, p.description].filter(Boolean).join(" · ")}
                  right={`${p.type === "inflow" ? "+" : "-"}${fmtMoney(p.amount)}`}
                />
                {canBank && !locked ? (
                  <Row>
                    <PrimaryButton title="Düzenle" onPress={() => openPaymentEdit(p)} color={colors.secondary} testID={`pay-edit-btn-${idOf(p)}`} />
                    <PrimaryButton title="Sil" onPress={() => removePayment(p)} color={colors.danger} testID={`pay-delete-btn-${idOf(p)}`} />
                  </Row>
                ) : locked ? (
                  <Muted>{lockedPaymentLabel(p)} kaynaklı hareket kendi modülünden yönetilir.</Muted>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}

      {tab === "installments" ? (
        <>
          <Muted>
            {instSummary.pending} bekleyen · {instSummary.overdue} vadesi geçen · kalan {fmtMoney(instSummary.remaining)}
          </Muted>
          {canBank && bal !== 0 ? (
            <PrimaryButton title="Bakiyeyi taksitlendir" onPress={openPlan} color="#7C3AED" testID="detail-inst-new-plan" />
          ) : null}
          {canBank && hasBalancePlan ? (
            <PrimaryButton title="Bakiye planını sil" onPress={removePlan} color={colors.danger} testID="detail-inst-delete-plan" />
          ) : null}

          {planOpen ? (
            <Card testID="installment-plan-form">
              <Muted>Açık bakiye {fmtMoney(Math.abs(bal))} için plan</Muted>
              <Field label="Taksit sayısı" testID="plan-count-input" value={plan.count} onChangeText={(v) => setPlan({ ...plan, count: v })} keyboardType="number-pad" />
              <Field label="Peşinat (₺)" testID="plan-down-input" value={plan.down_payment} onChangeText={(v) => setPlan({ ...plan, down_payment: v })} keyboardType="decimal-pad" />
              <Muted>Periyot</Muted>
              <Row style={{ flexWrap: "wrap" }}>
                {PLAN_INTERVALS.map((i) => (
                  <Chip key={i.key} label={i.label} active={plan.interval === i.key} testID={`plan-interval-${i.key}`} onPress={() => setPlan({ ...plan, interval: i.key })} />
                ))}
              </Row>
              {plan.interval === "days" ? (
                <Field label="Gün aralığı" testID="plan-interval-days" value={plan.interval_days} onChangeText={(v) => setPlan({ ...plan, interval_days: v })} keyboardType="number-pad" />
              ) : null}
              <Field label="İlk taksit tarihi" testID="plan-first-date-input" value={plan.first_due_date} onChangeText={(v) => setPlan({ ...plan, first_due_date: v })} placeholder="YYYY-AA-GG" />
              <PrimaryButton title="Planı oluştur" onPress={savePlan} loading={planBusy} color={colors.primary} testID="plan-save-btn" />
              <PrimaryButton title="Vazgeç" onPress={() => setPlanOpen(false)} testID="plan-cancel-btn" />
            </Card>
          ) : null}

          {instPay ? (
            <Card testID="installment-pay-form">
              <Muted>{instPay.row.label || "Taksit"} · kalan {fmtMoney(remainingOf(instPay.row))}</Muted>
              <Field label="Tutar" testID="inst-pay-amount" value={instPay.amount} onChangeText={(v) => setInstPay({ ...instPay, amount: v })} keyboardType="decimal-pad" />
              <GroupedSelect
                label="Kasa / banka / ortak"
                testID="inst-pay-account"
                value={instPay.account_id}
                onChange={(v) => setInstPay({ ...instPay, account_id: v })}
                emptyLabel="Hesapsız — cariye işle"
                groups={paymentTargetGroups(accounts, partners, { collectableOnly: true })}
              />
              <PrimaryButton title="Taksiti öde" onPress={payInstallment} loading={payBusy} color={colors.primary} testID="inst-pay-save" />
              <PrimaryButton title="Vazgeç" onPress={() => setInstPay(null)} testID="inst-pay-cancel" />
            </Card>
          ) : null}

          {!instGroups.length ? (
            <Muted>Bu cariye ait taksit yok. Açık bakiyeyi taksitlendirebilirsiniz.</Muted>
          ) : instGroups.map((g) => (
            <Card key={g.key} testID={`detail-inst-group-${g.key}`}>
              <Row style={{ flexWrap: "wrap" }}>
                <Badge label={g.direction === "receivable" ? "Alacak" : "Borç"} tone={g.direction === "receivable" ? "green" : "indigo"} />
                <Text style={{ fontWeight: "800", color: colors.text }}>{g.title}</Text>
                <Muted>{g.paidCount}/{g.totalCount} ödendi</Muted>
              </Row>
              {g.rows.map((r) => (
                <ListRow
                  key={idOf(r)}
                  testID={`detail-inst-${idOf(r)}`}
                  title={r.label || `${r.no}. Taksit`}
                  subtitle={[
                    fmtDate(r.due_date),
                    r.status === "paid" ? "Ödendi" : r.is_overdue ? "Vadesi geçti" : "Bekliyor",
                    r.status === "paid" ? "" : `kalan ${fmtMoney(remainingOf(r))}`,
                  ].filter(Boolean).join(" · ")}
                  right={fmtMoney(r.amount)}
                  onPress={canBank && r.status !== "paid" ? () => openInstallmentPay(r) : undefined}
                />
              ))}
            </Card>
          ))}
        </>
      ) : null}

      {tab === "orders" ? (
        !orders.length ? <Muted>Sipariş yok.</Muted> : orders.map((o: any, idx: number) => (
          <ListRow
            key={idOf(o) || idx}
            testID={`detail-ord-${idOf(o) || idx}`}
            title={o.order_number || "Sipariş"}
            subtitle={[statusTr(o.status), fmtDate(o.order_date || o.created_at)].filter(Boolean).join(" · ")}
            right={fmtMoney(o.grand_total || o.total)}
            onPress={() => go("OrderDetail", { id: idOf(o) })}
          />
        ))
      ) : null}

      {tab === "quotes" ? (
        <>
          {can("/quotes", "edit") ? (
            <PrimaryButton title="Yeni teklif" onPress={() => go("QuoteNew", docParams)} color={colors.primary} testID="detail-quote-new" />
          ) : null}
          {!quotes.length ? <Muted>Teklif yok.</Muted> : quotes.map((q: any, idx: number) => (
            <ListRow
              key={idOf(q) || idx}
              testID={`detail-quote-${idOf(q) || idx}`}
              title={q.title || q.quote_number || "Teklif"}
              subtitle={[statusTr(q.status), fmtDate(q.valid_until)].filter(Boolean).join(" · ")}
              right={fmtMoney(q.grand_total || q.total)}
              onPress={() => go("QuoteDetail", { id: idOf(q) })}
            />
          ))}
        </>
      ) : null}

      {tab === "projects" ? (
        <>
          {can("/projects", "edit") ? (
            <PrimaryButton title="Yeni proje" onPress={() => go("ProjectNew", docParams)} color={colors.primary} testID="detail-project-new" />
          ) : null}
          {!projects.length ? <Muted>Proje yok.</Muted> : projects.map((p: any, idx: number) => (
            <ListRow
              key={idOf(p) || idx}
              testID={`detail-proj-${idOf(p) || idx}`}
              title={p.name || p.project_number || "Proje"}
              subtitle={[statusTr(p.status), fmtDate(p.start_date)].filter(Boolean).join(" · ")}
              right={fmtMoney(p.budget)}
              onPress={() => go("ProjectDetail", { id: idOf(p) })}
            />
          ))}
        </>
      ) : null}

      {tab === "surveys" ? (
        <>
          {can("/surveys", "edit") ? (
            <PrimaryButton title="Yeni keşif" onPress={() => go("SurveyNew", docParams)} color={colors.primary} testID="detail-survey-new" />
          ) : null}
          {!surveys.length ? <Muted>Keşif yok.</Muted> : surveys.map((s: any, idx: number) => (
            <ListRow
              key={idOf(s) || idx}
              testID={`detail-surv-${idOf(s) || idx}`}
              title={s.survey_number || s.address || "Keşif"}
              subtitle={[statusTr(s.status), fmtDate(s.survey_date)].filter(Boolean).join(" · ")}
              onPress={() => go("SurveyDetail", { id: idOf(s) })}
            />
          ))}
        </>
      ) : null}

      {tab === "comm" ? (
        !comms.length ? <Muted>İletişim kaydı yok.</Muted> : comms.map((m: any, idx: number) => (
          <ListRow
            key={idOf(m) || idx}
            testID={`detail-comm-${idx}`}
            title={m.channel || m.direction || "Mesaj"}
            subtitle={[fmtDate(m.created_at || m.date), m.message || m.body || m.subject].filter(Boolean).join(" · ")}
          />
        ))
      ) : null}

      {tab === "cheques" ? (
        !cheques.length ? <Muted>Çek / senet yok.</Muted> : cheques.map((ch: any, idx: number) => (
          <ListRow
            key={idOf(ch) || idx}
            testID={`detail-cheque-${idx}`}
            title={ch.serial_no || ch.cheque_number || "Çek"}
            subtitle={[ch.type, statusTr(ch.status), fmtDate(ch.due_date)].filter(Boolean).join(" · ")}
            right={fmtMoney(ch.amount)}
          />
        ))
      ) : null}
    </Screen>
  );
}

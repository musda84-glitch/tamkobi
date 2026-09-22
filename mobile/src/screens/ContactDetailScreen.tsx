import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Share, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles, type ActionTile } from "../components/ActionTiles";
import { Chip, confirmAction, n } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { type TabStripItem } from "../components/TabStrip";
import { ChannelLogo } from "../components/ChannelLogo";
import { ProjectCardsHost } from "../components/ProjectCard";
import { Badge, Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen, StatRows } from "../components/kit";
import { SwipeRevealRow } from "../components/SwipeRevealRow";
import { go } from "../nav";
import { colors } from "../theme";
import { invoiceTypeTr, orderNumberLabel, riskStatusTr, statusTr, trUpper } from "../utils/labels";
import { collectableAccounts, splitPaymentTarget } from "../utils/contactDraft";
import { paymentTargetGroups } from "../utils/finance";
import { balanceHint, contactCardVisibleActions, contactDisplayBalance, contactInfoRows, contactSummaryRows, contactTabSelectGroups, contactTypeLabel } from "../utils/contactDisplay";
import { balanceMessage, waDigits } from "../utils/contactStatement";
import { smsComposerHref, smsSendFailed } from "../utils/quoteApproval";
import { mapsLink } from "../utils/geo";
import {
  emptyPlanDraft,
  groupInstallments,
  installmentSummary,
  chequeIdOfPayment,
  isChequePayment,
  isLockedPayment,
  lockedPaymentLabel,
  paymentAmountColor,
  paymentAmountPrefix,
  paymentKindLabel,
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
import { fmtDate, fmtMoney, idOf, todayIso } from "../utils/money";
import { normalizeProjectStages, type ProjectStage } from "../utils/projectStages";
import { mergeContactProjects, projectsForContact, type ProjectDoc } from "../utils/workDocs";
import type { BankAccount } from "../utils/finance";
import { canDeleteInvoice, canEditInvoiceItems } from "../utils/invoiceDraft";
import { canStaffDeleteOrder, canStaffEditOrder, orderStatusOf } from "../utils/orderEdit";
import { printPaymentReceipt } from "../utils/chequeShare";

type Partner = { id?: string; _id?: string; name?: string; is_active?: boolean; balance?: number };
type PayMethod = "cash" | "cheque" | "promissory";
type PayForm = { type: "inflow" | "outflow"; amount: string; account_id: string; description: string; method: PayMethod; due_date: string; serial_no: string };
type MsgChannel = "sms" | "email" | "whatsapp";
type TabKey = "invoices" | "payments" | "installments" | "orders" | "quotes" | "projects" | "surveys" | "comm" | "cheques";
type Aging = { total_remaining?: number; total_overdue?: number; total_late_fee?: number; rows?: { invoice_id?: string; invoice_number?: string; due_date?: string; remaining?: number; overdue_days?: number; late_fee?: number }[] };

const TABS: TabStripItem<TabKey>[] = [
  { key: "invoices", label: "Fatura", icon: "document-text" },
  { key: "payments", label: "Ödeme", icon: "wallet" },
  { key: "installments", label: "Taksit", icon: "calendar" },
  { key: "orders", label: "Sipariş", icon: "cart" },
  { key: "quotes", label: "Teklif", icon: "create" },
  { key: "projects", label: "Proje", icon: "briefcase" },
  { key: "surveys", label: "Keşif", icon: "construct" },
  { key: "comm", label: "İletişim", icon: "chatbubbles" },
  { key: "cheques", label: "Çek", icon: "card" },
];

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 11 }}>{trUpper(label)}</Text>
      <Text style={{ color: colors.text, fontWeight: "600", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function ContactDetailScreen() {
  const { client, companyId, can, activeCompany, baseUrl } = useAuth();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const canEditContact = can("/contacts", "edit");
  const canInvoice = can("/invoices", "edit");
  const canBank = can("/banking", "edit");
  const canQuote = can("/quotes", "edit");
  const canSurvey = can("/surveys", "edit");
  const canOrder = can("/orders", "edit") || can("/saha", "edit");
  const canCheque = can("/cheques", "edit");
  const canPaper = canCheque || canBank;
  const canProject = can("/projects", "edit");
  const canExp = can("/expenses", "edit");
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
  const [infoOpen, setInfoOpen] = useState(false);
  const [moreActions, setMoreActions] = useState(false);
  const [openInvRow, setOpenInvRow] = useState<string | null>(null);
  const [lightProjects, setLightProjects] = useState<ProjectDoc[] | null>(null);
  const [projectStages, setProjectStages] = useState<ProjectStage[]>([]);

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

  const loadProjectCards = useCallback(async () => {
    if (!id) return;
    try {
      const [rows, stages] = await Promise.all([
        get<ProjectDoc[]>(client, "/projects", { company_id: companyId, light: 1 }),
        get<{ stages?: ProjectStage[] }>(client, `/companies/${companyId}/project-stages`).catch(() => ({ stages: [] })),
      ]);
      setLightProjects(projectsForContact(rows || [], id));
      setProjectStages(normalizeProjectStages(stages?.stages));
    } catch (err) {
      setError(apiErrorMessage(err, "Projeler yüklenemedi."));
    }
  }, [client, companyId, id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useFocusEffect(useCallback(() => {
    if (tab !== "projects") return;
    loadProjectCards();
  }, [tab, loadProjectCards]));

  useEffect(() => {
    if (tab === "projects") loadProjectCards();
  }, [tab, loadProjectCards]);

  const patchContactProject = useCallback((pid: string, patch: Partial<ProjectDoc>) => {
    setLightProjects((rows) => (rows ? rows.map((p) => (idOf(p) === pid ? { ...p, ...patch } : p)) : rows));
    setData((ov: any) => {
      if (!ov?.projects) return ov;
      return { ...ov, projects: ov.projects.map((p: any) => (idOf(p) === pid ? { ...p, ...patch } : p)) };
    });
  }, []);

  const c = data?.contact || data || {};
  const summary = data?.summary || {};
  const bal = contactDisplayBalance(c, summary);
  const hint = balanceHint(bal);
  const infoRows = useMemo(() => contactInfoRows(c), [c]);
  const summaryRows = useMemo(() => contactSummaryRows(summary), [summary]);
  const invoices = data?.invoices || [];
  const payments = data?.payments || [];
  const orders = data?.orders || [];
  const quotes = data?.quotes || [];
  const overlayProjects = (data?.projects || []) as ProjectDoc[];
  const projects = mergeContactProjects(overlayProjects, lightProjects);
  const surveys = data?.surveys || [];
  const comms = data?.communications || [];
  const cheques = data?.cheques || [];
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
  const tabGroups = contactTabSelectGroups(TABS, counts);

  const openPaper = (instrument: "cheque" | "promissory", type?: PayForm["type"]) => {
    if (!canPaper) { setError("Çek / senet kaydı yetkiniz yok."); return; }
    const isCheque = instrument === "cheque";
    const inflow = (type || payForm?.type || "inflow") === "inflow";
    setPayForm(null);
    go("ChequeNew", {
      contact_id: id,
      contact_name: c.name || name,
      instrument,
      direction: inflow ? "received" : "issued",
      amount: payForm?.amount,
      notes: inflow
        ? (isCheque ? "Çek tahsilatı" : "Senet tahsilatı")
        : (isCheque ? "Çek ödemesi" : "Senet ödemesi"),
    });
  };

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
        method: "cash",
        due_date: todayIso(),
        serial_no: "",
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
    const paper = payForm.method === "cheque" || payForm.method === "promissory";
    if (paper && !canPaper) { setError("Çek / senet kaydı yetkiniz yok."); return; }
    if (!paper && !payForm.account_id) { setError("Kasa / banka / ortak seçin."); return; }
    setPayBusy(true);
    try {
      if (paper) {
        await post(client, "/cheques", {
          company_id: companyId,
          contact_id: id,
          direction: payForm.type === "inflow" ? "received" : "issued",
          instrument: payForm.method === "promissory" ? "promissory" : "cheque",
          amount: amt,
          due_date: payForm.due_date || todayIso(),
          issue_date: todayIso(),
          serial_no: payForm.serial_no,
          notes: payForm.description,
        });
      } else {
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
      }
      setPayForm(null);
      setMessage(
        paper
          ? (payForm.method === "promissory" ? "Senet kaydedildi." : "Çek kaydedildi.")
          : (payForm.type === "inflow" ? "Tahsilat kaydedildi." : "Ödeme kaydedildi."),
      );
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

  const removeChequePayment = (p: ContactPayment) => {
    const cid = chequeIdOfPayment(p, cheques);
    if (!(canCheque || canBank)) { setError("Çek / senet silme yetkiniz yok."); return; }
    if (!cid) { setError("Çek kaydı bulunamadı."); return; }
    confirmAction(
      "Çek / seneti sil",
      `${fmtMoney(p.amount)} tutarındaki çek / senet çöp kutusuna taşınsın mı?`,
      async () => {
        try {
          await del(client, `/cheques/${cid}`);
          setMessage("Çek / senet silindi.");
          setError(null);
          await load();
        } catch (err) {
          setError(apiErrorMessage(err, "Çek / senet silinemedi."));
        }
      },
    );
  };

  const removeInvoice = (inv: { id?: string; _id?: string; invoice_number?: string; status?: string; e_type?: string; paid_amount?: number; payment_status?: string }) => {
    if (!canInvoice) { setError("Fatura silme yetkiniz yok."); return; }
    if (!canDeleteInvoice(inv)) {
      setOpenInvRow(null);
      setError("Kesilmiş e-belge silinemez. Taslak veya ödenmemiş kağıt faturayı sola kaydırarak silebilirsiniz.");
      return;
    }
    const kind = inv.status === "draft" ? "taslak fatura" : "kağıt fatura";
    confirmAction(
      "Faturayı sil",
      `${inv.invoice_number || "Fatura"} numaralı ${kind} çöp kutusuna taşınsın mı?`,
      async () => {
        try {
          await del(client, `/invoices/${idOf(inv)}`);
          setMessage("Fatura silindi.");
          setOpenInvRow(null);
          setError(null);
          await load();
        } catch (err) {
          setError(apiErrorMessage(err, "Fatura silinemedi."));
        }
      },
    );
  };

  const editInvoice = (inv: { id?: string; _id?: string; status?: string }) => {
    const iid = idOf(inv);
    setOpenInvRow(null);
    if (canInvoice && canEditInvoiceItems(inv)) go("InvoiceEdit", { id: iid });
    else go("InvoiceDetail", { id: iid });
  };

  const removeOrder = (o: { order_number?: string; is_invoiced?: boolean; invoice_id?: string }) => {
    if (!canOrder) { setError("Sipariş silme yetkiniz yok."); return; }
    if (!canStaffDeleteOrder(o)) { setError("Faturalanmış sipariş silinemez."); return; }
    confirmAction(
      "Siparişi sil",
      `${orderNumberLabel(o)} çöp kutusuna taşınsın mı?`,
      async () => {
        try {
          await del(client, `/orders/${idOf(o)}`);
          setMessage("Sipariş silindi.");
          setError(null);
          await load();
        } catch (err) {
          setError(apiErrorMessage(err, "Sipariş silinemedi."));
        }
      },
    );
  };

  const printPayment = async (p: ContactPayment) => {
    try {
      await printPaymentReceipt(
        {
          id: idOf(p),
          type: p.type === "outflow" ? "outflow" : p.type === "transfer" ? "transfer" : "inflow",
          date: p.date,
          account_name: p.account_name,
          category: p.category,
          description: p.description,
          amount: p.amount,
          contact_name: c.name,
        },
        activeCompany,
        client,
        { name: c.name, tax_number_or_id: c.tax_number_or_id, address: c.address, city: c.city, balance: bal },
        id,
      );
      setMessage("Makbuz yazdırmaya gönderildi.");
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Makbuz yazdırılamadı."));
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
    setMsgBody(balanceMessage({ name: c.name || name, balance: bal }));
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
          const r = await post<{ status?: string; sent?: number; failed?: number; simulated?: boolean; message?: string; error?: string }>(client, "/comm/sms/send", {
            company_id: companyId,
            phone: msgPhone,
            message: msgBody,
            contact_id: id,
            contact_name: c.name,
            context: "manual",
            ref_id: id,
          });
          if (r.simulated || smsSendFailed(r)) {
            await Linking.openURL(smsComposerHref(msgPhone, msgBody));
            setMessage(r.simulated
              ? "SMS operatörü tanımlı değil; telefon SMS uygulaması açıldı."
              : (r.error || r.message || "SMS gönderilemedi; telefon uygulaması açıldı."));
          } else {
            setMessage(r.message || "SMS gönderildi.");
          }
        } catch {
          Linking.openURL(smsComposerHref(msgPhone, msgBody)).catch(() => null);
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
    canQuote && { key: "quote", label: "Teklif", icon: "create" as const, tone: "amber" as const, testID: "detail-quote-btn", onPress: () => go("QuoteNew", docParams) },
    canOrder && { key: "order", label: "Sipariş", icon: "cart" as const, tone: "orange" as const, testID: "detail-order-btn", onPress: () => (can("/saha") ? go("Field", { contact_id: id, contact_name: c.name || name }) : go("Orders")) },
    canSurvey && { key: "survey", label: "Keşif", icon: "construct" as const, tone: "teal" as const, testID: "detail-survey-btn", onPress: () => go("SurveyNew", docParams) },
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
  const { showMore, shown: visibleActions } = contactCardVisibleActions(actionTiles, moreActions);

  return (
    <Screen onRefresh={load}>
      <H1>{c.name || name || "Cari"}</H1>
      <Muted>{[c.company_title, c.tax_number_or_id, c.city].filter(Boolean).join(" · ")}</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}

      <ActionTiles
        items={[
          ...(showMore
            ? [{
                key: "more",
                label: moreActions ? "Gizle" : "Diğerleri",
                icon: (moreActions ? "chevron-up" : "chevron-down") as const,
                tone: "slate" as const,
                testID: "detail-more-actions",
                onPress: () => setMoreActions((v) => !v),
              } as ActionTile]
            : []),
          ...visibleActions,
        ]}
        size="xs"
      />

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
            <Chip label="Tahsilat (müşteriden)" active={payForm.type === "inflow"} testID="collect-type-in" onPress={() => setPayForm({ ...payForm, type: "inflow", description: payForm.method === "cash" ? "Cari tahsilat" : payForm.description })} />
            <Chip label="Ödeme (cariye)" active={payForm.type === "outflow"} testID="collect-type-out" color={colors.danger} onPress={() => setPayForm({ ...payForm, type: "outflow", description: payForm.method === "cash" ? "Cari ödeme" : payForm.description })} />
            <Chip label="Çek tahsilatı" active={false} testID="collect-type-cheque" onPress={() => openPaper("cheque", "inflow")} />
            <Chip label="Senet tahsilatı" active={false} testID="collect-type-promissory" onPress={() => openPaper("promissory", "inflow")} />
          </Row>
          <Muted>Tahsil şekli</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            <Chip
              label="Nakit / banka"
              active={payForm.method === "cash"}
              testID="collect-method-cash"
              onPress={() => setPayForm({
                ...payForm,
                method: "cash",
                description: payForm.type === "inflow" ? "Cari tahsilat" : "Cari ödeme",
              })}
            />
            <Chip
              label="Çek"
              active={false}
              testID="collect-method-cheque"
              onPress={() => openPaper("cheque")}
            />
            <Chip
              label="Senet"
              active={false}
              testID="collect-method-promissory"
              onPress={() => openPaper("promissory")}
            />
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
          <PrimaryButton title="Bakiye mesajı" onPress={() => setMsgBody(balanceMessage({ name: c.name || name, balance: bal }))} testID="qm-balance-tpl" />
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

      <StatRows
        testID="contact-summary-strip"
        items={[
          { key: "balance", label: "Cari hesap", value: fmtMoney(bal), hint: hint.label, valueColor: bal > 0 ? colors.primaryHover : bal < 0 ? colors.danger : undefined },
          { key: "invoiced", label: "Satış faturaları", value: fmtMoney(invoiced) },
          { key: "paid", label: "Tahsil edilen", value: fmtMoney(paid) },
          { key: "open", label: "Kalan alacak", value: fmtMoney(openAmt), valueColor: openAmt > 0 ? colors.danger : undefined },
          ...(chequeBal ? [{ key: "cheques", label: "Çek / senet", value: fmtMoney(chequeBal) }] : []),
        ]}
      />

      <GroupedSelect
        dense
        label="Kayıtlar"
        testID="detail-tab"
        value={tab}
        onChange={(v) => setTab(v as TabKey)}
        groups={tabGroups}
      />

      {tab === "invoices" ? (
        !invoices.length ? <Muted>Fatura yok.</Muted> : (
        <>
        <Muted>Düzenlemek veya silmek için satırı sola kaydırın.</Muted>
        {invoices.map((inv: any, idx: number) => {
          const iid = idOf(inv) || String(idx);
          return (
            <SwipeRevealRow
              key={iid}
              rowKey={iid}
              openKey={openInvRow}
              onOpen={setOpenInvRow}
              onPress={() => go("InvoiceDetail", { id: idOf(inv) })}
              onEdit={() => editInvoice(inv)}
              onDelete={() => removeInvoice(inv)}
              testID={`detail-inv-${iid}`}
            >
              <ListRow
                testID={`detail-inv-${iid}`}
                title={inv.invoice_number || "Fatura"}
                subtitle={[invoiceTypeTr(inv.invoice_type), statusTr(inv.status), fmtDate(inv.issue_date)].filter(Boolean).join(" · ")}
                right={fmtMoney(inv.grand_total)}
                showChevron
              />
            </SwipeRevealRow>
          );
        })}
        </>
        )
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
          {!payments.length ? <Muted>Tahsilat / ödeme yok.</Muted> : payments.map((p: ContactPayment, idx: number) => {
            const locked = isLockedPayment(p);
            const chequeId = isChequePayment(p) ? chequeIdOfPayment(p, cheques) : "";
            const showChequeBtns = (canBank || canCheque) && isChequePayment(p);
            const tone = paymentAmountColor(p);
            const kind = paymentKindLabel(p);
            return (
              <View key={idOf(p) || idx} style={{ gap: 4 }}>
                <ListRow
                  testID={`detail-pay-${idOf(p) || idx}`}
                  title={
                    <Text style={{ fontWeight: "700", fontSize: 14, color: tone }}>
                      {`${kind}${locked ? ` · ${lockedPaymentLabel(p)}` : ""}`}
                    </Text>
                  }
                  subtitle={[fmtDate(p.date), p.account_name, p.description].filter(Boolean).join(" · ")}
                  right={`${paymentAmountPrefix(p)}${fmtMoney(p.amount)}`}
                  rightColor={tone}
                />
                <Row>
                  <PrimaryButton
                    title="Makbuz"
                    onPress={() => printPayment(p)}
                    color={colors.slate800}
                    testID={`pay-print-${idOf(p) || idx}`}
                  />
                </Row>
                {showChequeBtns ? (
                  <Row>
                    <PrimaryButton
                      title="Düzenle"
                      onPress={() => {
                        if (chequeId) go("ChequeDetail", { id: chequeId });
                        else go("Cheques");
                      }}
                      color={colors.secondary}
                      testID={`pay-cheque-edit-${chequeId || idOf(p) || idx}`}
                    />
                    <PrimaryButton
                      title="Sil"
                      onPress={() => removeChequePayment(p)}
                      color={colors.danger}
                      testID={`pay-cheque-delete-${chequeId || idOf(p) || idx}`}
                    />
                  </Row>
                ) : canBank && !locked ? (
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
        !orders.length ? <Muted>Sipariş yok.</Muted> : orders.map((o: any, idx: number) => {
          const oid = idOf(o) || String(idx);
          const editable = canOrder && canStaffEditOrder(o);
          const deletable = canOrder && canStaffDeleteOrder(o);
          return (
            <View key={oid} style={{ gap: 4 }}>
              <ListRow
                testID={`detail-ord-${oid}`}
                title={orderNumberLabel(o)}
                leading={<ChannelLogo channel={o.channel} />}
                subtitle={[statusTr(orderStatusOf(o)), fmtDate(o.order_date || o.created_at)].filter(Boolean).join(" · ")}
                right={fmtMoney(o.grand_total || o.total)}
                onPress={() => go("OrderDetail", { id: idOf(o) })}
              />
              {editable || deletable ? (
                <Row>
                  {editable ? (
                    <PrimaryButton title="Düzenle" onPress={() => go("OrderEdit", { id: idOf(o) })} color={colors.secondary} testID={`ord-edit-btn-${idOf(o)}`} />
                  ) : null}
                  {deletable ? (
                    <PrimaryButton title="Sil" onPress={() => removeOrder(o)} color={colors.danger} testID={`ord-delete-btn-${idOf(o)}`} />
                  ) : null}
                </Row>
              ) : null}
            </View>
          );
        })
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
          {canProject ? (
            <PrimaryButton title="Yeni proje" onPress={() => go("ProjectNew", docParams)} color={colors.primary} testID="detail-project-new" />
          ) : null}
          {!projects.length ? (
            <Muted>Proje yok.</Muted>
          ) : (
            <ProjectCardsHost
              projects={projects}
              stages={projectStages}
              canEdit={canProject}
              canExp={canExp}
              canQuote={canQuote}
              client={client}
              companyId={companyId}
              baseUrl={baseUrl}
              onPatch={patchContactProject}
              onError={setError}
            />
          )}
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
              action={mapsLink(s) ? (
                <Pressable
                  testID={`detail-surv-maps-${idOf(s) || idx}`}
                  onPress={() => Linking.openURL(String(mapsLink(s)))}
                  hitSlop={8}
                >
                  <Text style={{ fontWeight: "800", color: "#9F1239", fontSize: 12 }}>Konuma Git</Text>
                </Pressable>
              ) : undefined}
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
            title={ch.serial_no || ch.number || ch.cheque_number || "Çek"}
            subtitle={[
              ch.direction === "issued" ? "Verilen" : ch.direction === "received" ? "Alınan" : "",
              ch.instrument === "promissory" ? "senet" : ch.instrument === "cheque" ? "çek" : "",
              ch.status_label || statusTr(ch.status),
              fmtDate(ch.due_date),
            ].filter(Boolean).join(" · ")}
            right={fmtMoney(ch.amount)}
            onPress={idOf(ch) ? () => go("ChequeDetail", { id: idOf(ch) }) : undefined}
          />
        ))
      ) : null}

      <Card testID="contact-card">
        <Text style={{ color: colors.muted, fontWeight: "700" }}>Bakiye</Text>
        <Text style={{ fontSize: 22, fontWeight: "800", color: bal > 0 ? colors.primaryHover : bal < 0 ? colors.danger : colors.text }} testID="contact-card-balance">{fmtMoney(bal)}</Text>
        <Row style={{ flexWrap: "wrap" }}>
          <Badge label={contactTypeLabel(c.type)} tone="indigo" />
          <Badge label={hint.label} tone={hint.tone} />
          {c.is_e_invoice_user ? <Badge label="E-Fatura" tone="green" /> : null}
          {c.b2b_enabled ? <Badge label="B2B" tone="indigo" /> : null}
          {c.risk_status && c.risk_status !== "normal" ? <Badge label={riskStatusTr(c.risk_status)} tone="red" /> : null}
        </Row>
        <Pressable
          testID="contact-card-toggle"
          onPress={() => setInfoOpen((v) => !v)}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}
        >
          <Ionicons name={infoOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />
          <Text style={{ fontWeight: "700", color: colors.muted, fontSize: 12 }}>
            {infoOpen ? "Bilgileri gizle" : `Cari bilgileri${infoRows.length ? ` (${infoRows.length})` : ""}`}
          </Text>
        </Pressable>
        {infoOpen ? (
          <>
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
          </>
        ) : null}
      </Card>
    </Screen>
  );
}

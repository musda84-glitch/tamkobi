import { useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import React, { useCallback, useMemo, useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip, n } from "../components/chips";
import { Badge, Card, ErrorBanner, Field, H1, Kpi, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { invoiceTypeTr, riskStatusTr, statusTr } from "../utils/labels";
import { collectableAccounts, splitPaymentTarget } from "../utils/contactDraft";
import { balanceHint, contactInfoRows, contactSummaryRows, contactTypeLabel } from "../utils/contactDisplay";
import { balanceMessage, waDigits } from "../utils/contactStatement";
import { mapsLink } from "../utils/geo";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import type { BankAccount } from "../utils/finance";

type Partner = { id?: string; _id?: string; name?: string; is_active?: boolean; balance?: number };
type PayForm = { type: "inflow" | "outflow"; amount: string; account_id: string; description: string };
type MsgChannel = "sms" | "email" | "whatsapp";
type TabKey = "invoices" | "payments" | "orders" | "quotes" | "projects" | "surveys" | "comm" | "cheques";

const TABS: { key: TabKey; label: string }[] = [
  { key: "invoices", label: "Faturalar" },
  { key: "payments", label: "Ödemeler" },
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

  const load = useCallback(async () => {
    try {
      const ov = await get<any>(client, `/contacts/${id}/overview`);
      setData(ov);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Cari detayı yüklenemedi."));
    }
  }, [client, id]);

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
  const counts: Record<TabKey, number> = {
    invoices: invoices.length,
    payments: payments.length,
    orders: orders.length,
    quotes: quotes.length,
    projects: projects.length,
    surveys: surveys.length,
    comm: comms.length,
    cheques: cheques.length,
  };

  const payPool = useMemo(() => {
    const accs = payForm?.type === "inflow" ? collectableAccounts(accounts) : accounts;
    const accTargets = accs.map((a) => ({
      id: idOf(a),
      label: `${a.account_name || "Hesap"} · ${fmtMoney(a.current_balance, a.currency)}`,
    }));
    const partnerTargets = (partners || [])
      .filter((p) => p.is_active !== false)
      .map((p) => ({ id: `partner:${idOf(p)}`, label: `Ortak · ${p.name || "—"} · ${fmtMoney(p.balance)}` }));
    return [...accTargets, ...partnerTargets];
  }, [accounts, partners, payForm?.type]);

  const openPay = async () => {
    if (!canBank) { setError("Tahsilat yetkiniz yok."); return; }
    try {
      const [accs, pars] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
      ]);
      setAccounts(accs || []);
      setPartners(pars || []);
      const isIn = bal >= 0;
      const pool = isIn ? collectableAccounts(accs || []) : (accs || []);
      const firstAcc = pool[0] ? idOf(pool[0]) : "";
      const firstPartner = (pars || []).find((p) => p.is_active !== false);
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

  return (
    <Screen onRefresh={load}>
      <H1>{c.name || name || "Cari"}</H1>
      <Muted>{[c.company_title, c.tax_number_or_id, c.city].filter(Boolean).join(" · ")}</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}

      {canEditContact ? (
        <PrimaryButton title="Cariyi düzenle" onPress={() => go("ContactEdit", { id })} color={colors.secondary} testID="detail-edit-contact-btn" />
      ) : null}
      <PrimaryButton title="Ekstre gönder" onPress={() => go("ContactStatement", { id, name: c.name || name })} color={colors.indigo} testID="detail-statement-btn" />
      {canInvoice ? (
        <PrimaryButton title="Satış yap" onPress={() => go("InvoiceNew", { type: "sales", ...docParams })} color={colors.secondary} testID="detail-sell-btn" />
      ) : null}
      {canInvoice ? (
        <PrimaryButton title="Alış yap" onPress={() => go("InvoiceNew", { type: "purchase", ...docParams })} testID="detail-buy-btn" />
      ) : null}
      {canBank ? (
        <PrimaryButton title="Tahsilat" onPress={openPay} color={colors.primary} testID="detail-collect-btn" />
      ) : null}
      <PrimaryButton title="Mesaj" onPress={openMessage} color={colors.indigo} testID="detail-message-btn" />
      <PrimaryButton
        title={c.b2b_enabled ? "B2B portal linki" : "B2B erişimi ver"}
        onPress={grantB2b}
        loading={b2bBusy}
        color={colors.indigo}
        testID="detail-b2b-access-btn"
      />

      {payForm ? (
        <Card testID="collect-form">
          <Muted>Tahsilat / ödeme</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            <Chip label="Tahsilat (müşteriden)" active={payForm.type === "inflow"} testID="collect-type-in" onPress={() => setPayForm({ ...payForm, type: "inflow" })} />
            <Chip label="Ödeme (cariye)" active={payForm.type === "outflow"} testID="collect-type-out" color={colors.danger} onPress={() => setPayForm({ ...payForm, type: "outflow" })} />
          </Row>
          <Muted>{payForm.type === "inflow" ? "Kasa / banka / POS / ortak — kredi kartı yok" : "Kasa / banka / kart / ortak"}</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            {payPool.map((t) => (
              <Chip key={t.id} label={t.label} active={payForm.account_id === t.id} testID={`collect-account-${t.id}`} onPress={() => setPayForm({ ...payForm, account_id: t.id })} />
            ))}
          </Row>
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

      {c.phone ? <PrimaryButton title={`Ara ${c.phone}`} onPress={() => Linking.openURL(`tel:${c.phone}`)} /> : null}
      {c.email ? <PrimaryButton title={`E-posta ${c.email}`} color={colors.primary} onPress={() => Linking.openURL(`mailto:${c.email}`)} /> : null}
      {c.phone ? <PrimaryButton title="WhatsApp" color="#128C7E" onPress={() => Linking.openURL(`https://wa.me/${waDigits(c.phone)}`)} /> : null}
      {mapsLink(c) ? (
        <PrimaryButton
          title="Konuma git"
          color={colors.primary}
          testID="detail-location-btn"
          onPress={() => Linking.openURL(String(mapsLink(c)))}
        />
      ) : null}

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
        !payments.length ? <Muted>Ödeme yok.</Muted> : payments.map((p: any, idx: number) => (
          <ListRow
            key={idOf(p) || idx}
            testID={`detail-pay-${idOf(p) || idx}`}
            title={p.type === "inflow" ? "Tahsilat" : p.type === "outflow" ? "Ödeme" : p.type || "Hareket"}
            subtitle={[fmtDate(p.date), p.account_name, p.description].filter(Boolean).join(" · ")}
            right={fmtMoney(p.amount)}
          />
        ))
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

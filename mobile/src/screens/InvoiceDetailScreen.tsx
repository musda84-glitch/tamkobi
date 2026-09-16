import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { Alert, Platform, Pressable, Text } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Badge, Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import type { Invoice } from "../types";
import {
  canDeleteInvoice,
  E_TYPES,
  isGibIssued,
  isIncomingPurchasePending,
  remainingAmount,
} from "../utils/invoiceDraft";
import { eTypeTr, invoiceTypeTr, statusTr, tradeKindTr } from "../utils/labels";
import { fmtDate, fmtMoney, idOf } from "../utils/money";

type BankAccount = { id?: string; _id?: string; account_name?: string; bank_name?: string; type?: string; currency?: string };

function confirmAction(title: string, msg: string, onYes: () => void) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(msg)) onYes();
    return;
  }
  Alert.alert(title, msg, [
    { text: "Vazgeç", style: "cancel" },
    { text: "Tamam", style: "destructive", onPress: onYes },
  ]);
}

export function InvoiceDetailScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/invoices", "edit");
  const { id } = useLocalSearchParams<{ id: string }>();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await get<Invoice>(client, `/invoices/${id}`);
      setInv(data);
      setDueDate(String(data.due_date || "").slice(0, 10));
      setNotes(data.notes || "");
      const left = remainingAmount(data);
      setPayAmount(left ? String(left) : "");
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Fatura yüklenemedi."));
    }
  }, [client, id]);

  const loadAccounts = useCallback(async () => {
    try {
      const rows = await get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId });
      setAccounts(rows || []);
      setAccountId((prev) => prev || (rows?.length ? idOf(rows[0]) : ""));
    } catch {
      setAccounts([]);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); loadAccounts(); }, [load, loadAccounts]));

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  if (!inv) return <Screen><ErrorBanner message={error || "Fatura bulunamadı."} /></Screen>;

  const issued = isGibIssued(inv);
  const leftover = remainingAmount(inv);
  const incomingPending = isIncomingPurchasePending(inv);
  const draft = inv.status === "draft";

  const remove = () => {
    if (!canDeleteInvoice(inv) || !canEdit) return;
    const kind = inv.status === "draft" ? "taslak fatura" : "kağıt fatura";
    confirmAction("Faturayı sil", `${inv.invoice_number} numaralı ${kind} çöp kutusuna taşınsın mı?`, () => {
      run(async () => {
        await del(client, `/invoices/${id}`);
        router.back();
      }, "Silinemedi.");
    });
  };

  return (
    <Screen onRefresh={load}>
      <H1>{inv.invoice_number || "Fatura"}</H1>
      <Muted>{inv.contact_name} · {fmtDate(inv.issue_date)}</Muted>
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
      <Card>
        <Row style={{ flexWrap: "wrap" }}>
          <Badge label={invoiceTypeTr(inv.invoice_type)} tone="indigo" />
          <Badge label={eTypeTr(inv.e_type)} tone="slate" />
          <Badge label={statusTr(inv.status)} tone={draft ? "amber" : "green"} />
          {inv.payment_status ? <Badge label={statusTr(inv.payment_status)} tone={inv.payment_status === "paid" ? "green" : "amber"} /> : null}
          {inv.trade_kind ? <Badge label={tradeKindTr(inv.trade_kind)} tone="indigo" /> : null}
        </Row>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text, marginTop: 8 }}>{fmtMoney(inv.grand_total, inv.currency)}</Text>
        <Muted>Ödenen {fmtMoney(inv.paid_amount, inv.currency)} · kalan {fmtMoney(leftover, inv.currency)} · vade {fmtDate(inv.due_date)}</Muted>
        {inv.gib_status ? <Muted>GİB: {inv.gib_status}{inv.gib_tracking_id ? ` · ${inv.gib_tracking_id}` : ""}</Muted> : null}
        {inv.project_number ? <Muted>Proje {inv.project_number}</Muted> : null}
      </Card>

      {(inv.items || []).map((it, i) => (
        <ListRow
          key={i}
          title={String(it.product_name || it.name || "Kalem")}
          subtitle={`${it.quantity} ${String(it.unit || "")} × ${fmtMoney(it.unit_price, inv.currency)} · KDV %${it.vat_rate ?? 0}${it.discount_rate ? ` · %${it.discount_rate} isk.` : ""}`}
          right={fmtMoney(it.total_incl || it.total, inv.currency)}
        />
      ))}

      {canEdit && draft ? (
        <PrimaryButton title="Taslağı düzenle" onPress={() => go("InvoiceEdit", { id })} color={colors.primary} testID="inv-edit" />
      ) : null}
      {canEdit && draft ? (
        <PrimaryButton
          title="Onayla (cariye işle)"
          onPress={() => run(async () => {
            await post(client, `/invoices/${id}/approve`);
            setMessage("Fatura onaylandı; cari bakiyesi ve stok işlendi.");
          }, "Onaylanamadı.")}
          loading={busy}
          color={colors.primary}
          testID="inv-approve"
        />
      ) : null}

      {canEdit && !issued && !incomingPending && inv.invoice_type !== "dispatch" ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>GİB'e kes</Text>
          <Muted>E-Fatura, e-Arşiv, e-İhracat veya kağıt olarak kesin.</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            {E_TYPES.filter((t) => t.key !== "e_dispatch").map((t) => (
              <Pressable
                key={t.key}
                testID={`inv-issue-${t.key}`}
                onPress={() => run(async () => {
                  await post(client, `/invoices/${id}/send-to-gib`, { e_type: t.key });
                  setMessage(`${t.label} olarak kesildi.`);
                }, "Fatura kesilemedi.")}
                style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ fontWeight: "700", fontSize: 12, color: colors.text }}>{t.label}</Text>
              </Pressable>
            ))}
          </Row>
        </Card>
      ) : null}

      {canEdit && incomingPending ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Gelen e-fatura</Text>
          <Muted>Ticari kabul veya ret GİB'e iletilir (8 gün).</Muted>
          <PrimaryButton
            title="Gelen faturayı onayla"
            onPress={() => confirmAction("Gelen e-fatura", `${inv.invoice_number} gelen e-faturası onaylansın mı?`, () => {
              run(async () => {
                await post(client, `/invoices/${id}/accept-incoming`);
                setMessage("Gelen e-fatura onaylandı.");
              }, "Onaylanamadı.");
            })}
            color={colors.primary}
            testID="inv-accept-incoming"
          />
          <Field label="Ret nedeni (opsiyonel)" testID="inv-reject-reason" value={rejectReason} onChangeText={setRejectReason} />
          <PrimaryButton
            title="Gelen faturayı reddet"
            onPress={() => confirmAction("Gelen e-fatura", `${inv.invoice_number} gelen e-faturası reddedilsin mi?`, () => {
              run(async () => {
                await post(client, `/invoices/${id}/reject-incoming`, { reason: rejectReason });
                setMessage("Gelen e-fatura reddedildi.");
              }, "Reddedilemedi.");
            })}
            color={colors.danger}
            testID="inv-reject-incoming"
          />
        </Card>
      ) : null}

      {canEdit && leftover > 0.01 && !draft && inv.invoice_type !== "dispatch" ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Tahsilat / ödeme</Text>
          <Field label="Tutar" testID="inv-pay-amount" value={payAmount} onChangeText={setPayAmount} keyboardType="decimal-pad" />
          {accounts.length ? (
            <>
              <Muted>Kasa / banka</Muted>
              {accounts.slice(0, 12).map((a) => (
                <ListRow
                  key={idOf(a)}
                  title={a.account_name || a.bank_name || "Hesap"}
                  subtitle={[a.type, a.currency].filter(Boolean).join(" · ")}
                  onPress={() => setAccountId(idOf(a))}
                />
              ))}
              {accountId ? <Muted>Seçili hesap: {accounts.find((a) => idOf(a) === accountId)?.account_name || accountId}</Muted> : null}
            </>
          ) : <Muted>Hesap yok — tutar cariye işlenir.</Muted>}
          <PrimaryButton
            title={busy ? "Kaydediliyor…" : "Tahsilatı kaydet"}
            testID="inv-record-payment"
            loading={busy}
            color={colors.primary}
            onPress={() => {
              const amount = Number(String(payAmount).replace(",", "."));
              if (!(amount > 0)) { setError("Lütfen geçerli bir tutar girin."); return; }
              run(async () => {
                await post(client, `/invoices/${id}/record-payment`, { amount, account_id: accountId || undefined });
                setMessage("Tahsilat/ödeme kaydı işlendi.");
              }, "Ödeme kaydedilemedi.");
            }}
          />
        </Card>
      ) : null}

      {canEdit && !draft ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Kesilmiş belgede düzenlenebilir</Text>
          <Field label="Vade tarihi" testID="inv-due-edit" value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" />
          <Field label="Not" testID="inv-notes-edit" value={notes} onChangeText={setNotes} />
          <PrimaryButton
            title="Vade ve notu kaydet"
            testID="inv-save-issued"
            color={colors.secondary}
            loading={busy}
            onPress={() => run(async () => {
              await put(client, `/invoices/${id}`, { due_date: dueDate, notes });
              setMessage("Vade ve not güncellendi.");
            }, "Güncellenemedi.")}
          />
        </Card>
      ) : null}

      {canEdit && inv.invoice_type !== "dispatch" && !draft ? (
        <PrimaryButton
          title="İrsaliye oluştur"
          testID="inv-create-dispatch"
          color={colors.indigo}
          loading={busy}
          onPress={() => run(async () => {
            const r = await post<{ dispatch?: Invoice; message?: string; status?: string }>(client, `/invoices/${id}/create-dispatch`);
            setMessage(r.message || "İrsaliye oluşturuldu.");
            const did = idOf(r.dispatch);
            if (did) go("InvoiceDetail", { id: did });
          }, "İrsaliye oluşturulamadı.")}
        />
      ) : null}

      {canEdit && canDeleteInvoice(inv) ? (
        <Pressable onPress={remove} testID="inv-delete" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14 }}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: "800" }}>{draft ? "Taslağı sil" : "Kağıt faturayı sil"}</Text>
        </Pressable>
      ) : null}

        {inv.notes ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Not</Text>
          <Muted>{inv.notes}</Muted>
        </Card>
      ) : null}
    </Screen>
  );
}

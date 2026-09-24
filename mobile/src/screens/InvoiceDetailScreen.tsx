import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Platform, Pressable, Text } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { Chip, n } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Badge, Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { SwipeRevealRow } from "../components/SwipeRevealRow";
import { go } from "../nav";
import { colors } from "../theme";
import type { Invoice, Product } from "../types";
import { splitPaymentTarget } from "../utils/contactDraft";
import { paymentTargetGroups, type BankAccount, type Partner } from "../utils/finance";
import { computeLine, hydrateLine, VAT_OPTIONS } from "../utils/documentLines";
import {
  canDeleteInvoice,
  canEditInvoiceItems,
  E_TYPES,
  invoiceDetailTotals,
  invoiceDipPayload,
  isGibIssued,
  isIncomingPurchasePending,
  remainingAmount,
  type GdMode,
} from "../utils/invoiceDraft";
import { eTypeTr, invoiceTypeTr, statusTr, tradeKindTr } from "../utils/labels";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { indexProductsByKey, lineItemImage, lineProductIds } from "../utils/productDisplay";
import { printInvoiceForm } from "../utils/orderShare";

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
  const { client, companyId, can, activeCompany } = useAuth();
  const canEdit = can("/invoices", "edit");
  const { id } = useLocalSearchParams<{ id: string }>();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [accountId, setAccountId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [editLine, setEditLine] = useState<{ index: number; name: string; quantity: string; unit_price: string; vat_rate: number } | null>(null);
  const [gdMode, setGdMode] = useState<GdMode>("amount");
  const [gdValue, setGdValue] = useState("");
  const [catalog, setCatalog] = useState<Record<string, Product>>({});

  const load = useCallback(async () => {
    try {
      const data = await get<Invoice>(client, `/invoices/${id}`);
      setInv(data);
      setDueDate(String(data.due_date || "").slice(0, 10));
      setNotes(data.notes || "");
      const rate = Number(data.general_discount_rate || 0);
      const amt = Number(data.general_discount_amount || 0);
      if (rate) {
        setGdMode("percent");
        setGdValue(String(rate));
      } else {
        setGdMode("amount");
        setGdValue(amt ? String(amt) : "");
      }
      const left = remainingAmount(data);
      setPayAmount(left ? String(left) : "");
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Fatura yüklenemedi."));
    }
  }, [client, id]);

  const loadAccounts = useCallback(async () => {
    try {
      const [rows, pars] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
      ]);
      setAccounts(rows || []);
      setPartners(pars || []);
      setAccountId((prev) => prev || (rows?.length ? idOf(rows[0]) : ""));
    } catch {
      setAccounts([]);
      setPartners([]);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); loadAccounts(); }, [load, loadAccounts]));

  useEffect(() => {
    const ids = lineProductIds((inv?.items || []) as Array<Record<string, unknown>>);
    if (!ids.length) {
      setCatalog({});
      return;
    }
    let cancelled = false;
    get<Product[]>(client, "/products", { company_id: companyId, lite: 1, ids: ids.join(",") })
      .then((rows) => { if (!cancelled) setCatalog(indexProductsByKey(rows)); })
      .catch(() => { if (!cancelled) setCatalog({}); });
    return () => { cancelled = true; };
  }, [client, companyId, inv?.items]);

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
  const itemsEditable = canEdit && canEditInvoiceItems(inv);
  const lines = inv.items || [];
  const totals = invoiceDetailTotals(inv, gdMode, n(gdValue));
  const gdNum = n(gdValue);

  const persistItems = (next: typeof lines, okMsg = "Kalemler güncellendi.") =>
    run(async () => {
      await put(client, `/invoices/${id}`, invoiceDipPayload(next.map((it) => hydrateLine(it)), gdMode, gdNum));
      setMessage(okMsg);
      setEditLine(null);
      setOpenRow(null);
    }, "Kalemler kaydedilemedi.");

  const saveDip = () => {
    if (!itemsEditable) {
      setError("Kesilmiş faturada dip toplam değiştirilemez. Taslakken genel iskontoyu güncelleyin.");
      return;
    }
    persistItems(lines, "Dip toplamlar güncellendi.");
  };

  const blockedItems = () => {
    setOpenRow(null);
    setError("Kesilmiş faturada kalemler değiştirilemez. Taslakken sola kaydırarak düzenleyin veya silin.");
  };

  const openItemEdit = (index: number) => {
    if (!itemsEditable) { blockedItems(); return; }
    const it = lines[index] || {};
    setOpenRow(null);
    setEditLine({
      index,
      name: String(it.product_name || it.name || ""),
      quantity: String(it.quantity ?? 1),
      unit_price: String(it.unit_price ?? 0),
      vat_rate: Number(it.vat_rate) || 0,
    });
  };

  const removeItem = (index: number) => {
    if (!itemsEditable) { blockedItems(); return; }
    const named = lines.filter((it) => it.product_name || it.name);
    if (named.length <= 1) {
      setOpenRow(null);
      setError("En az bir kalem gerekli.");
      return;
    }
    const label = String(lines[index]?.product_name || lines[index]?.name || "Kalem");
    confirmAction("Kalemi sil", `${label} satırı silinsin mi?`, () => {
      persistItems(lines.filter((_, i) => i !== index));
    });
  };

  const saveItemEdit = () => {
    if (!editLine || !itemsEditable) return;
    const qty = Number(String(editLine.quantity).replace(",", "."));
    const price = Number(String(editLine.unit_price).replace(",", "."));
    if (!editLine.name.trim()) { setError("Kalem adı gerekli."); return; }
    if (!(qty > 0) || !(price >= 0)) { setError("Miktar ve fiyat geçerli olmalı."); return; }
    persistItems(lines.map((it, i) => {
      if (i !== editLine.index) return it;
      return computeLine(hydrateLine({
        ...it,
        name: editLine.name.trim(),
        product_name: editLine.name.trim(),
        quantity: qty,
        unit_price: price,
        vat_rate: editLine.vat_rate,
      }));
    }));
  };

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
      <PrimaryButton
        title="Yazdır"
        testID="inv-print"
        color={colors.slate800}
        loading={busy}
        onPress={() => run(async () => {
          await printInvoiceForm(inv, activeCompany, client);
          setMessage(inv.invoice_type === "dispatch" ? "İrsaliye yazdırmaya gönderildi." : "Fatura yazdırmaya gönderildi.");
        }, "Yazdırılamadı.")}
      />
      <Card>
        <Row style={{ flexWrap: "wrap" }}>
          <Badge label={invoiceTypeTr(inv.invoice_type)} tone="indigo" />
          <Badge label={eTypeTr(inv.e_type)} tone="slate" />
          <Badge label={statusTr(inv.status)} tone={draft ? "amber" : "green"} />
          {inv.payment_status ? <Badge label={statusTr(inv.payment_status)} tone={inv.payment_status === "paid" ? "green" : "amber"} /> : null}
          {inv.trade_kind ? <Badge label={tradeKindTr(inv.trade_kind)} tone="indigo" /> : null}
        </Row>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text, marginTop: 8 }} testID="inv-header-total">{fmtMoney(totals.grandTotal, inv.currency)}</Text>
        <Muted>Ödenen {fmtMoney(inv.paid_amount, inv.currency)} · kalan {fmtMoney(leftover, inv.currency)} · vade {fmtDate(inv.due_date)}</Muted>
        {inv.gib_status ? <Muted>GİB: {inv.gib_status}{inv.gib_tracking_id ? ` · ${inv.gib_tracking_id}` : ""}</Muted> : null}
        {inv.project_number ? <Muted>Proje {inv.project_number}</Muted> : null}
      </Card>

      {canEdit ? <Muted>Kalemi düzenlemek veya silmek için satırı sola kaydırın.</Muted> : null}
      {lines.map((it, i) => {
        const row = (
          <ListRow
            title={String(it.product_name || it.name || "Kalem")}
            subtitle={`${it.quantity} ${String(it.unit || "")} × ${fmtMoney(it.unit_price, inv.currency)} · KDV %${it.vat_rate ?? 0}${it.discount_rate ? ` · %${it.discount_rate} isk.` : ""}`}
            right={fmtMoney(it.total_incl || it.total, inv.currency)}
            image={lineItemImage(it as Record<string, unknown>, catalog)}
          />
        );
        if (!canEdit) return <React.Fragment key={i}>{row}</React.Fragment>;
        return (
          <SwipeRevealRow
            key={i}
            rowKey={String(i)}
            openKey={openRow}
            onOpen={setOpenRow}
            onEdit={() => openItemEdit(i)}
            onDelete={() => removeItem(i)}
            testID={`inv-item-${i}`}
          >
            {row}
          </SwipeRevealRow>
        );
      })}

      <Card testID="inv-dip-totals">
        <Text style={{ fontWeight: "800", color: colors.text }}>Dip toplamlar</Text>
        <Row style={{ justifyContent: "space-between" }}><Muted>Mal / hizmet</Muted><Text style={{ fontWeight: "700" }}>{fmtMoney(totals.itemsSum, inv.currency)}</Text></Row>
        {totals.lineDiscount > 0 ? (
          <Row style={{ justifyContent: "space-between" }}><Muted>Satır iskontoları</Muted><Text style={{ fontWeight: "700", color: colors.danger }}>-{fmtMoney(totals.lineDiscount, inv.currency)}</Text></Row>
        ) : null}
        <Muted>Genel iskonto</Muted>
        {itemsEditable ? (
          <>
            <Row>
              <Chip label="%" active={gdMode === "percent"} onPress={() => setGdMode("percent")} testID="gd-mode-percent" />
              <Chip label="₺" active={gdMode === "amount"} onPress={() => setGdMode("amount")} testID="gd-mode-amount" />
            </Row>
            <Field
              label={gdMode === "percent" ? "Genel iskonto %" : "Genel iskonto tutarı"}
              testID="general-discount-input"
              value={gdValue}
              onChangeText={setGdValue}
              keyboardType="decimal-pad"
            />
          </>
        ) : (
          <Muted>{inv.general_discount_rate ? `%${inv.general_discount_rate}` : fmtMoney(inv.general_discount_amount || 0, inv.currency)}</Muted>
        )}
        {totals.gd > 0 ? (
          <Row style={{ justifyContent: "space-between" }}><Muted>Genel iskonto</Muted><Text style={{ fontWeight: "700", color: colors.danger }}>-{fmtMoney(totals.gd, inv.currency)}</Text></Row>
        ) : null}
        <Row style={{ justifyContent: "space-between" }}><Muted>Ara toplam</Muted><Text style={{ fontWeight: "700" }} testID="inv-dip-subtotal">{fmtMoney(totals.subtotal, inv.currency)}</Text></Row>
        <Row style={{ justifyContent: "space-between" }}><Muted>Toplam KDV</Muted><Text style={{ fontWeight: "700" }} testID="inv-vat-total">{fmtMoney(totals.vat, inv.currency)}</Text></Row>
        {totals.withholding > 0 ? (
          <Row style={{ justifyContent: "space-between" }}><Muted>Tevkifat</Muted><Text style={{ fontWeight: "700", color: colors.indigo }}>-{fmtMoney(totals.withholding, inv.currency)}</Text></Row>
        ) : null}
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ fontSize: 18, fontWeight: "800" }}>{totals.withholding > 0 ? "Ödenecek" : "Genel toplam"}</Text>
          <Text style={{ fontSize: 18, fontWeight: "800", color: colors.primary }} testID="inv-grand-total">{fmtMoney(totals.grandTotal, inv.currency)}</Text>
        </Row>
        {itemsEditable ? (
          <PrimaryButton
            title={busy ? "Kaydediliyor…" : "Dip toplamı kaydet"}
            testID="inv-dip-save"
            color={colors.primary}
            loading={busy}
            onPress={saveDip}
          />
        ) : (
          <Muted>Kesilmiş belgede dip toplam GİB kaydına bağlıdır; kalem veya iskonto değiştirilemez.</Muted>
        )}
      </Card>

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
          {accounts.length || partners.length ? (
            <GroupedSelect
              label={inv.invoice_type === "sales" ? "Kasa / banka / POS / ortak (tahsilat)" : "Kasa / banka / kart / ortak"}
              testID="inv-pay-account-select"
              value={accountId}
              onChange={setAccountId}
              emptyLabel="Hesapsız — cariye işle"
              groups={paymentTargetGroups(accounts, partners, { collectableOnly: inv.invoice_type === "sales" })}
            />
          ) : <Muted>Hesap yok — tutar cariye işlenir.</Muted>}
          <PrimaryButton
            title={busy ? "Kaydediliyor…" : "Tahsilatı kaydet"}
            testID="inv-record-payment"
            loading={busy}
            color={colors.primary}
            onPress={() => {
              const amount = Number(String(payAmount).replace(",", "."));
              if (!(amount > 0)) { setError("Lütfen geçerli bir tutar girin."); return; }
              const target = splitPaymentTarget(accountId);
              run(async () => {
                await post(client, `/invoices/${id}/record-payment`, {
                  amount,
                  account_id: target.account_id || undefined,
                  partner_id: target.partner_id || undefined,
                });
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

      <B2BSheet
        visible={!!editLine}
        title="Kalemi düzenle"
        subtitle={inv.invoice_number}
        onClose={() => setEditLine(null)}
        testID="inv-item-edit"
      >
        <Field label="Ad" testID="inv-item-name" value={editLine?.name || ""} onChangeText={(v) => setEditLine((cur) => (cur ? { ...cur, name: v } : cur))} />
        <Field label="Miktar" testID="inv-item-qty" value={editLine?.quantity || ""} onChangeText={(v) => setEditLine((cur) => (cur ? { ...cur, quantity: v } : cur))} keyboardType="decimal-pad" />
        <Field label="Birim fiyat" testID="inv-item-price" value={editLine?.unit_price || ""} onChangeText={(v) => setEditLine((cur) => (cur ? { ...cur, unit_price: v } : cur))} keyboardType="decimal-pad" />
        <Muted>KDV</Muted>
        <Row>
          {VAT_OPTIONS.map((v) => (
            <Chip
              key={v}
              label={`%${v}`}
              active={editLine?.vat_rate === v}
              onPress={() => setEditLine((cur) => (cur ? { ...cur, vat_rate: v } : cur))}
              testID={`inv-item-vat-${v}`}
            />
          ))}
        </Row>
        <PrimaryButton title={busy ? "Kaydediliyor…" : "Kalemi kaydet"} onPress={saveItemEdit} loading={busy} color={colors.primary} testID="inv-item-save" />
      </B2BSheet>
    </Screen>
  );
}

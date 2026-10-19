import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { ApiHttpError } from "../api/errors";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip, n } from "../components/chips";
import { DraftInvoiceFaturalastir } from "../components/DraftInvoiceFaturalastir";
import { IncomingInvoiceFaturalastir } from "../components/IncomingInvoiceFaturalastir";
import { ElektronikFaturaOnayModal } from "../components/ElektronikFaturaOnayModal";
import { GroupedSelect } from "../components/GroupedSelect";
import { InvoiceLineSheet } from "../components/InvoiceLineSheet";
import { MoneyInput } from "../components/MoneyInput";
import { Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { SwipeRevealRow } from "../components/SwipeRevealRow";
import { useLiveRefresh } from "../live/useLiveRefresh";
import { go } from "../nav";
import { colors } from "../theme";
import type { Invoice, Product } from "../types";
import { splitPaymentTarget } from "../utils/contactDraft";
import type { EfaturaOnayPayload } from "../utils/efaturaOnay";
import { canFaturalastirDraftInvoice, issueInvoiceFromOnay } from "../utils/invoiceFaturalastir";
import { paymentTargetGroups, type BankAccount, type Partner } from "../utils/finance";
import { canRemoveInvoiceLine, hydrateLine, matchProductVariant, type InvoiceLine } from "../utils/documentLines";
import {
  canCancelInvoice,
  canDeleteInvoice,
  invoiceDeleteConfirmMessage,
  canEditInvoice,
  canEditInvoiceItems,
  E_TYPES,
  invoiceDetailTotals,
  invoiceDipPayload,
  isGibIssued,
  isIncomingPurchaseInvoice,
  isIncomingPurchasePending,
  remainingAmount,
  type GdMode,
} from "../utils/invoiceDraft";
import { askInvoiceDatePrompt, INVOICE_DATE_PROMPT, shouldAskInvoiceDatePrompt } from "../utils/invoiceDocDate";
import { eTypeTr, invoiceTypeTr } from "../utils/labels";
import { invoiceListBadge } from "../utils/invoiceListPage";
import {
  fetchLineProductHits,
  fillInvoiceLineFromProduct,
  lineProductDetailRequest,
  lineProductNeedsHydrate,
  type LineProductHit,
} from "../utils/lineProductSearch";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { indexProductsByKey, lineItemImage, lineProductIds } from "../utils/productDisplay";
import { printInvoiceForm } from "../utils/orderShare";
import { integratorPdfKindLabel, shouldUseIntegratorPdf } from "../utils/printIntegratorPdf";
import { invoiceCancelConfirmText } from "../utils/invoiceCancelConfirm";
import {
  canSendOutgoingDispatch,
  despatchFormFrom,
  despatchSendLabel,
  despatchSendPayload,
  isIncomingDispatch,
  validateDespatchForm,
  type DespatchForm,
} from "../utils/despatchShipment";

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
  const { client, companyId, can, activeCompany, feature } = useAuth();
  const showPrices = feature("view_prices");
  const canEdit = can("/invoices", "edit");
  const canDelete = can("/invoices", "delete");
  const { id } = useLocalSearchParams<{ id: string }>();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [accountId, setAccountId] = useState("");
  const [payAmount, setPayAmount] = useState<string | number>("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const invRef = useRef<Invoice | null>(null);
  const scrollRef = useRef<{ scrollTo?: (opts: { y: number; animated?: boolean }) => void } | null>(null);
  const payY = useRef(0);
  const [gdMode, setGdMode] = useState<GdMode>("amount");
  const [gdValue, setGdValue] = useState<string | number>("");
  const [catalog, setCatalog] = useState<Record<string, Product>>({});
  const [efaturaOpen, setEfaturaOpen] = useState(false);
  const [efaturaPreferred, setEfaturaPreferred] = useState<"e_invoice" | "e_archive" | null>(null);
  const [efaturaStampNow, setEfaturaStampNow] = useState(true);
  const [ship, setShip] = useState<DespatchForm | null>(null);
  const [shipError, setShipError] = useState("");
  const shipInit = useRef("");

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
      invRef.current = data;
      setStatus("ready");
    } catch (err) {
      const missing = err instanceof ApiHttpError && err.status === 404;
      if (missing) {
        invRef.current = null;
        setInv(null);
        setStatus("notfound");
        setError(null);
        return;
      }
      setError(apiErrorMessage(err, "Fatura yüklenemedi."));
      if (!invRef.current) setStatus("error");
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
  useLiveRefresh(() => { load(); loadAccounts(); }, ["invoices", "cash", "contacts", "orders"]);

  useEffect(() => {
    if (!inv || !canSendOutgoingDispatch(inv) || shipInit.current === String(id || "")) return;
    let cancelled = false;
    (async () => {
      let defs: Record<string, string> = {};
      try {
        const settings = await get<{ despatch_defaults?: Record<string, string> }>(client, "/einvoice/settings", { company_id: companyId });
        defs = settings?.despatch_defaults || {};
      } catch {
        defs = {};
      }
      let fallback = "";
      if (!String(inv.shipping_address || inv.address || "").trim() && inv.contact_id) {
        try {
          const contact = await get<{ address?: string }>(client, `/contacts/${inv.contact_id}`);
          fallback = String(contact?.address || "");
        } catch {
          fallback = "";
        }
      }
      if (cancelled) return;
      shipInit.current = String(id || "");
      setShip(despatchFormFrom(inv, defs, fallback));
      setShipError("");
    })();
    return () => { cancelled = true; };
  }, [client, companyId, id, inv]);

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

  if (status === "loading") {
    return (
      <Screen onRefresh={load}>
        <View testID="inv-detail-loading" style={{ gap: 8 }}>
          <View style={{ height: 28, width: 160, borderRadius: 8, backgroundColor: "#E2E8F0" }} />
          <View style={{ height: 120, borderRadius: 16, backgroundColor: "#E2E8F0" }} />
          <Muted>Yükleniyor…</Muted>
        </View>
      </Screen>
    );
  }

  if (status === "notfound") {
    return (
      <Screen onRefresh={load}>
        <View testID="inv-detail-notfound">
          <ErrorBanner message="Fatura bulunamadı." />
        </View>
      </Screen>
    );
  }

  if (status === "error" || !inv) {
    return (
      <Screen onRefresh={load}>
        <ErrorBanner message={error || "Fatura yüklenemedi."} />
        <PrimaryButton title="Tekrar dene" onPress={() => { void load(); }} testID="inv-detail-retry" color={colors.primary} />
      </Screen>
    );
  }

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
      setEditIndex(null);
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

  const confirmEBelge = async (payload: EfaturaOnayPayload) => {
    const label = payload.eType === "e_invoice" ? "E-Fatura" : "E-Arşiv";
    setBusy(true);
    setMessage(null);
    try {
      await issueInvoiceFromOnay(client, inv, payload);
      setError(null);
      setMessage(`${label} olarak kesildi.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Fatura kesilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const openItemEdit = (index: number) => {
    if (!itemsEditable) { blockedItems(); return; }
    setOpenRow(null);
    setEditIndex(index);
  };

  const loadLineHits = async (q: string) => fetchLineProductHits({
    search: (path, query) => get(client, path, query),
    companyId,
    query: q,
  });

  const resolveDetailProduct = async (hit: LineProductHit | Product, current: InvoiceLine, scanCode?: string) => {
    let prod = hit as Product;
    if (lineProductNeedsHydrate(prod) && idOf(prod)) {
      try {
        prod = await get<Product>(client, lineProductDetailRequest(idOf(prod)).path);
      } catch {
        /* keep the hit */
      }
    }
    const variant = scanCode ? matchProductVariant(prod, scanCode) : undefined;
    return fillInvoiceLineFromProduct(current, prod, inv.invoice_type || "sales", {
      exportInvoice: inv.trade_kind === "export" || inv.e_type === "e_export",
      variant,
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

  const remove = () => {
    if (!canDeleteInvoice(inv) || !canDelete) return;
    confirmAction("Faturayı sil", invoiceDeleteConfirmMessage(inv), () => {
      run(async () => {
        await del(client, `/invoices/${id}`);
        router.back();
      }, "Silinemedi.");
    });
  };

  const cancel = () => {
    if (!canCancelInvoice(inv) || !canEdit) return;
    confirmAction(
      "Faturayı iptal et",
      invoiceCancelConfirmText(inv, isGibIssued(inv)),
      () => {
        run(async () => {
          const r = await post<{ message?: string }>(client, `/invoices/${id}/cancel`, {});
          setMessage(r.message || "Fatura iptal edildi.");
        }, "İptal edilemedi.");
      },
    );
  };

  const gibBadge = invoiceListBadge(inv);
  const ettn = String(inv.gib_uuid || "").trim();
  const track = String(inv.gib_tracking_id || "").trim();
  const canOpenEditor = canEdit && canEditInvoice(inv) && !isIncomingDispatch(inv);
  const showDispatch = canEdit && inv.invoice_type !== "dispatch" && !draft;
  const showPay = canEdit && !draft && inv.invoice_type !== "dispatch" && leftover > 0.01;
  const printDoc = () => run(async () => {
    await printInvoiceForm(inv, activeCompany, client);
    setMessage(
      shouldUseIntegratorPdf("invoice", inv)
        ? `${integratorPdfKindLabel(inv)} PDF yazdırmaya / paylaşıma gönderildi.`
        : inv.invoice_type === "dispatch"
          ? "İrsaliye yazdırmaya gönderildi."
          : "Fatura yazdırmaya gönderildi.",
    );
  }, "Yazdırılamadı.");
  const editedRaw = editIndex != null ? lines[editIndex] : null;
  const editedLine = editedRaw ? hydrateLine(editedRaw as Partial<InvoiceLine>) : null;
  const editedCatalog = editedRaw ? (catalog[String(editedRaw.product_id || "")] || null) : null;

  return (
    <Screen onRefresh={load} scrollRef={scrollRef}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <H1>{inv.invoice_number || "Fatura"}</H1>
        </View>
        <Pressable
          testID="inv-print"
          accessibilityLabel={shouldUseIntegratorPdf("invoice", inv) ? `${integratorPdfKindLabel(inv)} yazdır` : "Yazdır"}
          onPress={printDoc}
          style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.slate100 }}
        >
          <Ionicons name="print-outline" size={18} color={colors.text} />
        </Pressable>
      </View>
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ flex: 1, color: colors.muted, fontWeight: "700" }}>{`${fmtDate(inv.issue_date)} · ${eTypeTr(inv.e_type)} · ${invoiceTypeTr(inv.invoice_type)}`}</Text>
          {gibBadge ? (
            <View style={{ borderRadius: 999, backgroundColor: gibBadge.bg, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: gibBadge.fg, fontWeight: "800", fontSize: 11 }}>{gibBadge.label}</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontWeight: "800", fontSize: 16, color: colors.text, marginTop: 6 }}>{inv.contact_name || "Cari yok"}</Text>
        <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text, marginTop: 4 }} testID="inv-header-total">{showPrices ? fmtMoney(totals.grandTotal, inv.currency) : "—"}</Text>
        {showPrices ? (
          <Text style={{ color: colors.muted, fontWeight: "700", marginTop: 4 }}>
            {`Ödenen ${fmtMoney(inv.paid_amount, inv.currency)} · `}
            <Text style={{ color: colors.danger, fontWeight: "800" }}>{`kalan ${fmtMoney(leftover, inv.currency)}`}</Text>
            {` · vade ${fmtDate(inv.due_date)}`}
          </Text>
        ) : (
          <Muted>Vade {fmtDate(inv.due_date)}</Muted>
        )}
        {ettn || track ? (
          <Muted>
            {ettn ? `ETTN ${ettn}` : ""}
            {ettn && track ? " · " : ""}
            {track ? `GİB takip no ${track}` : ""}
          </Muted>
        ) : null}
        {inv.project_number ? <Muted>Proje {inv.project_number}</Muted> : null}
      </Card>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {showPay ? (
          <Pressable
            testID="inv-pay-open"
            onPress={() => {
              const scroll = () => scrollRef.current?.scrollTo?.({ y: Math.max(0, payY.current - 12), animated: true });
              if (typeof requestAnimationFrame === "function") requestAnimationFrame(scroll);
              else scroll();
            }}
            style={{ flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}
          >
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>💳 Ödeme al</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={printDoc}
          style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}
        >
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 12 }}>PDF / Paylaş</Text>
        </Pressable>
        {showDispatch ? (
          <Pressable
            testID="inv-create-dispatch"
            onPress={() => run(async () => {
              const r = await post<{ dispatch?: Invoice; message?: string; status?: string }>(client, `/invoices/${id}/create-dispatch`);
              setMessage(r.message || "İrsaliye oluşturuldu.");
              const did = idOf(r.dispatch);
              if (did) go("InvoiceDetail", { id: did });
            }, "İrsaliye oluşturulamadı.")}
            style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}
          >
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 12 }}>İrsaliye</Text>
          </Pressable>
        ) : null}
      </View>
      {canOpenEditor ? (
        <Pressable testID="inv-edit" onPress={() => go("InvoiceEdit", { id })} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
          <Text style={{ color: colors.primary, fontWeight: "800" }}>{draft ? "Taslağı düzenle" : "Düzenle"}</Text>
        </Pressable>
      ) : null}

      <Card>
        <Text style={{ fontWeight: "800", color: colors.muted, fontSize: 11 }}>{`SATIRLAR · ${lines.length}`}</Text>
        {lines.map((it, i) => {
          const row = (
            <ListRow
              title={String(it.product_name || it.name || "Kalem")}
              subtitle={showPrices
                ? `${it.quantity} × ${fmtMoney(it.unit_price, inv.currency)} · KDV %${it.vat_rate ?? 0}`
                : `${it.quantity} ${String(it.unit || "")}${it.vat_rate != null ? ` · KDV %${it.vat_rate}` : ""}`}
              right={showPrices ? fmtMoney(it.total_incl || it.total, inv.currency) : undefined}
              image={lineItemImage(it as Record<string, unknown>, catalog)}
              onPress={itemsEditable ? () => openItemEdit(i) : undefined}
            />
          );
          if (!canEdit) return <View key={i} testID={`inv-item-${i}`}>{row}</View>;
          return (
            <SwipeRevealRow
              key={i}
              rowKey={String(i)}
              openKey={openRow}
              onOpen={setOpenRow}
              onEdit={() => openItemEdit(i)}
              onDelete={() => removeItem(i)}
              onPress={itemsEditable ? () => openItemEdit(i) : undefined}
              testID={`inv-item-${i}`}
            >
              {row}
            </SwipeRevealRow>
          );
        })}
      </Card>

      <Card testID="inv-dip-totals">
        <Text style={{ fontWeight: "800", color: colors.muted, fontSize: 11 }}>TOPLAMLAR</Text>
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
            <MoneyInput
              label={gdMode === "percent" ? "Genel iskonto %" : "Genel iskonto tutarı"}
              testID="general-discount-input"
              value={gdValue}
              onChange={(n) => setGdValue(n ?? "")}
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

      {canEdit && ship && canSendOutgoingDispatch(inv) ? (
        <Card testID="despatch-send-form">
          <Text style={{ fontWeight: "800", color: colors.text }}>{despatchSendLabel(inv)}</Text>
          <Muted>Nakliye bilgisi GİB&apos;e gitmeden önce tamamlanır.</Muted>
          <Field label="Sevk tarihi" testID="despatch-issue-date" value={ship.issue_date} onChangeText={(v) => setShip({ ...ship, issue_date: v })} placeholder="YYYY-MM-DD" />
          <Field label="Sevk saati" testID="despatch-issue-time" value={ship.issue_time} onChangeText={(v) => setShip({ ...ship, issue_time: v })} placeholder="10:30" />
          <Field label="Teslim adresi" testID="despatch-address" value={ship.shipping_address} onChangeText={(v) => setShip({ ...ship, shipping_address: v })} />
          <Row>
            <Chip label="Kendi aracım" active={ship.despatch_mode !== "carrier"} onPress={() => setShip({ ...ship, despatch_mode: "own" })} testID="despatch-mode-own" />
            <Chip label="Taşıyıcı firma" active={ship.despatch_mode === "carrier"} onPress={() => setShip({ ...ship, despatch_mode: "carrier" })} testID="despatch-mode-carrier" />
          </Row>
          {ship.despatch_mode === "carrier" ? (
            <>
              <Field label="Taşıyıcı VKN/TCKN" testID="despatch-carrier-vkn" value={ship.despatch_carrier_vkn} onChangeText={(v) => setShip({ ...ship, despatch_carrier_vkn: v })} />
              <Field label="Ünvan" testID="despatch-carrier-name" value={ship.despatch_carrier_name} onChangeText={(v) => setShip({ ...ship, despatch_carrier_name: v })} />
              <Field label="Kargo takip no" testID="despatch-tracking" value={ship.cargo_tracking_number} onChangeText={(v) => setShip({ ...ship, cargo_tracking_number: v })} />
            </>
          ) : (
            <>
              <Field label="Plaka" testID="despatch-plate" value={ship.despatch_plate} onChangeText={(v) => setShip({ ...ship, despatch_plate: v })} placeholder="34ABC123" />
              <Field label="Şoför adı" testID="despatch-driver-first" value={ship.despatch_driver_first} onChangeText={(v) => setShip({ ...ship, despatch_driver_first: v })} />
              <Field label="Şoför soyadı" testID="despatch-driver-last" value={ship.despatch_driver_last} onChangeText={(v) => setShip({ ...ship, despatch_driver_last: v })} />
              <Field label="Şoför TCKN" testID="despatch-driver-tckn" value={ship.despatch_driver_tckn} onChangeText={(v) => setShip({ ...ship, despatch_driver_tckn: v })} />
            </>
          )}
          {shipError ? <Text testID="despatch-form-error" style={{ color: colors.danger, fontWeight: "700" }}>{shipError}</Text> : null}
          <PrimaryButton
            title={busy ? "Gönderiliyor…" : despatchSendLabel(inv)}
            testID="despatch-send-submit"
            color={colors.primary}
            loading={busy}
            onPress={() => {
              const problems = validateDespatchForm(ship);
              if (problems.length) {
                setShipError(problems.join(" "));
                return;
              }
              setShipError("");
              run(async () => {
                await post(client, `/invoices/${id}/send-to-gib`, despatchSendPayload(ship));
                setMessage("e-İrsaliye GİB'e gönderildi.");
              }, "İrsaliye gönderilemedi.");
            }}
          />
        </Card>
      ) : null}

      {canEdit && canFaturalastirDraftInvoice(inv) ? (
        <DraftInvoiceFaturalastir
          invoice={inv}
          allowed={canEdit}
          busy={busy}
          testID="inv-faturalastir"
          onIssued={(msg) => { setError(null); setMessage(msg); load(); }}
          onError={setError}
        />
      ) : null}

      {canEdit && isIncomingPurchaseInvoice(inv) ? (
        <IncomingInvoiceFaturalastir
          invoice={inv}
          testID="incoming-faturalastir"
          onPosted={(msg) => { setError(null); setMessage(msg); load(); }}
          onError={setError}
        />
      ) : null}

      {canEdit && !draft && !issued && !incomingPending && !isIncomingPurchaseInvoice(inv) && inv.invoice_type !== "dispatch" ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>GİB'e kes</Text>
          <Muted>E-Fatura / e-Arşiv onay penceresi; e-İhracat veya kağıt doğrudan kesilir.</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            {E_TYPES.filter((t) => t.key !== "e_dispatch").map((t) => (
              <Pressable
                key={t.key}
                testID={`inv-issue-${t.key}`}
                onPress={() => {
                  if (t.key === "e_invoice" || t.key === "e_archive") {
                    const openOnay = (stampNow: boolean) => {
                      setEfaturaPreferred(t.key);
                      setEfaturaStampNow(stampNow);
                      setEfaturaOpen(true);
                    };
                    if (shouldAskInvoiceDatePrompt(inv)) {
                      if (Platform.OS === "web" && typeof window !== "undefined") {
                        const stamp = window.confirm(`${INVOICE_DATE_PROMPT.message}\n\nTamam = ${INVOICE_DATE_PROMPT.stampNowLabel}`);
                        openOnay(stamp);
                        return;
                      }
                      askInvoiceDatePrompt((choice) => openOnay(choice === "stamp_now"), Alert.alert);
                      return;
                    }
                    openOnay(true);
                    return;
                  }
                  run(async () => {
                    await post(client, `/invoices/${id}/send-to-gib`, { e_type: t.key });
                    setMessage(`${t.label} olarak kesildi.`);
                  }, "Fatura kesilemedi.");
                }}
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

      {showPay ? (
        <Card testID="inv-payment-card" onLayout={(e) => { payY.current = e.nativeEvent.layout.y; }}>
          <Text style={{ fontWeight: "800", color: colors.muted, fontSize: 11 }}>ÖDEME KAYDET</Text>
          <MoneyInput label="Tutar" testID="inv-pay-amount" value={payAmount} onChange={(n) => setPayAmount(n ?? "")} />
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

      {canEdit && !draft && !isIncomingDispatch(inv) ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.muted, fontSize: 11 }}>VADE VE NOT</Text>
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

      {canEdit && canCancelInvoice(inv) ? (
        <Pressable onPress={cancel} testID="inv-cancel" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14 }}>
          <Ionicons name="close-circle-outline" size={18} color={colors.warning} />
          <Text style={{ color: colors.warning, fontWeight: "800" }}>Faturayı iptal et</Text>
        </Pressable>
      ) : null}
      {canDelete && canDeleteInvoice(inv) ? (
        <Pressable onPress={remove} testID="inv-delete" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14 }}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: "800" }}>{draft ? "Taslağı sil" : "Kağıt faturayı sil"}</Text>
        </Pressable>
      ) : null}

      {!canEdit || draft || isIncomingDispatch(inv) ? (
        inv.notes ? (
          <Card>
            <Text style={{ fontWeight: "800", color: colors.muted, fontSize: 11 }}>VADE VE NOT</Text>
            <Muted>Vade {fmtDate(inv.due_date)}</Muted>
            <Muted>{inv.notes}</Muted>
          </Card>
        ) : null
      ) : null}

      {editedLine ? (
        <InvoiceLineSheet
          key={`detail-line-${editIndex}`}
          visible={editIndex != null}
          index={editIndex ?? 0}
          count={lines.length}
          line={editedLine}
          currency={inv.currency || "TRY"}
          tradeKind={inv.trade_kind}
          allowDelete={editIndex != null && canRemoveInvoiceLine(lines, editIndex)}
          editable={itemsEditable}
          imageUri={lineItemImage((editedRaw || {}) as Record<string, unknown>, catalog)}
          stockQty={editedCatalog?.stock_quantity}
          productUnit={String(editedCatalog?.unit || editedLine.unit || "")}
          loadHits={loadLineHits}
          resolveProduct={resolveDetailProduct}
          busy={busy}
          onClose={() => setEditIndex(null)}
          onSave={(next) => {
            if (editIndex == null || !itemsEditable) return;
            persistItems(lines.map((it, i) => (i === editIndex ? next : it)));
          }}
          onDelete={() => {
            if (editIndex == null || !itemsEditable) return;
            persistItems(lines.filter((_, i) => i !== editIndex));
          }}
        />
      ) : null}

      <ElektronikFaturaOnayModal
        visible={efaturaOpen}
        invoice={inv}
        preferredEType={efaturaPreferred}
        initialStampNow={efaturaStampNow}
        onClose={() => setEfaturaOpen(false)}
        onConfirm={confirmEBelge}
      />
    </Screen>
  );
}

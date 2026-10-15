import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { confirmAction } from "../components/chips";
import { SwipeRevealRow } from "../components/SwipeRevealRow";
import { DraftInvoiceFaturalastir } from "../components/DraftInvoiceFaturalastir";
import { IncomingInvoiceFaturalastir } from "../components/IncomingInvoiceFaturalastir";
import { Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import type { Invoice } from "../types";
import { createInvoiceButtonLabel, INVOICE_FILTERS, invoiceListSubtitle, invoiceListTitle, invoiceRowDangerAction, isIncomingPurchaseInvoice } from "../utils/invoiceDraft";
import { canFaturalastirDraftInvoice } from "../utils/invoiceFaturalastir";
import { compareInvoiceActivity } from "../utils/invoiceSortStamp";
import { fmtMoney, idOf } from "../utils/money";
import { dispatchDirFromParam, splitDispatchLists } from "../utils/despatchShipment";
import { outgoingMergeIds } from "../utils/dispatchMerge";

const EXTRA_FILTERS = [
  { key: "outgoing_e", label: "Giden e" },
  { key: "incoming_e", label: "Gelen e" },
] as const;

const FILTER_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  all: { icon: "apps-outline", color: colors.slate800 },
  sales: { icon: "receipt-outline", color: colors.primary },
  purchase: { icon: "cart-outline", color: colors.indigo },
  proforma: { icon: "document-text-outline", color: "#0EA5E9" },
  return: { icon: "return-down-back-outline", color: colors.danger },
  export: { icon: "airplane-outline", color: "#0284C7" },
  import: { icon: "download-outline", color: "#7C3AED" },
  dispatch: { icon: "cube-outline", color: "#D97706" },
  outgoing_e: { icon: "arrow-up-circle-outline", color: "#059669" },
  incoming_e: { icon: "arrow-down-circle-outline", color: "#2563EB" },
};

function isOutgoingE(inv: Invoice): boolean {
  if (!["e_invoice", "e_archive", "e_export"].includes(String(inv.e_type || ""))) return false;
  if (inv.direction === "incoming" || inv.source === "edoc_inbox" || inv.edoc_id) return false;
  return inv.invoice_type !== "purchase" || inv.direction === "outgoing";
}

function isIncomingE(inv: Invoice): boolean {
  if (inv.direction === "incoming" || inv.source === "edoc_inbox" || inv.edoc_id) return true;
  return inv.invoice_type === "purchase" && ["e_invoice", "e_archive", "e_export"].includes(String(inv.e_type || ""));
}

export function InvoicesScreen() {
  const { client, companyId, can } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ dir?: string }>();
  const canEdit = can("/invoices", "edit");
  const canDelete = can("/invoices", "delete");
  const [rows, setRows] = useState<Invoice[]>([]);
  const [type, setType] = useState("all");
  const dispatchDir = dispatchDirFromParam(params.dir);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const apiType = type === "outgoing_e" || type === "incoming_e" ? undefined : (type === "all" ? undefined : type);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<Invoice[]>(client, "/invoices", { company_id: companyId, type: apiType });
      setRows(data || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Faturalar yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, apiType]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => { setPicked([]); }, [type, dispatchDir]);

  const actOnInvoice = (inv: Invoice) => {
    const kind = invoiceRowDangerAction(inv);
    if (kind === "delete") {
      if (!canDelete) { setError("Fatura silme yetkiniz yok."); return; }
      const label = inv.status === "draft" ? "taslak fatura" : "kağıt fatura";
      confirmAction("Faturayı sil", `${inv.invoice_number || "Fatura"} numaralı ${label} çöp kutusuna taşınsın mı?`, async () => {
        try {
          await del(client, `/invoices/${idOf(inv)}`);
          setOpenRow(null);
          setError(null);
          await load();
        } catch (err) {
          setError(apiErrorMessage(err, "Fatura silinemedi."));
        }
      });
      return;
    }
    if (kind === "cancel") {
      if (!canEdit) { setError("Fatura düzenleme yetkiniz yok."); return; }
      confirmAction(
        "Faturayı iptal et",
        `${inv.invoice_number || "Fatura"} numaralı e-fatura iptal edilsin mi?\nCari bakiyesi ve stok etkileri geri alınır; bağlı siparişler silinebilir hale gelir. İptal kaydı listeden gizlenir.`,
        async () => {
          try {
            await post(client, `/invoices/${idOf(inv)}/cancel`, {});
            setOpenRow(null);
            setError(null);
            await load();
          } catch (err) {
            setError(apiErrorMessage(err, "Fatura iptal edilemedi."));
          }
        },
      );
    }
  };

  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = [...rows];
    if (type === "outgoing_e") list = list.filter(isOutgoingE);
    else if (type === "incoming_e") list = list.filter(isIncomingE);
    if (s) {
      list = list.filter((i) => [i.invoice_number, i.contact_name, i.gib_status, i.gib_tracking_id]
        .some((v) => String(v || "").toLowerCase().includes(s)));
    }
    list.sort((a, b) => compareInvoiceActivity(a, b, "desc"));
    return list;
  }, [q, rows, type]);

  const dispatchSplit = useMemo(
    () => (type === "dispatch" ? splitDispatchLists(searched) : { incoming: [] as Invoice[], outgoing: [] as Invoice[] }),
    [searched, type],
  );
  const filtered = type === "dispatch"
    ? (dispatchDir === "in" ? dispatchSplit.incoming : dispatchSplit.outgoing)
    : searched;

  const showMergePick = type === "dispatch" && dispatchDir === "out" && canEdit;
  const mergeIds = showMergePick ? outgoingMergeIds(filtered, picked) : [];
  const togglePick = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const mergeDispatches = () => {
    if (mergeIds.length < 2) return;
    confirmAction(
      "Tek faturada birleştir",
      `${mergeIds.length} giden irsaliye tek taslak satış faturasında birleştirilsin mi?`,
      async () => {
        try {
          const key = `${Date.now()}-${mergeIds.join("-")}`;
          await post(client, "/dispatches/merge-to-invoice", { dispatch_ids: mergeIds, idempotency_key: key });
          setPicked([]);
          setError(null);
          await load();
        } catch (err) {
          setError(apiErrorMessage(err, "İrsaliyeler birleştirilemedi."));
        }
      },
      "Birleştir",
    );
  };

  const filterTabs = [...INVOICE_FILTERS, ...EXTRA_FILTERS];

  return (
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyTop={(
        <>
          <Field label="Ara" value={q} onChangeText={setQ} placeholder="Fatura no / cari / GİB" testID="inv-search" />
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {filterTabs.map((f) => {
              const meta = FILTER_ICONS[f.key] || FILTER_ICONS.all;
              const active = type === f.key;
              return (
                <Pressable
                  key={f.key}
                  testID={`filter-tab-${f.key}`}
                  accessibilityLabel={f.label}
                  onPress={() => setType(f.key)}
                  style={{ width: "20%", alignItems: "center", gap: 4, paddingVertical: 6 }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: active ? meta.color : colors.slate100,
                    }}
                  >
                    <Ionicons name={meta.icon} size={18} color={active ? "#fff" : colors.muted} />
                  </View>
                  <Text numberOfLines={1} style={{ fontSize: 9, fontWeight: "800", color: active ? meta.color : colors.muted }}>
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {type === "dispatch" ? (
            <View style={{ flexDirection: "row", gap: 8 }} testID="dispatch-dir-tabs">
              {([
                { id: "out" as const, label: "Giden", count: dispatchSplit.outgoing.length },
                { id: "in" as const, label: "Gelen", count: dispatchSplit.incoming.length },
              ]).map((tab) => (
                <Pressable
                  key={tab.id}
                  testID={`dispatch-dir-${tab.id}`}
                  accessibilityState={{ selected: dispatchDir === tab.id }}
                  onPress={() => router.setParams({ dir: tab.id })}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    backgroundColor: dispatchDir === tab.id ? "#A21CAF" : colors.slate100,
                  }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 12, color: dispatchDir === tab.id ? "#fff" : colors.slate800 }}>{tab.label}</Text>
                  <Text testID={`dispatch-dir-count-${tab.id}`} style={{ fontWeight: "800", fontSize: 11, color: dispatchDir === tab.id ? "#fff" : colors.slate800 }}>{tab.count}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {showMergePick ? (
            <PrimaryButton
              title="Tek faturada birleştir"
              testID="merge-dispatches-btn"
              disabled={mergeIds.length < 2}
              onPress={mergeDispatches}
              color="#A21CAF"
            />
          ) : null}
          {canEdit ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title={createInvoiceButtonLabel(type === "outgoing_e" || type === "incoming_e" ? "all" : type)}
                  onPress={() => go("InvoiceNew", { type: type === "outgoing_e" || type === "incoming_e" ? "all" : type })}
                  color={colors.primary}
                  testID="create-new-invoice-btn"
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Gelen kutu"
                  onPress={() => go("EdocInbox")}
                  color={colors.indigo}
                  testID="inv-edoc-inbox-btn"
                />
              </View>
            </View>
          ) : null}
        </>
      )}
    >
      <ErrorBanner message={error} />
      {!filtered.length ? (
        <Empty
          icon="document-outline"
          title="Fatura yok"
          hint={canEdit ? "Yeni fatura kesin veya gelen kutudan çekin." : "Aramayı veya filtreyi değiştirin."}
        />
      ) : (
        <>
          <Muted>{filtered.length} fatura · silmek / iptal için sola kaydırın</Muted>
          {filtered.map((inv) => {
            const iid = idOf(inv);
            const danger = invoiceRowDangerAction(inv);
            const allowDanger = (danger === "delete" && canDelete) || (danger === "cancel" && canEdit);
            const showFaturalastir = canEdit && canFaturalastirDraftInvoice(inv);
            const showIncomingPost = canEdit && isIncomingPurchaseInvoice(inv);
            const row = (
              <ListRow
                testID={allowDanger ? undefined : `inv-row-${iid}`}
                title={invoiceListTitle(inv)}
                subtitle={invoiceListSubtitle(inv)}
                right={fmtMoney(inv.grand_total, inv.currency)}
                onPress={allowDanger ? undefined : () => go("InvoiceDetail", { id: iid })}
              />
            );
            const body = !allowDanger || !danger ? (
              <Fragment>{row}</Fragment>
            ) : (
              <SwipeRevealRow
                rowKey={iid}
                openKey={openRow}
                onOpen={setOpenRow}
                onPress={() => go("InvoiceDetail", { id: iid })}
                onDelete={() => actOnInvoice(inv)}
                deleteLabel={danger === "cancel" ? "İptal" : "Sil"}
                deleteColor={danger === "cancel" ? colors.warning : colors.danger}
                testID={`inv-row-${iid}`}
              >
                {row}
              </SwipeRevealRow>
            );
            return (
              <View key={iid} style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {showMergePick ? (
                    <Pressable
                      testID={`dispatch-select-${iid}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: picked.includes(iid) }}
                      onPress={() => togglePick(iid)}
                    >
                      <Ionicons name={picked.includes(iid) ? "checkbox" : "square-outline"} size={22} color="#A21CAF" />
                    </Pressable>
                  ) : null}
                  <View style={{ flex: 1 }}>{body}</View>
                </View>
                {showFaturalastir ? (
                  <DraftInvoiceFaturalastir
                    invoice={inv}
                    allowed={canEdit}
                    testID={`inv-faturalastir-${iid}`}
                    onIssued={() => { setError(null); load(); }}
                    onError={setError}
                  />
                ) : null}
                {showIncomingPost ? (
                  <IncomingInvoiceFaturalastir
                    invoice={inv}
                    testID={`incoming-faturalastir-${iid}`}
                    onPosted={() => { setError(null); load(); }}
                    onError={setError}
                  />
                ) : null}
              </View>
            );
          })}
        </>
      )}
    </Screen>
  );
}

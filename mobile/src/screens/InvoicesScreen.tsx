import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { confirmAction } from "../components/chips";
import { DraftInvoiceFaturalastir } from "../components/DraftInvoiceFaturalastir";
import { IncomingInvoiceFaturalastir } from "../components/IncomingInvoiceFaturalastir";
import { SwipeRevealRow } from "../components/SwipeRevealRow";
import { Empty, ErrorBanner, PrimaryButton, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import type { Invoice } from "../types";
import { dispatchDirFromParam, isIncomingDispatch, splitDispatchLists } from "../utils/despatchShipment";
import { outgoingMergeIds } from "../utils/dispatchMerge";
import { invoiceListTitle, invoiceRowDangerAction, isIncomingPurchaseInvoice } from "../utils/invoiceDraft";
import { canFaturalastirDraftInvoice } from "../utils/invoiceFaturalastir";
import {
  INVOICE_CHIPS,
  INVOICE_SEARCH_DEBOUNCE_MS,
  INVOICE_SEGMENTS,
  appendUniqueInvoices,
  filterInvoicesLocally,
  invoiceCardMeta,
  invoiceCardNumber,
  invoiceCreateType,
  invoiceListBadge,
  localInvoiceSummary,
  resolveInvoiceList,
  summaryCountText,
  summaryMoneyText,
  type InvoiceChip,
  type InvoiceListPage,
  type InvoiceListSummary,
  type InvoiceSegment,
} from "../utils/invoiceListPage";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { printInvoiceForm } from "../utils/orderShare";

type LoadMode = "reset" | "refresh" | "append";

function chipTestId(key: InvoiceChip): string {
  if (key === "all") return "inv-chip-all";
  if (key === "unpaid") return "inv-chip-unpaid";
  if (key === "overdue") return "inv-chip-overdue";
  if (key === "partially_paid") return "inv-chip-partial";
  return `filter-tab-${key}`;
}

export function InvoicesScreen() {
  const { client, companyId, can, activeCompany } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ dir?: string }>();
  const canEdit = can("/invoices", "edit");
  const canDelete = can("/invoices", "delete");
  const [segment, setSegment] = useState<InvoiceSegment>("all");
  const [chip, setChip] = useState<InvoiceChip>("all");
  const dispatchDir = dispatchDirFromParam(params.dir);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [rows, setRows] = useState<Invoice[]>([]);
  const [serverSummary, setServerSummary] = useState<InvoiceListSummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const req = useRef(0);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const rowsRef = useRef<Invoice[]>([]);
  const seenKey = useRef<string | null>(null);
  const runRef = useRef<(mode: LoadMode) => Promise<void>>(async () => undefined);
  rowsRef.current = rows;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), INVOICE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const request = useMemo(
    () => resolveInvoiceList({ companyId, segment, chip, q: debouncedQ, page: 1 }),
    [companyId, segment, chip, debouncedQ],
  );
  const queryKey = `${request.kind}|${JSON.stringify(request.query)}`;

  const applyPage = (mode: LoadMode, items: Invoice[], page: number, more: boolean, summary: InvoiceListSummary | null) => {
    setRows((prev) => (mode === "append" ? appendUniqueInvoices(prev, items) : items));
    pageRef.current = page;
    hasMoreRef.current = more;
    setHasMore(more);
    setServerSummary(summary);
    setStatus("ready");
    setError(null);
  };

  const run = useCallback(async (mode: LoadMode) => {
    const page = mode === "append" ? pageRef.current + 1 : 1;
    const next = resolveInvoiceList({ companyId, segment, chip, q: debouncedQ, page });
    if (mode === "append" && (!hasMoreRef.current || loadingMoreRef.current || next.kind !== "server")) return;
    const id = ++req.current;
    if (mode === "append") {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else if (mode === "reset" || rowsRef.current.length === 0) {
      setRows([]);
      setServerSummary(null);
      hasMoreRef.current = false;
      setHasMore(false);
      pageRef.current = 1;
      setStatus("loading");
      setError(null);
      setRefreshing(mode === "refresh");
    } else {
      setRefreshing(true);
      setError(null);
    }
    try {
      if (next.kind === "server") {
        const data = await get<InvoiceListPage>(client, "/invoices/page", next.query);
        if (id !== req.current) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const nextPage = Number(data?.page) || page;
        applyPage(mode, items, nextPage, !!data?.has_more, data?.summary ?? null);
      } else {
        const data = await get<Invoice[]>(client, "/invoices", next.query);
        if (id !== req.current) return;
        applyPage(mode, Array.isArray(data) ? data : [], 1, false, null);
      }
    } catch (err) {
      if (id !== req.current) return;
      setError(apiErrorMessage(err, "Faturalar yüklenemedi."));
      if (mode === "append") return;
      if (mode === "refresh" && rowsRef.current.length > 0) {
        setStatus("ready");
        return;
      }
      setRows([]);
      hasMoreRef.current = false;
      setHasMore(false);
      setStatus("error");
    } finally {
      if (id === req.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, [client, companyId, segment, chip, debouncedQ]);

  runRef.current = run;

  useFocusEffect(useCallback(() => {
    const changed = seenKey.current !== queryKey;
    seenKey.current = queryKey;
    void runRef.current(changed ? "reset" : "refresh");
  }, [queryKey]));

  useEffect(() => { setPicked([]); }, [segment, chip, dispatchDir]);

  const selectSegment = (next: InvoiceSegment) => {
    setSegment(next);
    setChip((cur) => {
      if (next === "dispatch") return "all";
      if (cur === "proforma" || cur === "return" || cur === "outgoing_e" || cur === "incoming_e" || cur === "export" || cur === "import") {
        return "all";
      }
      return cur;
    });
  };

  const selectChip = (next: InvoiceChip) => {
    setChip(next);
    if (
      segment === "dispatch"
      && (next === "outgoing_e" || next === "incoming_e" || next === "export" || next === "import"
        || next === "unpaid" || next === "overdue" || next === "partially_paid")
    ) {
      setSegment("all");
    }
  };

  const reload = useCallback(() => { void run("refresh"); }, [run]);

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
          await run("refresh");
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
            await run("refresh");
          } catch (err) {
            setError(apiErrorMessage(err, "Fatura iptal edilemedi."));
          }
        },
      );
    }
  };

  const printPdf = async (inv: Invoice) => {
    const id = idOf(inv);
    if (!id || pdfId) return;
    setPdfId(id);
    try {
      const full = await get<Invoice>(client, `/invoices/${id}`);
      await printInvoiceForm(full && typeof full === "object" ? full : inv, activeCompany, client);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "PDF açılamadı."));
    } finally {
      setPdfId(null);
    }
  };

  const legacy = request.kind === "legacy";
  const searched = useMemo(
    () => (legacy ? filterInvoicesLocally(rows, debouncedQ) : rows),
    [legacy, rows, debouncedQ],
  );
  const dispatchSplit = useMemo(() => {
    if (request.kind !== "legacy" || request.query.type !== "dispatch") {
      return { incoming: [] as Invoice[], outgoing: [] as Invoice[] };
    }
    return splitDispatchLists(searched);
  }, [request, searched]);
  const visible = request.kind === "legacy" && request.query.type === "dispatch"
    ? (dispatchDir === "in" ? dispatchSplit.incoming : dispatchSplit.outgoing)
    : searched;
  const showDispatch = request.kind === "legacy" && request.query.type === "dispatch";
  const showMergePick = showDispatch && dispatchDir === "out" && canEdit;
  const mergeIds = showMergePick ? outgoingMergeIds(visible, picked) : [];
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
          await run("refresh");
        } catch (err) {
          setError(apiErrorMessage(err, "İrsaliyeler birleştirilemedi."));
        }
      },
      "Birleştir",
    );
  };

  const summary = legacy && status === "ready" ? localInvoiceSummary(visible) : serverSummary;
  const summaryCurrency = summary && "currency" in summary && typeof summary.currency === "string" ? summary.currency : "TRY";
  const segmentLive: InvoiceSegment | null = chip === "proforma" || chip === "return" ? null : segment;

  return (
    <Screen
      onRefresh={reload}
      refreshing={refreshing}
      stickyTop={(
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 22, fontWeight: "800", color: colors.text }}>Faturalar</Text>
            {canEdit ? (
              <Pressable
                testID="inv-edoc-inbox-btn"
                accessibilityLabel="Gelen kutu"
                onPress={() => go("EdocInbox")}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.slate100, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="file-tray-outline" size={18} color={colors.slate800} />
              </Pressable>
            ) : null}
            {canEdit ? (
              <Pressable
                testID="create-new-invoice-btn"
                accessibilityLabel="Yeni fatura"
                onPress={() => go("InvoiceNew", { type: invoiceCreateType(segment, chip) })}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: "#fff", fontSize: 24, fontWeight: "700", lineHeight: 26 }}>+</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", backgroundColor: colors.slate100, borderRadius: 12, padding: 4 }}>
            {INVOICE_SEGMENTS.map((item) => {
              const active = segmentLive === item.key;
              return (
                <Pressable
                  key={item.key}
                  testID={`filter-tab-${item.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => selectSegment(item.key)}
                  style={{ flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, backgroundColor: active ? "#fff" : "transparent" }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 13, color: active ? colors.text : colors.muted }}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 }}>
            <Ionicons name="search" size={16} color={colors.muted} />
            <TextInput
              testID="inv-search"
              value={q}
              onChangeText={setQ}
              placeholder="Fatura no / cari / GİB no"
              placeholderTextColor={colors.muted}
              style={{ flex: 1, fontSize: 14, fontWeight: "600", color: colors.text, paddingVertical: 8 }}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {INVOICE_CHIPS.map((item) => {
              const active = chip === item.key;
              return (
                <Pressable
                  key={item.key}
                  testID={chipTestId(item.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => selectChip(item.key)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: active ? "#F59E0B" : colors.border,
                    backgroundColor: active ? "#FFFBEB" : "#fff",
                  }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 12, color: active ? "#B45309" : colors.slate800 }}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SummaryBox testID="inv-sum-count" label="FATURA" value={summaryCountText(summary?.count)} />
            <SummaryBox testID="inv-sum-total" label="TOPLAM" value={summaryMoneyText(summary?.total_amount, summaryCurrency)} />
            <SummaryBox testID="inv-sum-draft" label="TASLAK" value={summaryCountText(summary?.draft_count)} amber />
          </View>
          {showDispatch ? (
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
        </View>
      )}
    >
      <ErrorBanner message={error} />
      {error ? (
        <Pressable
          testID="inv-retry"
          onPress={() => { void run("reset"); }}
          style={{ alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.slate100 }}
        >
          <Text style={{ fontWeight: "800", color: colors.text }}>Tekrar dene</Text>
        </Pressable>
      ) : null}
      {status === "loading" ? (
        <View testID="inv-loading" style={{ gap: 8 }}>
          <Text style={{ color: colors.muted, fontWeight: "700" }}>Yükleniyor…</Text>
          <View style={{ height: 104, borderRadius: 16, backgroundColor: colors.slate100 }} />
          <View style={{ height: 104, borderRadius: 16, backgroundColor: colors.slate100 }} />
        </View>
      ) : null}
      {status === "ready" && !visible.length ? (
        <Empty
          icon="document-outline"
          title="Fatura yok"
          hint={canEdit ? "Yeni fatura kesin veya gelen kutudan çekin." : "Aramayı veya filtreyi değiştirin."}
        />
      ) : null}
      {status !== "loading" && visible.length ? (
        <View style={{ gap: 10 }}>
          {visible.map((inv) => {
            const iid = idOf(inv);
            const danger = invoiceRowDangerAction(inv);
            const allowDanger = (danger === "delete" && canDelete) || (danger === "cancel" && canEdit);
            const draft = String(inv.status || "") === "draft";
            const showFaturalastir = canEdit && canFaturalastirDraftInvoice(inv);
            const showIncomingPost = canEdit && isIncomingPurchaseInvoice(inv);
            const openInvoice = () => {
              const editor = canEdit && draft && !isIncomingDispatch(inv);
              go(editor ? "InvoiceEdit" : "InvoiceDetail", { id: iid });
            };
            const card = (
              <Pressable testID={`inv-open-${iid}`} onPress={openInvoice}>
                <InvoiceCard inv={inv} draft={draft} />
              </Pressable>
            );
            const body = !allowDanger || !danger ? (
              <View testID={`inv-row-${iid}`}>{card}</View>
            ) : (
              <SwipeRevealRow
                rowKey={iid}
                openKey={openRow}
                onOpen={setOpenRow}
                onDelete={() => actOnInvoice(inv)}
                deleteLabel={danger === "cancel" ? "İptal" : "Sil"}
                deleteColor={danger === "cancel" ? colors.warning : colors.danger}
                testID={`inv-row-${iid}`}
              >
                {card}
              </SwipeRevealRow>
            );
            return (
              <View key={iid} style={{ gap: 8 }}>
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
                {draft ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {showFaturalastir ? (
                      <View style={{ flex: 1 }}>
                        <DraftInvoiceFaturalastir
                          invoice={inv}
                          allowed={canEdit}
                          title="⚡ Faturalaştır"
                          color="#F59E0B"
                          testID={`inv-faturalastir-${iid}`}
                          onIssued={() => { setError(null); void run("refresh"); }}
                          onError={setError}
                        />
                      </View>
                    ) : null}
                    <Pressable
                      testID={`inv-pdf-${iid}`}
                      onPress={() => { void printPdf(inv); }}
                      style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: "#F59E0B", backgroundColor: "#FFFBEB", alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ fontWeight: "800", color: "#B45309" }}>{pdfId === iid ? "…" : "PDF"}</Text>
                    </Pressable>
                  </View>
                ) : null}
                {showIncomingPost ? (
                  <IncomingInvoiceFaturalastir
                    invoice={inv}
                    testID={`incoming-faturalastir-${iid}`}
                    onPosted={() => { setError(null); void run("refresh"); }}
                    onError={setError}
                  />
                ) : null}
              </View>
            );
          })}
          {hasMore ? (
            <Pressable
              testID="inv-more"
              onPress={() => { void run("append"); }}
              style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontWeight: "800", color: colors.text }}>{loadingMore ? "Yükleniyor…" : "Daha fazla"}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

function SummaryBox({ label, value, testID, amber }: { label: string; value: string; testID: string; amber?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 8, gap: 2 }}>
      <Text style={{ fontSize: 10, fontWeight: "800", color: amber ? "#B45309" : colors.muted }}>{label}</Text>
      <Text testID={testID} numberOfLines={1} style={{ fontSize: 14, fontWeight: "800", color: amber ? "#B45309" : colors.text }}>{value}</Text>
    </View>
  );
}

function InvoiceCard({ inv, draft }: { inv: Invoice; draft: boolean }) {
  const badge = invoiceListBadge(inv);
  const meta = invoiceCardMeta(inv);
  return (
    <View
      style={{
        minHeight: 104,
        backgroundColor: "#fff",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: draft ? 4 : 1,
        borderLeftColor: draft ? "#F59E0B" : colors.border,
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 6,
        justifyContent: "center",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, color: colors.muted, fontSize: 12, fontWeight: "700" }}>
          {`${invoiceCardNumber(inv)} · ${fmtDate(inv.issue_date)}`}
        </Text>
        {badge ? (
          <View style={{ borderRadius: 999, backgroundColor: badge.bg, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: badge.fg, fontSize: 11, fontWeight: "800" }}>{badge.label}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: "800", color: colors.text }}>{invoiceListTitle(inv)}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, fontWeight: "600", color: colors.muted }}>
          {meta.eType}
          {" · "}
          <Text style={{ color: meta.pay.color, fontWeight: "800" }}>{meta.pay.label}</Text>
          {" · "}
          {meta.due}
        </Text>
        <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text }}>{fmtMoney(inv.grand_total, inv.currency)}</Text>
      </View>
    </View>
  );
}

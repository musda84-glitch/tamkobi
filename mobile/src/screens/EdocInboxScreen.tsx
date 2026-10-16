import { useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { Chip, confirmAction } from "../components/chips";
import { Badge, Empty, ErrorBanner, Field, ListRow, Muted, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import {
  EDOC_FILTERS,
  GIB_ACCEPT_CONFIRM,
  GIB_RED_OPTION_LABEL,
  canSendCommercialResponse,
  edocId,
  edocRowRight,
  edocRowSubtitle,
  edocRowTitle,
  edocStatusTr,
  inboxProcessLabel,
  inboxProcessSuccess,
  isEdocProcessable,
  pendingEdocCount,
  type EdocInboxItem,
  type EdocInboxList,
} from "../utils/edocInbox";

const PROCESS_OPTS = { update_stock: true, update_cost: true, allow_unmatched: true };

export function EdocInboxScreen() {
  const { client, companyId, can } = useAuth();
  const params = useLocalSearchParams<{ ettn?: string | string[]; id?: string | string[] }>();
  const focusEttn = (Array.isArray(params.ettn) ? params.ettn[0] : params.ettn || "").replace(/…|\.\.\.$/, "");
  const focusId = Array.isArray(params.id) ? params.id[0] : params.id || "";
  const canEdit = can("/edoc-inbox", "edit") || can("/invoices", "edit");
  const [data, setData] = useState<EdocInboxList | null>(null);
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const focusTried = useRef(false);
  const [rejectFor, setRejectFor] = useState<EdocInboxItem | null>(null);
  const [gibRed, setGibRed] = useState(true);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const rows = await get<EdocInboxList>(client, "/edocs/inbox", {
        company_id: companyId,
        status: status || undefined,
      });
      setData(rows || { items: [], counts: {} });
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Gelen e-faturalar yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, status]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items = data?.items || [];

  useEffect(() => {
    if (!focusEttn && !focusId || !data) return;
    const needle = focusEttn.toLowerCase();
    const hit = items.find((d) => (
      (focusId && edocId(d) === focusId)
      || (needle && String(d.uuid || d.ettn || "").toLowerCase().startsWith(needle))
    ));
    if (!hit) {
      if (status && !focusTried.current) {
        focusTried.current = true;
        setStatus("");
        return;
      }
      setError("Kayıt bulunamadı");
      return;
    }
    const nextQ = hit.number || hit.supplier?.name || "";
    setQ((prev) => (prev === nextQ ? prev : nextQ));
  }, [items, data, focusEttn, focusId, status]);
  const pending = pendingEdocCount(data?.counts);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? items.filter((d) => [d.supplier?.name, d.contact_name, d.number].some((v) => String(v || "").toLowerCase().includes(s)))
      : items;
    return list.slice(0, 80);
  }, [items, q]);

  const run = async (key: string, fn: () => Promise<{ message?: string } | void>, ok: string) => {
    setBusy(key);
    try {
      const r = await fn();
      setMessage((r && "message" in r && r.message) || ok);
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem başarısız."));
    } finally {
      setBusy("");
    }
  };

  const syncInbox = () => run("sync", () => post(client, "/einvoice/incoming/sync", {}, { company_id: companyId, days: 30 }), "Gelen kutu (son 30 gün) çekildi.");

  const processPending = () => confirmAction(
    "Bekleyenleri içeri al",
    "Okunabilir bekleyen belgeler alış faturasına dönüşecek. Devam?",
    () => run("batch", () => post(client, "/edocs/inbox/process-pending", PROCESS_OPTS, { company_id: companyId }), "Bekleyenler içeri alındı."),
  );

  const processOne = (doc: EdocInboxItem) => run(
    edocId(doc),
    async () => {
      const r = await post<{ message?: string }>(client, `/edocs/inbox/${edocId(doc)}/process`, PROCESS_OPTS);
      if (doc.kind === "dispatch") return { message: inboxProcessSuccess(doc) };
      return r;
    },
    inboxProcessSuccess(doc),
  );

  const rejectLocal = (doc: EdocInboxItem, why = "") => run(
    edocId(doc),
    () => post(client, `/edocs/inbox/${edocId(doc)}/reject`, { reason: why }),
    "Belge reddedildi.",
  );

  const rejectOne = (doc: EdocInboxItem) => {
    if (canSendCommercialResponse(doc)) {
      setRejectFor(doc);
      setGibRed(true);
      setReason("");
      return;
    }
    confirmAction(
      "Belgeyi reddet",
      "Bu gelen e-fatura reddedilecek. Devam?",
      () => rejectLocal(doc),
    );
  };

  const acceptGib = (doc: EdocInboxItem) => confirmAction(
    "Onayla (GİB KABUL)",
    GIB_ACCEPT_CONFIRM,
    () => run(
      `gib-${edocId(doc)}`,
      () => post(client, `/edocs/inbox/${edocId(doc)}/respond`, { approval: "KABUL" }),
      "GİB KABUL yanıtı iletildi.",
    ),
    "Gönder",
  );

  const submitReject = () => {
    if (!rejectFor) return;
    const why = reason.trim();
    if (gibRed) {
      if (!why) {
        setError("RED için gerekçe zorunlu.");
        return;
      }
      const doc = rejectFor;
      setRejectFor(null);
      run(
        edocId(doc),
        () => post(client, `/edocs/inbox/${edocId(doc)}/respond`, { approval: "RED", reason: why }),
        "GİB RED yanıtı iletildi.",
      );
      return;
    }
    const doc = rejectFor;
    setRejectFor(null);
    rejectLocal(doc, why);
  };

  return (
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyTop={<Field label="Ara" value={q} onChangeText={setQ} placeholder="Tedarikçi / fatura no" testID="edoc-search" />}
    >
      <ActionTiles
        items={[
          { key: "sync", label: "Kutuyu çek", icon: "cloud-download", tone: "indigo", testID: "edoc-sync", busy: busy === "sync", onPress: syncInbox },
          ...(canEdit && pending > 0
            ? [{ key: "batch", label: "İçeri al", icon: "download", tone: "emerald" as const, testID: "edoc-process-pending", busy: busy === "batch", onPress: processPending }]
            : []),
          { key: "refresh", label: "Yenile", icon: "refresh", tone: "slate", testID: "edoc-refresh", onPress: load },
        ]}
        columns={3}
      />
      <Row style={{ flexWrap: "wrap" }}>
        {EDOC_FILTERS.map((f) => (
          <Chip
            key={f.key}
            testID={`edoc-filter-${f.key}`}
            label={data?.counts ? `${f.label} (${Number((data.counts as Record<string, number | undefined>)[f.key]) || 0})` : f.label}
            active={status === f.key}
            onPress={() => setStatus(f.key)}
          />
        ))}
      </Row>
      <ErrorBanner message={error} />
      {message ? <Muted testID="edoc-message">{message}</Muted> : null}
      {!filtered.length ? (
        <Empty icon="file-tray-outline" title="Gelen e-fatura yok" hint="Entegratör kutusu çekin veya bekleyen filtreyi değiştirin." />
      ) : filtered.map((doc) => {
        const id = edocId(doc);
        const processable = canEdit && isEdocProcessable(doc);
        const focused = Boolean(
          (focusId && id === focusId)
          || (focusEttn && String(doc.uuid || doc.ettn || "").toLowerCase().startsWith(focusEttn.toLowerCase())),
        );
        return (
          <View key={id} style={focused ? { borderWidth: 2, borderColor: "#6366f1", borderRadius: 16 } : undefined}>
            <ListRow
              testID={`edoc-row-${id}`}
              title={edocRowTitle(doc)}
              subtitle={edocRowSubtitle(doc)}
              right={edocRowRight(doc)}
              badge={<Badge label={edocStatusTr(doc.status)} tone={doc.status === "approved" ? "green" : doc.status === "rejected" ? "red" : "amber"} />}
              onPress={doc.invoice_id ? () => go("InvoiceDetail", { id: doc.invoice_id }) : processable ? () => processOne(doc) : undefined}
            />
            {processable || canSendCommercialResponse(doc) ? (
              <Row style={{ justifyContent: "flex-end", flexWrap: "wrap", marginTop: -6, marginBottom: 4 }}>
                {canSendCommercialResponse(doc) ? (
                  <Chip testID={`edoc-gib-accept-${id}`} label="Onayla (GİB KABUL)" active color={colors.primary} onPress={() => acceptGib(doc)} />
                ) : null}
                {processable ? (
                  <Chip testID={`edoc-accept-${id}`} label={inboxProcessLabel(doc)} active color={colors.primary} onPress={() => processOne(doc)} />
                ) : null}
                {processable || canSendCommercialResponse(doc) ? (
                  <Chip testID={`edoc-reject-${id}`} label="Reddet" active={false} onPress={() => rejectOne(doc)} />
                ) : null}
              </Row>
            ) : null}
            {rejectFor && edocId(rejectFor) === id ? (
              <View style={{ marginBottom: 8 }} testID="edoc-reject-dialog">
                <Field label="Ret nedeni" value={reason} onChangeText={setReason} testID="edoc-reject-reason" />
                <Chip
                  testID="edoc-reject-gib"
                  label={gibRed ? `${GIB_RED_OPTION_LABEL} (açık)` : "Yalnız yerel reddet"}
                  active={gibRed}
                  onPress={() => setGibRed((v) => !v)}
                />
                <Row style={{ justifyContent: "flex-end" }}>
                  <Chip testID="edoc-reject-cancel" label="Vazgeç" active={false} onPress={() => setRejectFor(null)} />
                  <Chip testID="edoc-reject-confirm" label="Reddet" active color="#e11d48" onPress={submitReject} />
                </Row>
              </View>
            ) : null}
          </View>
        );
      })}
    </Screen>
  );
}

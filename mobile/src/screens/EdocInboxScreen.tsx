import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { Chip, confirmAction } from "../components/chips";
import { Badge, Empty, ErrorBanner, Field, ListRow, Muted, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import {
  EDOC_FILTERS,
  edocId,
  edocRowRight,
  edocRowSubtitle,
  edocRowTitle,
  edocStatusTr,
  isEdocProcessable,
  pendingEdocCount,
  type EdocInboxItem,
  type EdocInboxList,
} from "../utils/edocInbox";

const PROCESS_OPTS = { update_stock: true, update_cost: true, allow_unmatched: true };

export function EdocInboxScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/edoc-inbox", "edit") || can("/invoices", "edit");
  const [data, setData] = useState<EdocInboxList | null>(null);
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const syncInbox = () => run("sync", () => post(client, "/einvoice/incoming/sync", {}, { company_id: companyId, days: 14 }), "Gelen kutu çekildi.");

  const processPending = () => confirmAction(
    "Bekleyenleri içeri al",
    "Okunabilir bekleyen belgeler alış faturasına dönüşecek. Devam?",
    () => run("batch", () => post(client, "/edocs/inbox/process-pending", PROCESS_OPTS, { company_id: companyId }), "Bekleyenler içeri alındı."),
  );

  const processOne = (doc: EdocInboxItem) => run(
    edocId(doc),
    () => post(client, `/edocs/inbox/${edocId(doc)}/process`, PROCESS_OPTS),
    "Belge içeri alındı.",
  );

  const rejectOne = (doc: EdocInboxItem) => confirmAction(
    "Belgeyi reddet",
    "Bu gelen e-fatura reddedilecek. Devam?",
    () => run(edocId(doc), () => post(client, `/edocs/inbox/${edocId(doc)}/reject`, { reason: "" }), "Belge reddedildi."),
  );

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
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
            key={f.key || "all"}
            testID={`edoc-filter-${f.key || "all"}`}
            label={f.key && data?.counts ? `${f.label} (${Number((data.counts as Record<string, number | undefined>)[f.key]) || 0})` : f.label}
            active={status === f.key}
            onPress={() => setStatus(f.key)}
          />
        ))}
      </Row>
      <Field label="Ara" value={q} onChangeText={setQ} placeholder="Tedarikçi / fatura no" testID="edoc-search" />
      <ErrorBanner message={error} />
      {message ? <Muted testID="edoc-message">{message}</Muted> : null}
      {!filtered.length ? (
        <Empty icon="file-tray-outline" title="Gelen e-fatura yok" hint="Entegratör kutusu çekin veya bekleyen filtreyi değiştirin." />
      ) : filtered.map((doc) => {
        const id = edocId(doc);
        const processable = canEdit && isEdocProcessable(doc);
        return (
          <React.Fragment key={id}>
            <ListRow
              testID={`edoc-row-${id}`}
              title={edocRowTitle(doc)}
              subtitle={edocRowSubtitle(doc)}
              right={edocRowRight(doc)}
              badge={<Badge label={edocStatusTr(doc.status)} tone={doc.status === "approved" ? "green" : doc.status === "rejected" ? "red" : "amber"} />}
              onPress={doc.invoice_id ? () => go("InvoiceDetail", { id: doc.invoice_id }) : processable ? () => processOne(doc) : undefined}
            />
            {processable ? (
              <Row style={{ justifyContent: "flex-end", marginTop: -6, marginBottom: 4 }}>
                <Chip testID={`edoc-accept-${id}`} label="İçeri al" active color={colors.primary} onPress={() => processOne(doc)} />
                <Chip testID={`edoc-reject-${id}`} label="Reddet" active={false} onPress={() => rejectOne(doc)} />
              </Row>
            ) : null}
          </React.Fragment>
        );
      })}
    </Screen>
  );
}

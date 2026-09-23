import { useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { confirmAction, n } from "../components/chips";
import { Badge, Card, ErrorBanner, Field, H1, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { idOf } from "../utils/money";
import {
  adjustPayload,
  canShip,
  lineRemaining,
  parsePickedQtyDraft,
  pickPercent,
  pickStatusTone,
  pickStatusTr,
  pickSummaryText,
  scanErrorMessage,
  type PickLine,
  type PickSession,
} from "../utils/orderPick";
import { printPickProductLabels } from "../utils/pickLabelPrint";
import { ProgressBar } from "./SevkScreen";

export function SevkPickScreen() {
  const { client, can, activeCompany } = useAuth();
  const canEdit = can("/sevk", "edit");
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [session, setSession] = useState<PickSession | null>(null);
  const [code, setCode] = useState("");
  const [scan, setScan] = useState<null | "once" | "serial">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const s = await get<PickSession>(client, `/order-picks/${id}`);
      setSession(s);
      setQtyDrafts({});
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Toplama oturumu açılamadı."));
    }
  }, [client, id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const apply = (s: PickSession) => {
    setSession(s);
    setQtyDrafts({});
    if (s.message) setMessage(s.message);
  };

  const lineKey = (line: PickLine, idx: number) => String(line.line_index ?? idx);

  const submitScan = async (barcode: string) => {
    const value = barcode.trim();
    if (!value) return;
    setBusy(true);
    try {
      const s = await post<PickSession>(client, `/order-picks/${id}/scan`, { barcode: value, quantity: 1 });
      apply(s);
      setCode("");
      setError(null);
    } catch (err) {
      setError(scanErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const adjust = async (line: PickLine, nextQty: number) => {
    setBusy(true);
    try {
      const s = await post<PickSession>(client, `/order-picks/${id}/adjust`, adjustPayload(line, nextQty));
      apply(s);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Kalem güncellenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const commitQty = (line: PickLine, idx: number) => {
    const key = lineKey(line, idx);
    const picked = Number(line.picked_qty) || 0;
    const ordered = Number(line.ordered_qty) || 0;
    const raw = qtyDrafts[key];
    setQtyDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
    const parsed = parsePickedQtyDraft(raw, picked, ordered);
    if (parsed == null || Math.abs(parsed - picked) < 1e-9) return;
    if (Number(String(raw || "").trim().replace(",", ".")) > ordered) {
      setError(`${line.product_name || "Kalem"}: siparişte ${ordered} adet var, ${picked} okutuldu.`);
    }
    adjust(line, parsed);
  };

  const runAction = async (path: string, body: Record<string, unknown>, fallback: string) => {
    setBusy(true);
    try {
      const r = await post<PickSession & { message?: string }>(client, `/order-picks/${id}/${path}`, body);
      setMessage(r?.message || fallback);
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const printLabels = async (lines: PickLine[]) => {
    setBusy(true);
    try {
      const res = await printPickProductLabels(lines, activeCompany?.name, session?.order_number);
      if (!res.count) setError("Yazdırılacak etiket yok.");
      else if (res.ok) {
        setMessage(`${res.count} ürün etiketi yazdırmaya gönderildi.`);
        setError(null);
      } else setError("Etiket yazdırılamadı.");
    } catch (err) {
      setError(apiErrorMessage(err, "Etiket yazdırılamadı."));
    } finally {
      setBusy(false);
    }
  };

  const complete = (mode: "ready" | "partial" | "ship") => {
    const titles = { ready: "Hazır işaretle", partial: "Kısmi teslim", ship: "Sevk et" } as const;
    confirmAction(titles[mode], `${session?.order_number || "Sipariş"} için ${titles[mode].toLowerCase()} işlemi yapılsın mı?`, () => {
      runAction("complete", { mode }, "İşlem tamamlanamadı.");
    });
  };

  const items = session?.items || [];
  const percent = pickPercent(session?.progress);
  const shipReady = canShip(session?.progress);

  return (
    <Screen onRefresh={load}>
      <H1>{session?.order_number || name || "Sevkiyat"}</H1>
      <Row style={{ justifyContent: "space-between" }}>
        <Muted>{[session?.customer_name, session?.city].filter(Boolean).join(" · ")}</Muted>
        <Badge label={pickStatusTr(session?.status)} tone={pickStatusTone(session?.status)} />
      </Row>
      <ProgressBar percent={percent} />
      <Row style={{ justifyContent: "space-between" }}>
        <Muted>{pickSummaryText(session?.progress, items.length)}</Muted>
        <Text style={{ fontWeight: "800", color: colors.text }}>%{percent}</Text>
      </Row>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}

      {canEdit ? (
        <Card testID="sevk-scan-card">
          <Field
            label="Barkod / SKU"
            testID="sevk-code-input"
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
            placeholder="Okut veya yaz"
            onSubmitEditing={() => submitScan(code)}
          />
          <Row>
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Okut" onPress={() => setScan("once")} color={colors.indigo} testID="sevk-scan-btn" />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Seri okut" onPress={() => setScan("serial")} color={colors.indigo} testID="sevk-scan-serial-btn" />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Ekle" onPress={() => submitScan(code)} loading={busy} color={colors.primary} testID="sevk-add-btn" />
            </View>
          </Row>
        </Card>
      ) : null}

      {items.map((line, idx) => {
        const picked = Number(line.picked_qty) || 0;
        const ordered = Number(line.ordered_qty) || 0;
        const done = picked >= ordered && ordered > 0;
        return (
          <Card key={`${line.line_index ?? idx}-${line.product_id || line.product_name}`} testID={`sevk-line-${line.line_index ?? idx}`}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text style={{ fontWeight: "700", color: colors.text, flex: 1 }} numberOfLines={2}>{line.product_name || "Kalem"}</Text>
              <Text style={{ fontWeight: "800", color: done ? colors.primary : colors.danger }}>{picked}/{ordered}</Text>
            </Row>
            <Muted>{[line.sku, line.barcode].filter(Boolean).join(" · ") || "Kod yok"}{done ? "" : ` · ${lineRemaining(line)} kaldı`}</Muted>
            {canEdit ? (
              <Row>
                <View style={{ flex: 1 }}>
                  <PrimaryButton title="−" onPress={() => adjust(line, picked - 1)} disabled={busy || picked <= 0} color={colors.secondary} testID={`sevk-minus-${line.line_index ?? idx}`} />
                </View>
                <View style={{ width: 76, alignItems: "center" }}>
                  <TextInput
                    testID={`sevk-qty-${line.line_index ?? idx}`}
                    accessibilityLabel="Toplanan miktar"
                    value={qtyDrafts[lineKey(line, idx)] ?? String(picked)}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                    editable={!busy}
                    onFocus={() => setQtyDrafts((d) => ({ ...d, [lineKey(line, idx)]: String(picked) }))}
                    onChangeText={(v) => setQtyDrafts((d) => ({ ...d, [lineKey(line, idx)]: v }))}
                    onBlur={() => commitQty(line, idx)}
                    onSubmitEditing={() => commitQty(line, idx)}
                    style={{
                      width: "100%",
                      minHeight: 44,
                      textAlign: "center",
                      fontWeight: "800",
                      fontSize: 18,
                      color: done ? colors.primary : colors.text,
                      borderBottomWidth: 2,
                      borderBottomColor: colors.border,
                      padding: 0,
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <PrimaryButton title="+" onPress={() => adjust(line, picked + 1)} disabled={busy || done} color={colors.primary} testID={`sevk-plus-${line.line_index ?? idx}`} />
                </View>
                <View style={{ flex: 1 }}>
                  <PrimaryButton title="Tümü" onPress={() => adjust(line, ordered)} disabled={busy || done} color={colors.indigo} testID={`sevk-all-${line.line_index ?? idx}`} />
                </View>
                <View style={{ flex: 1 }}>
                  <PrimaryButton title="Etiket" onPress={() => printLabels([line])} disabled={busy} color={colors.secondary} testID={`sevk-label-${line.line_index ?? idx}`} />
                </View>
              </Row>
            ) : null}
          </Card>
        );
      })}

      {items.length ? (
        <PrimaryButton
          title={busy ? "Hazırlanıyor…" : "Etiket yazdır"}
          onPress={() => printLabels(items)}
          loading={busy}
          color={colors.indigo}
          testID="sevk-print-labels"
        />
      ) : null}
      {canEdit && items.length ? (
        <ActionTiles
          columns={4}
          items={[
            { key: "missing", label: "Eksik bildir", icon: "alert-circle", tone: "amber", busy, testID: "sevk-notify-missing", onPress: () => runAction("notify-missing", {}, "Eksik bildirimi gönderilemedi.") },
            { key: "production", label: "Üretime al", icon: "construct", tone: "orange", busy, testID: "sevk-to-production", onPress: () => runAction("to-production", {}, "Üretim emri açılamadı.") },
            { key: "partial", label: "Kısmi teslim", icon: "download", tone: "violet", busy, testID: "sevk-partial", onPress: () => complete("partial") },
            { key: "ready", label: "Hazır", icon: "checkmark-circle", tone: "indigo", busy, testID: "sevk-ready", onPress: () => complete("ready") },
            { key: "ship", label: "Sevk et", icon: "send", tone: "emerald", busy, disabled: !shipReady, testID: "sevk-ship", onPress: () => complete("ship") },
          ]}
        />
      ) : null}
      {!shipReady && items.length ? <Muted>Tam sevk için tüm kalemler okutulmalı; eksik varsa kısmi teslim kullanın.</Muted> : null}
      {session?.draft_invoice_number ? (
        <PrimaryButton
          title={`Taslak fatura ${session.draft_invoice_number}`}
          color={colors.secondary}
          testID="sevk-draft-invoice"
          onPress={() => go("Invoices")}
        />
      ) : null}
      {session?.order_id ? (
        <PrimaryButton title="Siparişi aç" color={colors.secondary} testID="sevk-open-order" onPress={() => go("OrderDetail", { id: session.order_id || idOf(session) })} />
      ) : null}

      <BarcodeScannerModal
        visible={!!scan}
        continuous={scan === "serial"}
        onClose={() => setScan(null)}
        onScan={submitScan}
      />
    </Screen>
  );
}

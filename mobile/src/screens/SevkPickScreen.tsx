import { useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { confirmAction, n } from "../components/chips";
import { LabelPrintSheet } from "../components/LabelPrintSheet";
import { PickQtyKeypad, nextPickDraft } from "../components/PickQtyKeypad";
import { ProductThumb } from "../components/ProductThumb";
import { Badge, Card, ErrorBanner, Field, H1, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors, radius, spacing } from "../theme";
import { idOf } from "../utils/money";
import {
  adjustPayload,
  canMarkDeliveredFromPick,
  canShip,
  isDecimalUnit,
  lineRemaining,
  parsePickedQtyDraft,
  pickLineNote,
  pickLineState,
  pickPercent,
  pickStatusTone,
  pickStatusTr,
  pickUnitsSummaryText,
  scanErrorMessage,
  scanPickPayload,
  type PickLine,
  type PickSession,
} from "../utils/orderPick";
import { scanQtyOnBlur, scanQtyOnFocus, scanQtyShown } from "../utils/scanQty";
import { printShipmentLabelsPdf } from "../utils/labelPdf";
import { defaultLabelPrinter, printShipmentLabels, resolveLabelPrinter, saveLabelPrinter, type LabelPrinterSettings } from "../utils/labelPrinter";
import { printPickProductLabels } from "../utils/pickLabelPrint";
import { canSevkDraftInvoice, canSevkOpenOrder } from "../utils/permissions";
import { ProgressBar } from "./SevkScreen";

export function SevkPickScreen() {
  const { client, can, user, activeCompany, companyId } = useAuth();
  const canView = can("/sevk");
  const canEdit = can("/sevk", "edit");
  const showOpenOrder = canSevkOpenOrder(user);
  const showDraftInvoice = canSevkDraftInvoice(user);
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [session, setSession] = useState<PickSession | null>(null);
  const [code, setCode] = useState("");
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string | number>>({});
  const draftsRef = useRef(qtyDrafts);
  const openRef = useRef<string | null>(null);
  const replaceRef = useRef(true);
  const [openLineKey, setOpenLineKey] = useState<string | null>(null);
  const [scanQty, setScanQty] = useState("1");
  const [shipPrint, setShipPrint] = useState(false);
  const [shipBusy, setShipBusy] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);
  const [labelPrinter, setLabelPrinter] = useState<LabelPrinterSettings>(defaultLabelPrinter());

  const resetEntry = useCallback(() => {
    openRef.current = null;
    replaceRef.current = true;
    draftsRef.current = {};
    setOpenLineKey(null);
    setQtyDrafts({});
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const s = await get<PickSession>(client, `/order-picks/${id}`);
      setSession(s);
      resetEntry();
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Toplama oturumu açılamadı."));
    }
  }, [canView, client, id, resetEntry]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      // Ekran blur: yazılan taslak gönderilmez.
      resetEntry();
    };
  }, [load, resetEntry]));

  const apply = (s: PickSession) => {
    setSession(s);
    resetEntry();
    if (s.message) setMessage(s.message);
  };

  const lineKey = (line: PickLine, idx: number) => String(line.line_index ?? idx);

  const submitScan = async (barcode: string) => {
    const value = barcode.trim();
    if (!value) return;
    setBusy(true);
    try {
      const s = await post<PickSession>(client, `/order-picks/${id}/scan`, scanPickPayload(value, scanQty));
      apply(s);
      setCode("");
      setError(null);
    } catch (err) {
      setError(scanErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const adjust = async (line: PickLine, nextQty: number, keepError = false) => {
    setBusy(true);
    try {
      const s = await post<PickSession>(client, `/order-picks/${id}/adjust`, adjustPayload(line, nextQty));
      apply(s);
      if (!keepError) setError(null);
      return true;
    } catch (err) {
      setError(apiErrorMessage(err, "Kalem güncellenemedi."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const commitQty = async (line: PickLine, idx: number) => {
    const key = lineKey(line, idx);
    const picked = Number(line.picked_qty) || 0;
    const ordered = Number(line.ordered_qty) || 0;
    const raw = draftsRef.current[key];
    const nextDrafts = { ...draftsRef.current };
    delete nextDrafts[key];
    draftsRef.current = nextDrafts;
    setQtyDrafts(nextDrafts);
    const parsed = parsePickedQtyDraft(raw == null || raw === "" ? undefined : String(raw), picked, ordered);
    if (parsed == null || Math.abs(parsed - picked) < 1e-9) return;
    const typed = Number(String(raw || "").trim().replace(",", "."));
    const over = Number.isFinite(typed) && typed > ordered;
    const ok = await adjust(line, parsed, over);
    if (ok && over) {
      setError(`${line.product_name || "Kalem"}: siparişte ${ordered} adet var, ${picked} okutuldu.`);
    }
  };

  const writeDrafts = (next: Record<string, string | number>) => {
    draftsRef.current = next;
    setQtyDrafts(next);
  };

  const openKeypad = (line: PickLine, idx: number) => {
    const key = lineKey(line, idx);
    if (openRef.current === key) return;
    if (openRef.current) {
      const next = { ...draftsRef.current };
      delete next[openRef.current];
      writeDrafts(next);
    }
    replaceRef.current = true;
    openRef.current = key;
    setOpenLineKey(key);
  };

  const cancelKeypad = () => {
    const prev = openRef.current;
    openRef.current = null;
    replaceRef.current = true;
    setOpenLineKey(null);
    if (!prev || !(prev in draftsRef.current)) return;
    const next = { ...draftsRef.current };
    delete next[prev];
    writeDrafts(next);
  };

  const onKeypadKey = (line: PickLine, idx: number, token: string) => {
    const key = lineKey(line, idx);
    const current = replaceRef.current ? "" : String(draftsRef.current[key] ?? "");
    replaceRef.current = false;
    writeDrafts({ ...draftsRef.current, [key]: nextPickDraft(current, token, isDecimalUnit(line.unit)) });
  };

  const confirmKeypad = async (line: PickLine, idx: number) => {
    const pending = commitQty(line, idx);
    openRef.current = null;
    replaceRef.current = true;
    setOpenLineKey(null);
    await pending;
  };

  const onLinePress = (line: PickLine, idx: number) => {
    const key = lineKey(line, idx);
    if (openRef.current && openRef.current !== key) cancelKeypad();
  };

  const runAction = async (path: string, body: Record<string, unknown>, fallback: string) => {
    setBusy(true);
    try {
      const r = await post<PickSession & { message?: string }>(client, `/order-picks/${id}/${path}`, body);
      setMessage(r?.message || fallback);
      setError(null);
      if (path === "complete" && body?.mode === "deliver") {
        go("Sevk");
        return;
      }
      if (path === "complete" && body?.mode === "ship" && canMarkDeliveredFromPick(r)) {
        setSession(r);
        return;
      }
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
      const res = await printPickProductLabels(lines, activeCompany, session?.order_number, {
        client,
        companyId: idOf(activeCompany) || undefined,
      });
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

  const complete = (mode: "ready" | "partial" | "ship" | "deliver") => {
    const titles = { ready: "Hazır işaretle", partial: "Kısmi teslim", ship: "Sevk et", deliver: "Teslim edildi" } as const;
    confirmAction(titles[mode], `${session?.order_number || "Sipariş"} için ${titles[mode].toLowerCase()} işlemi yapılsın mı?`, () => {
      runAction("complete", { mode }, "İşlem tamamlanamadı.");
    });
  };

  const items = session?.items || [];
  const percent = pickPercent(session?.progress);
  const shipReady = canShip(session?.progress);
  const awaitDeliver = canMarkDeliveredFromPick(session);

  const openShipLabel = async () => {
    setShipError(null);
    setMessage(null);
    const resolved = await resolveLabelPrinter(client, companyId);
    setLabelPrinter(resolved);
    setShipPrint(true);
  };

  if (!canView) {
    return (
      <Screen>
        <H1>Sipariş toplama</H1>
        <ErrorBanner message="Sipariş toplama yetkiniz yok." />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={load}>
      <H1>{session?.order_number || name || "Sevkiyat"}</H1>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <Muted>{pickUnitsSummaryText(session?.customer_name, items.length, session?.progress)}</Muted>
        <Badge label={pickStatusTr(session?.status)} tone={pickStatusTone(session?.status)} />
      </Row>
      {session?.city ? <Muted>{session.city}</Muted> : null}
      <ProgressBar percent={percent} />
      <Row style={{ justifyContent: "flex-end" }}>
        <Text style={{ fontWeight: "800", color: colors.text }}>%{percent}</Text>
      </Row>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}

      {canEdit && !awaitDeliver ? (
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
            <View style={{ width: 64 }}>
              <Text style={{ fontSize: 10, fontWeight: "800", color: colors.muted, textAlign: "center" }}>Adet</Text>
              <TextInput
                testID="sevk-scan-qty"
                accessibilityLabel="Adet çarpan"
                value={scanQtyShown(scanQty)}
                onChangeText={(v) => setScanQty(v.replace(/[^\d]/g, ""))}
                onFocus={() => setScanQty(scanQtyOnFocus())}
                onBlur={() => setScanQty(scanQtyOnBlur(scanQty))}
                keyboardType="number-pad"
                selectTextOnFocus
                style={{
                  minHeight: 44,
                  textAlign: "center",
                  fontWeight: "800",
                  fontSize: 18,
                  color: colors.text,
                  borderBottomWidth: 2,
                  borderBottomColor: colors.border,
                  padding: 0,
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Okut" onPress={() => setScan(true)} color={colors.indigo} testID="sevk-scan-btn" />
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
        const done = pickLineState(line) === "done";
        const key = lineKey(line, idx);
        const lineId = line.line_index ?? idx;
        const editing = openLineKey === key;
        const accent = done ? colors.primary : "#F59E0B";
        const draft = qtyDrafts[key];
        const shown = editing && typeof draft === "string" ? draft : pickedLabel(picked);
        const qtyLabel = qtyBoxText(shown, line.unit);
        return (
          <Pressable
            key={`${line.line_index ?? idx}-${line.product_id || line.product_name}`}
            testID={`sevk-line-${lineId}`}
            onPress={() => onLinePress(line, idx)}
            style={{
              backgroundColor: done ? colors.emerald50 : colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderLeftWidth: 4,
              borderLeftColor: accent,
              borderRadius: radius.lg,
              padding: spacing.sm + 2,
              gap: 6,
            }}
          >
            <Row style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <ProductThumb uri={line.image_url || ""} size={44} testID={`sevk-line-thumb-${lineId}`} />
              <Text style={{ fontWeight: "700", color: colors.text, flex: 1 }} numberOfLines={2}>{line.product_name || "Kalem"}</Text>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 22, fontWeight: "800", color: accent }}>{picked}/{ordered}</Text>
                <Text style={{ fontSize: 12, fontWeight: "800", color: accent }}>
                  {done ? "✓ Tamam" : `${String(lineRemaining(line)).replace(".", ",")} eksik`}
                </Text>
              </View>
            </Row>
            <Muted>{[line.sku, line.barcode].filter(Boolean).join(" · ") || "Kod yok"}</Muted>
            {pickLineNote(line) ? (
              <View
                style={{
                  marginTop: 6,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  borderRadius: 8,
                  backgroundColor: "#fffbeb",
                  borderWidth: 1,
                  borderColor: "#fde68a",
                }}
                testID={`sevk-line-note-${lineId}`}
              >
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#92400e", lineHeight: 16 }}>
                  Sipariş stok notu · {pickLineNote(line)}
                </Text>
              </View>
            ) : null}
            {canEdit ? (
              <>
                <Row>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton title="−" onPress={() => adjust(line, picked - 1)} disabled={busy || picked <= 0} color={colors.secondary} testID={`sevk-minus-${lineId}`} />
                  </View>
                  <View style={{ flex: 1.2, minWidth: 76 }}>
                    <Pressable
                      testID={`sevk-qty-${lineId}`}
                      accessibilityLabel={qtyLabel}
                      onPress={() => openKeypad(line, idx)}
                      disabled={busy}
                      style={{
                        minHeight: 44,
                        paddingHorizontal: 6,
                        borderRadius: 10,
                        borderWidth: 2,
                        borderColor: colors.indigo,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: editing ? colors.indigo50 : "#fff",
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      <Text numberOfLines={1} style={{ fontWeight: "800", fontSize: 15, color: colors.indigo }}>{qtyLabel}</Text>
                    </Pressable>
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton title="+" onPress={() => adjust(line, picked + 1)} disabled={busy || done} color={colors.primary} testID={`sevk-plus-${lineId}`} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton title="Tümü" icon="checkmark-done" onPress={() => adjust(line, ordered)} disabled={busy || done} color={done ? colors.muted : colors.indigo} testID={`sevk-all-${lineId}`} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton title="Etiket" icon="pricetag" onPress={() => printLabels([line])} disabled={busy} color={colors.secondary} testID={`sevk-label-${lineId}`} />
                  </View>
                </Row>
                {editing ? (
                  <PickQtyKeypad
                    index={lineId}
                    decimal={isDecimalUnit(line.unit)}
                    disabled={busy}
                    onKey={(token) => onKeypadKey(line, idx, token)}
                    onConfirm={() => confirmKeypad(line, idx)}
                  />
                ) : null}
              </>
            ) : null}
          </Pressable>
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
      {session ? (
        <PrimaryButton
          title="Koli etiketi bas"
          color={colors.primary}
          testID="sevk-ship-label"
          onPress={() => { void openShipLabel(); }}
        />
      ) : null}
      <LabelPrintSheet
        visible={shipPrint}
        title="Koli etiketi bas"
        subtitle={session?.order_number || "Koli etiketi"}
        quantityLabel="Koli adedi"
        hint="Her koli için ayrı etiket basılır (sipariş, müşteri, adres, koli x/y, QR)."
        busy={shipBusy}
        error={shipError}
        testID="sevk-ship-sheet"
        printerHost={labelPrinter.host}
        printerPort={labelPrinter.port}
        onSavePrinter={async (host, port) => {
          const saved = await saveLabelPrinter({ host, port }, companyId);
          setLabelPrinter(saved);
        }}
        onOpenPrinters={() => go("Printers")}
        onClose={() => setShipPrint(false)}
        onPrint={async (copies) => {
          setShipBusy(true);
          setShipError(null);
          try {
            const settings = await resolveLabelPrinter(client, companyId);
            const address = [session?.shipping_address, session?.city].filter(Boolean).join(" ");
            await printShipmentLabels({
              settings,
              shipment: {
                orderNo: session?.order_number,
                customer: session?.customer_name,
                address,
                packageTotal: copies,
              },
            });
            setMessage(`Koli etiketi basıldı (${copies} adet).`);
            setError(null);
            setShipPrint(false);
          } catch (err) {
            const msg = err instanceof Error ? err.message : apiErrorMessage(err, "Etiket basılamadı.");
            setShipError(msg);
            setError(msg);
          } finally {
            setShipBusy(false);
          }
        }}
        onPdf={async (mode, copies) => {
          setShipBusy(true);
          setShipError(null);
          try {
            const address = [session?.shipping_address, session?.city].filter(Boolean).join(" ");
            const ok = await printShipmentLabelsPdf(client, companyId, {
              orderNo: session?.order_number,
              customer: session?.customer_name,
              address,
              packageTotal: copies,
            }, mode);
            if (!ok) {
              const msg = mode === "pdf" ? "PDF paylaşılamadı." : "Etiket yazdırılamadı.";
              setShipError(msg);
              setError(msg);
              setMessage(null);
              return;
            }
            setMessage(mode === "pdf"
              ? `Koli etiketi PDF paylaşıldı (${copies} adet).`
              : `Koli etiketi yazdırıldı (${copies} adet).`);
            setError(null);
            setShipPrint(false);
          } catch (err) {
            const msg = err instanceof Error ? err.message : apiErrorMessage(err, "Etiket basılamadı.");
            setShipError(msg);
            setError(msg);
            setMessage(null);
          } finally {
            setShipBusy(false);
          }
        }}
      />
      {canEdit && items.length && awaitDeliver ? (
        <PrimaryButton
          title="Teslim edildi"
          color={colors.primary}
          loading={busy}
          testID="sevk-deliver"
          onPress={() => complete("deliver")}
        />
      ) : null}
      {canEdit && items.length && !awaitDeliver ? (
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
      {!awaitDeliver && !shipReady && items.length ? <Muted>Tam sevk için tüm kalemler okutulmalı; eksik varsa kısmi teslim kullanın.</Muted> : null}
      {awaitDeliver ? <Muted>Sipariş sevk edildi. Teslimatı onaylamak için Teslim edildi’ye basın.</Muted> : null}
      {showDraftInvoice && session?.draft_invoice_number ? (
        <PrimaryButton
          title={`Taslak fatura ${session.draft_invoice_number}`}
          color={colors.secondary}
          testID="sevk-draft-invoice"
          onPress={() => go("Invoices")}
        />
      ) : null}
      {showOpenOrder && session?.order_id ? (
        <PrimaryButton title="Siparişi aç" color={colors.secondary} testID="sevk-open-order" onPress={() => go("OrderDetail", { id: session.order_id || idOf(session) })} />
      ) : null}

      <BarcodeScannerModal
        visible={scan}
        qtyEnabled
        qty={scanQty}
        onQtyChange={setScanQty}
        onClose={() => setScan(false)}
        onScan={submitScan}
      />
    </Screen>
  );
}

function pickedLabel(picked: number): string {
  const rounded = Math.round((Number(picked) || 0) * 1000) / 1000;
  return String(rounded).replace(".", ",");
}

function qtyBoxText(shown: string, unit?: string): string {
  const name = String(unit || "").trim() || "adet";
  return shown === "" ? name : `${shown} ${name}`;
}

import { useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { confirmAction } from "../components/chips";
import { Badge, Card, ErrorBanner, Field, H1, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import {
  adjustCountPayload,
  countDiff,
  diffItems,
  scanCountPayload,
  scannedItems,
  type CountItem,
  type CountSession,
} from "../utils/stockCount";
import { scanQtyOnBlur, scanQtyOnFocus, scanQtyShown } from "../utils/scanQty";

export function StockCountSessionScreen() {
  const { client, can } = useAuth();
  const canEdit = can("/sayim", "edit") || can("/stock", "edit");
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [session, setSession] = useState<CountSession | null>(null);
  const [code, setCode] = useState("");
  const [scanQty, setScanQty] = useState("1");
  const [scan, setScan] = useState<null | "once" | "serial">(null);
  const [last, setLast] = useState<CountItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await get<CountSession>(client, `/warehouses/stock-counts/${id}`);
      setSession(s);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Sayım oturumu açılamadı."));
    }
  }, [client, id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submitScan = async (barcode: string) => {
    const value = barcode.trim();
    if (!value || !canEdit || session?.status !== "open") return;
    setBusy(true);
    try {
      const r = await post<{ item: CountItem; message?: string }>(
        client,
        `/warehouses/stock-counts/${id}/scan`,
        scanCountPayload(value, scanQty),
      );
      setLast(r.item);
      setMessage(r.message || null);
      setCode("");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Barkod okutulamadı."));
    } finally {
      setBusy(false);
    }
  };

  const bump = async (delta: number) => {
    if (!last || !canEdit || session?.status !== "open") return;
    const next = Math.max(0, Number(last.counted || 0) + delta);
    setBusy(true);
    try {
      const s = await put<CountSession>(client, `/warehouses/stock-counts/${id}/items`, adjustCountPayload(last, next));
      setSession(s);
      const item = (s.items || []).find(
        (i) => i.product_id === last.product_id && (i.variant_id ?? null) === (last.variant_id ?? null),
      );
      if (item) setLast(item);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Adet güncellenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const complete = (apply: boolean) => {
    confirmAction(
      apply ? "Tamamla ve stoğu güncelle" : "Sadece kaydet",
      apply
        ? "Sayılan adetler stoğa yazılacak. Devam edilsin mi?"
        : "Sayım kaydedilecek, stok değişmeyecek. Devam?",
      async () => {
        setBusy(true);
        try {
          const r = await post<{ message?: string }>(client, `/warehouses/stock-counts/${id}/complete`, {
            apply,
            only_scanned: true,
          });
          setMessage(r.message || "Sayım tamamlandı.");
          setError(null);
          await load();
        } catch (err) {
          setError(apiErrorMessage(err, "Tamamlanamadı."));
        } finally {
          setBusy(false);
        }
      },
    );
  };

  const open = session?.status === "open";
  const scanned = scannedItems(session);
  const diffs = diffItems(session);
  const qtyLabel = scanQtyShown(scanQty) || "1";

  return (
    <Screen onRefresh={load}>
      <H1>{session?.name || name || "Sayım"}</H1>
      <Row style={{ justifyContent: "space-between" }}>
        <Muted>{session?.warehouse_name || "Depo"}</Muted>
        <Badge label={open ? "AÇIK" : "TAMAM"} tone={open ? "amber" : "green"} />
      </Row>
      <Muted>{scanned.length} sayıldı · {diffs.length} fark</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}

      {open && canEdit ? (
        <Card testID="sayim-scan-card">
          <Field
            label="Barkod / SKU"
            testID="sayim-code-input"
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
                testID="sayim-scan-qty"
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
              <PrimaryButton title={`Okut (+${qtyLabel})`} onPress={() => submitScan(code)} loading={busy} color={colors.indigo} testID="sayim-add-btn" />
            </View>
          </Row>
          <Row>
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Seri okut" onPress={() => setScan("serial")} color={colors.indigo} testID="sayim-scan-serial-btn" />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Kamera" onPress={() => setScan("once")} color={colors.secondary} testID="sayim-scan-btn" />
            </View>
          </Row>
        </Card>
      ) : null}

      {last ? (
        <Card testID="sayim-last-item">
          <Text style={{ fontSize: 10, fontWeight: "800", color: colors.indigo, textTransform: "uppercase" }}>Son okutulan</Text>
          <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }}>{last.product_name}</Text>
          <Muted>{[last.sku, last.barcode].filter(Boolean).join(" · ")}</Muted>
          <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
            <Muted>Sistem: {Number(last.expected || 0)}</Muted>
            <Row>
              <View style={{ width: 56 }}>
                <PrimaryButton title="−" onPress={() => bump(-1)} disabled={busy} color={colors.secondary} testID="sayim-minus" />
              </View>
              <Text style={{ minWidth: 48, textAlign: "center", fontWeight: "900", fontSize: 22 }} testID="sayim-counted">
                {Number(last.counted || 0)}
              </Text>
              <View style={{ width: 56 }}>
                <PrimaryButton title="+" onPress={() => bump(1)} disabled={busy} color={colors.indigo} testID="sayim-plus" />
              </View>
            </Row>
          </Row>
          {last.scanned && countDiff(last) !== 0 ? (
            <Text style={{ fontWeight: "800", color: colors.danger }}>
              Fark: {countDiff(last) > 0 ? "+" : ""}{countDiff(last)}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Card testID="sayim-scanned-list">
        <Muted>Sayılan kalemler</Muted>
        {!scanned.length ? <Muted>Henüz okutma yok.</Muted> : null}
        {[...scanned].reverse().map((i) => {
          const d = countDiff(i);
          return (
            <PrimaryButton
              key={`${i.product_id}-${i.variant_id ?? ""}`}
              title={`${i.product_name || "Ürün"} · ${Number(i.counted || 0)}${d === 0 ? "" : ` (${d > 0 ? "+" : ""}${d})`}`}
              onPress={() => setLast(i)}
              color={colors.secondary}
              testID={`sayim-row-${i.sku || i.product_id}`}
            />
          );
        })}
      </Card>

      {open && canEdit ? (
        <>
          <PrimaryButton
            title="Tamamla ve stoğu güncelle"
            onPress={() => complete(true)}
            loading={busy}
            disabled={!scanned.length}
            color={colors.primary}
            testID="sayim-complete-apply"
          />
          <PrimaryButton
            title="Sadece kaydet (stok değişmesin)"
            onPress={() => complete(false)}
            loading={busy}
            color={colors.secondary}
            testID="sayim-complete-save"
          />
        </>
      ) : null}

      <BarcodeScannerModal
        visible={!!scan}
        continuous={scan === "serial"}
        qtyEnabled
        qty={scanQty}
        onQtyChange={setScanQty}
        onClose={() => setScan(null)}
        onScan={submitScan}
      />
    </Screen>
  );
}

import React, { useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { colors } from "../theme";
import { labelPrinterConfigError } from "../utils/labelPrinter";
import { B2BSheet } from "./b2b/B2BSheet";
import { ErrorBanner, Field, Muted, PrimaryButton } from "./kit";
import { QuantityInput } from "./MoneyInput";

function isLabelPrinterConfigMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  if (
    message === labelPrinterConfigError({ host: "", port: 9100 })
    || message === labelPrinterConfigError({ host: "192.168.1.1", port: 0 })
  ) return true;
  return message.startsWith("Port ") && message.includes("seri baud hızıdır");
}

function parsePort(value: string): number {
  if (!String(value || "").trim()) return 9100;
  return Number(String(value).replace(",", "."));
}

export function LabelPrintSheet({
  visible,
  title,
  subtitle,
  busy,
  error,
  initialQty = 1,
  allowPrice = false,
  quantityLabel = "Adet",
  hint,
  onClose,
  onPrint,
  onPdf,
  testID = "label-print-sheet",
  printerHost,
  printerPort,
  onSavePrinter,
  onOpenPrinters,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  busy?: boolean;
  error?: string | null;
  initialQty?: number;
  allowPrice?: boolean;
  quantityLabel?: string;
  hint?: string;
  onClose: () => void;
  onPrint: (copies: number, opts: { includePrice: boolean }) => void;
  /** Sistem yazdırma ekranı ("print") veya PDF paylaşımı ("pdf"). IP baskısından bağımsız. */
  onPdf?: (mode: "print" | "pdf", copies: number, opts: { includePrice: boolean }) => Promise<void> | void;
  testID?: string;
  printerHost?: string;
  printerPort?: number;
  onSavePrinter?: (host: string, port: number) => Promise<void>;
  onOpenPrinters?: () => void;
}) {
  const printerUi = printerHost !== undefined || printerPort !== undefined || onSavePrinter != null || onOpenPrinters != null;
  const [qty, setQty] = useState<string | number>(initialQty);
  const [includePrice, setIncludePrice] = useState(true);
  const [host, setHost] = useState(printerHost || "");
  const [port, setPort] = useState(String(printerPort || 9100));
  const [editing, setEditing] = useState(!String(printerHost || "").trim());
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQty(initialQty);
    setIncludePrice(true);
    setLocalError(null);
  }, [initialQty, visible]);

  useEffect(() => {
    if (!visible) return;
    const nextHost = String(printerHost || "");
    setHost(nextHost);
    setPort(String(printerPort || 9100));
    setEditing(!nextHost.trim());
  }, [visible, printerHost, printerPort]);

  const copies = Math.max(1, Math.min(200, Math.round(Number(String(qty).replace(",", ".")) || 1)));
  const knownHost = String(printerHost || "").trim();
  const knownPort = Number(printerPort) > 0 ? Number(printerPort) : 9100;
  const showFields = printerUi && (editing || !knownHost);
  const shownError = localError || error || null;
  const showPrinterSettings = !!onOpenPrinters && isLabelPrinterConfigMessage(shownError);

  const submit = async () => {
    if (showFields) {
      const nextHost = host.trim();
      const nextPort = parsePort(port);
      const err = labelPrinterConfigError({ host: nextHost, port: nextPort });
      if (err) {
        setLocalError(err);
        return;
      }
      setLocalError(null);
      if (onSavePrinter) {
        try {
          await onSavePrinter(nextHost, nextPort);
        } catch (err) {
          setLocalError(err instanceof Error ? err.message : "Yazıcı kaydedilemedi.");
          return;
        }
      }
    }
    onPrint(copies, { includePrice });
  };

  return (
    <B2BSheet visible={visible} title={title} subtitle={subtitle} onClose={onClose} testID={testID}>
      <ErrorBanner message={shownError} />
      {showPrinterSettings ? (
        <PrimaryButton
          title="Yazıcı ayarları"
          testID={`${testID}-open-printers`}
          color={colors.secondary}
          onPress={() => onOpenPrinters?.()}
        />
      ) : null}
      {printerUi && !showFields ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", paddingBottom: 8 }}>
          <Text style={{ fontWeight: "700", color: colors.text }}>Yazıcı: {knownHost}:{knownPort}</Text>
          <Text style={{ color: colors.muted }}> · </Text>
          <Pressable onPress={() => setEditing(true)} testID={`${testID}-printer-change`} accessibilityLabel="Değiştir">
            <Text style={{ color: colors.indigo, fontWeight: "800" }}>Değiştir</Text>
          </Pressable>
        </View>
      ) : null}
      {showFields ? (
        <>
          <Field
            label="Yazıcı IP"
            testID={`${testID}-host`}
            value={host}
            onChangeText={setHost}
            placeholder="Yazıcı IP adresi"
            keyboardType="decimal-pad"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label="Port"
            testID={`${testID}-port`}
            value={port}
            onChangeText={setPort}
            placeholder="9100"
            keyboardType="number-pad"
          />
        </>
      ) : null}
      <QuantityInput
        label={quantityLabel}
        testID={`${testID}-qty`}
        value={qty}
        onChange={(n) => setQty(n ?? "")}
      />
      {hint ? <Muted>{hint}</Muted> : null}
      {allowPrice ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
          <Text style={{ fontWeight: "700", color: colors.text }}>Fiyatı bas</Text>
          <Switch testID={`${testID}-price`} value={includePrice} onValueChange={setIncludePrice} />
        </View>
      ) : null}
      <PrimaryButton
        title={busy ? "Basılıyor…" : showFields ? "Kaydet ve bas" : "Etiket bas"}
        testID={`${testID}-go`}
        icon={showFields || busy ? undefined : "print"}
        color={colors.indigo}
        loading={!!busy}
        disabled={!copies}
        onPress={() => { void submit(); }}
      />
      {onPdf ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <PrimaryButton
            title="Telefondan yazdır"
            testID={`${testID}-phone`}
            color={colors.secondary}
            disabled={!!busy || !copies}
            onPress={() => { void onPdf("print", copies, { includePrice }); }}
          />
          <PrimaryButton
            title="PDF paylaş"
            testID={`${testID}-pdf`}
            color={colors.secondary}
            disabled={!!busy || !copies}
            onPress={() => { void onPdf("pdf", copies, { includePrice }); }}
          />
        </View>
      ) : null}
    </B2BSheet>
  );
}

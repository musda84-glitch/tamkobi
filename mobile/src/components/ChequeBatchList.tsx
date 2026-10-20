import React from "react";
import { Pressable, Text, View } from "react-native";
import {
  CHEQUE_BATCH_LIMIT,
  batchHeading,
  batchMetaLine,
  batchTotal,
  type ChequeBatchItem,
} from "../utils/chequeBatch";
import type { ChequeScanDraft, ChequeExtractResponse } from "../utils/chequeScan";
import { fmtDate, fmtMoney } from "../utils/money";
import { colors } from "../theme";
import { ChequeScanButtons } from "./ChequeScanButtons";
import { Card, ErrorBanner, Muted } from "./kit";

function amountOf(value: string | number): number {
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function itemTitle(item: ChequeBatchItem): string {
  const bank = item.draft.bank_name.trim();
  const serial = item.draft.serial_no.trim();
  const left = bank || (item.draft.instrument === "promissory" ? "Senet" : "Çek");
  return `${left} · ${serial || "—"}`;
}

function itemSub(item: ChequeBatchItem): string {
  const due = item.draft.due_date ? fmtDate(item.draft.due_date) : "—";
  const issue = item.draft.issue_date ? fmtDate(item.draft.issue_date) : "—";
  return `Vade ${due} · keşide ${issue}`;
}

export function ChequeBatchList({
  items,
  direction,
  contactName,
  recordDate,
  errorIndex,
  errorMessage,
  disabled,
  onRemove,
  onAddManual,
  onScan,
  onScanError,
}: {
  items: ChequeBatchItem[];
  direction: "received" | "issued";
  contactName: string;
  recordDate: string;
  errorIndex?: number | null;
  errorMessage?: string | null;
  disabled?: boolean;
  onRemove: (index: number) => void;
  onAddManual: () => void;
  onScan: (draft: ChequeScanDraft, match?: ChequeExtractResponse["matched_contact"]) => void;
  onScanError?: (message: string) => void;
}) {
  const atMax = items.length >= CHEQUE_BATCH_LIMIT;
  const total = batchTotal(items);
  return (
    <View testID="cheque-batch-list" style={{ gap: 10 }}>
      <Card testID="cheque-batch-total">
        <Text style={{ color: colors.muted, fontWeight: "800", letterSpacing: 0.4 }}>
          {batchHeading(items, direction, contactName)}
        </Text>
        <Text style={{ fontSize: 32, fontWeight: "800", color: colors.text, marginTop: 4 }}>{fmtMoney(total)}</Text>
        <Muted>{batchMetaLine(items.length, recordDate)}</Muted>
      </Card>
      <ErrorBanner message={errorMessage} />
      {items.map((item, index) => {
        const marked = errorIndex === index;
        return (
          <Card
            key={item.id}
            testID={`cheque-batch-item-${index}`}
            style={marked ? { borderColor: colors.danger, borderWidth: 2, backgroundColor: colors.rose50 } : undefined}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontWeight: "800", color: colors.text }}>{itemTitle(item)}</Text>
                <Text style={{ color: colors.muted }}>{itemSub(item)}</Text>
                <Text style={{ fontWeight: "800", fontSize: 18, color: colors.text }}>{fmtMoney(amountOf(item.draft.amount))}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 8 }}>
                <View style={{ backgroundColor: item.source === "scan" ? colors.amber50 : colors.slate100, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ fontWeight: "800", color: item.source === "scan" ? "#B45309" : colors.muted, fontSize: 12 }}>
                    {item.source === "scan" ? "📷 okundu" : "elle"}
                  </Text>
                </View>
                <Pressable
                  testID={`cheque-batch-item-${index}-remove`}
                  accessibilityRole="button"
                  accessibilityLabel="Çeki çıkar"
                  disabled={disabled}
                  onPress={() => onRemove(index)}
                  hitSlop={8}
                >
                  <Text style={{ color: colors.danger, fontWeight: "800" }}>Sil</Text>
                </Pressable>
              </View>
            </View>
            {marked && errorMessage ? (
              <Text testID={`cheque-batch-item-${index}-error`} style={{ color: colors.danger, fontWeight: "800", marginTop: 8 }}>
                {errorMessage}
              </Text>
            ) : null}
          </Card>
        );
      })}
      <Pressable
        testID="cheque-batch-add-manual"
        accessibilityRole="button"
        accessibilityLabel="Çek ekle"
        disabled={disabled || atMax}
        onPress={onAddManual}
        style={{
          minHeight: 48,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: "#fff",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled || atMax ? 0.5 : 1,
        }}
      >
        <Text style={{ fontWeight: "800", color: colors.text }}>+ Çek ekle</Text>
      </Pressable>
      <ChequeScanButtons
        variant="batch"
        testID="cheque-batch-add-scan"
        disabled={disabled || atMax}
        onDraft={onScan}
        onError={onScanError}
      />
    </View>
  );
}

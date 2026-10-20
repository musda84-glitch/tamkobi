import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { batchDueLabel, type SavedChequeBatch } from "../utils/chequeBatch";
import {
  printChequeGroupReceipt,
  printChequeReceipt,
  shareChequeGroupReceipt,
  shareChequeReceipt,
  type ChequeReceiptGroup,
} from "../utils/chequeShare";
import { chequeReturnContact } from "../utils/cheques";
import { fmtDate, fmtMoney } from "../utils/money";
import { colors } from "../theme";
import { Card, ErrorBanner, Muted } from "./kit";

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6 }}>
      <Text style={{ color: colors.muted, fontWeight: "700" }}>{label}</Text>
      <Text style={{ flex: 1, textAlign: "right", fontWeight: "800", color: colors.text }}>{value}</Text>
    </View>
  );
}

function ActionButton({
  testID,
  label,
  onPress,
  disabled,
  color,
  textColor = "#fff",
  borderColor,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color: string;
  textColor?: string;
  borderColor?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 48,
        borderRadius: 12,
        backgroundColor: color,
        borderWidth: borderColor ? 1 : 0,
        borderColor,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 12,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text style={{ color: textColor, fontWeight: "800", textAlign: "center" }}>{label}</Text>
    </Pressable>
  );
}

export function ChequeSavedConfirm({ saved, onNew }: { saved: SavedChequeBatch; onNew: () => void }) {
  const { client, companyId, activeCompany } = useAuth();
  const params = useLocalSearchParams<{ contact_id?: string; contact_name?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = saved.items.length;
  const due = batchDueLabel(saved.items);

  const printReceipt = async () => {
    setBusy(true);
    try {
      if (saved.mode === "group" && saved.receiptGroupId) {
        const group = await get<ChequeReceiptGroup>(client, "/cheques/receipt", {
          group_id: saved.receiptGroupId,
          company_id: companyId,
        });
        await printChequeGroupReceipt(group, activeCompany, client);
      } else if (saved.items[0]) {
        await printChequeReceipt(saved.items[0], activeCompany, client);
      }
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Makbuz yazdırılamadı."));
    } finally {
      setBusy(false);
    }
  };

  const shareReceipt = async () => {
    setBusy(true);
    try {
      if (saved.mode === "group") {
        await shareChequeGroupReceipt({
          receipt_group_id: saved.receiptGroupId,
          cheques: saved.items,
          total: saved.total,
        }, activeCompany, client);
      } else if (saved.items[0]) {
        await shareChequeReceipt(saved.items[0], activeCompany, client);
      }
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Makbuz paylaşılamadı."));
    } finally {
      setBusy(false);
    }
  };

  const goContact = () => {
    const routed = chequeReturnContact(params);
    const id = saved.contactId || routed?.id || "";
    const name = saved.contactName || routed?.name || "";
    if (!id) return;
    router.replace({ pathname: "/contacts/[id]", params: { id, name } });
  };

  return (
    <View testID="cheque-saved" style={{ gap: 12 }}>
      <View style={{ alignItems: "center", gap: 6, paddingVertical: 8 }}>
        <Text style={{ fontSize: 42, color: colors.primary }}>✓</Text>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text, textAlign: "center" }}>{count} çek kaydedildi</Text>
        <Muted>{`${saved.contactName} cari bakiyesine işlendi · portföyde “açık”`}</Muted>
      </View>
      <Card>
        <SummaryRow label="Cari" value={saved.contactName || "—"} />
        <SummaryRow label="Adet" value={String(count)} />
        <SummaryRow label="Vade" value={due} />
        <SummaryRow label="Kayıt tarihi" value={fmtDate(saved.recordDate)} />
        <SummaryRow label="Toplam" value={fmtMoney(saved.total)} />
      </Card>
      <ErrorBanner message={error} />
      <ActionButton
        testID="cheque-saved-print"
        label={`🖨 Makbuz yazdır (${count} çek, tek makbuz)`}
        onPress={printReceipt}
        disabled={busy}
        color={colors.primary}
      />
      <ActionButton
        testID="cheque-saved-share"
        label="↗ Paylaş (PDF / WhatsApp)"
        onPress={shareReceipt}
        disabled={busy}
        color={colors.indigo}
      />
      <ActionButton
        testID="cheque-saved-contact"
        label="Cariye git"
        onPress={goContact}
        disabled={busy}
        color={colors.secondary}
      />
      <ActionButton
        testID="cheque-saved-new"
        label="Yeni tahsilat"
        onPress={onNew}
        disabled={busy}
        color="#fff"
        textColor={colors.text}
        borderColor={colors.border}
      />
    </View>
  );
}

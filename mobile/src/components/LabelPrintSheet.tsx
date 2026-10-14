import React, { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { colors } from "../theme";
import { B2BSheet } from "./b2b/B2BSheet";
import { ErrorBanner, Muted, PrimaryButton } from "./kit";
import { QuantityInput } from "./MoneyInput";

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
  testID = "label-print-sheet",
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
  testID?: string;
}) {
  const [qty, setQty] = useState<string | number>(initialQty);
  const [includePrice, setIncludePrice] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setQty(initialQty);
    setIncludePrice(true);
  }, [initialQty, visible]);

  const copies = Math.max(1, Math.min(200, Math.round(Number(String(qty).replace(",", ".")) || 1)));

  return (
    <B2BSheet visible={visible} title={title} subtitle={subtitle} onClose={onClose} testID={testID}>
      <ErrorBanner message={error || null} />
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
        title={busy ? "Basılıyor…" : "Etiket bas"}
        testID={`${testID}-go`}
        icon="print"
        color={colors.indigo}
        loading={!!busy}
        disabled={!copies}
        onPress={() => onPrint(copies, { includePrice })}
      />
    </B2BSheet>
  );
}

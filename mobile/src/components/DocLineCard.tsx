import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "../theme";
import type { InvoiceLine } from "../utils/documentLines";
import { fmtMoney } from "../utils/money";

export type DocLineCardPrefix = "inv-item" | "q-item";

type DocLine = Pick<
  InvoiceLine,
  "name" | "product_name" | "quantity" | "unit_price" | "vat_rate" | "discount_rate" | "unit" | "total_incl"
>;

type Props = {
  line: DocLine;
  currency?: string;
  testIDPrefix: DocLineCardPrefix;
  index: number;
  onPress?: () => void;
  onDelete?: () => void;
  editable?: boolean;
};

function LineStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, backgroundColor: colors.slate50, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 6 }}>
      <Text style={{ fontSize: 9, fontWeight: "800", color: colors.muted }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "800", color: colors.text }}>{value}</Text>
    </View>
  );
}

/** Fatura ve teklif satır kartı. testID: `${prefix}-${index}`, sil: `${prefix}-del-${index}`. */
export function DocLineCard({
  line,
  currency = "TRY",
  testIDPrefix,
  index,
  onPress,
  onDelete,
  editable = true,
}: Props) {
  return (
    <View style={{ marginTop: index ? 8 : 0 }}>
      <Pressable
        testID={`${testIDPrefix}-${index}`}
        onPress={editable ? onPress : undefined}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, gap: 8, backgroundColor: "#fff" }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={2} style={{ flex: 1, fontWeight: "800", color: colors.text }}>{line.name || line.product_name || "Kalem"}</Text>
          {editable ? (
            <Pressable
              onPress={onDelete}
              testID={`${testIDPrefix}-del-${index}`}
              accessibilityLabel="Kalemi sil"
              style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <LineStat label="ADET" value={String(line.quantity)} />
          <LineStat label="FİYAT" value={fmtMoney(line.unit_price, currency)} />
          <LineStat label="KDV" value={`%${line.vat_rate}`} />
          <LineStat label="İSK" value={`%${line.discount_rate || 0}`} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: colors.muted, fontWeight: "700" }}>{line.unit || "Adet"}</Text>
          <Text style={{ fontWeight: "800", color: colors.text }}>{fmtMoney(line.total_incl, currency)}</Text>
        </View>
      </Pressable>
    </View>
  );
}

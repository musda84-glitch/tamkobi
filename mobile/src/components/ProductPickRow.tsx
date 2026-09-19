import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Badge } from "./kit";
import { ProductThumb } from "./ProductThumb";
import { colors } from "../theme";
import type { Product } from "../types";
import { fmtMoney, idOf } from "../utils/money";
import { productImage, productPickSubtitle, stockBadge, stockRightLabel } from "../utils/productDisplay";

export function ProductPickRow({
  product,
  onPress,
  testID,
}: {
  product: Product;
  onPress: () => void;
  testID?: string;
}) {
  const id = idOf(product);
  const badge = stockBadge(product);
  const qtyTone = badge?.tone === "danger" ? "red" : badge?.tone === "warning" ? "amber" : "green";
  return (
    <Pressable
      testID={testID || `prod-pick-${id}`}
      onPress={onPress}
      style={styles.row}
    >
      <ProductThumb uri={productImage(product)} size={64} testID={`prod-pick-thumb-${id}`} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>{productPickSubtitle(product)}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{fmtMoney(product.sale_price)}</Text>
          <Badge label={badge?.label || stockRightLabel(product)} tone={qtyTone} />
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    minHeight: 84,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontWeight: "700", color: colors.text, fontSize: 14 },
  meta: { color: colors.muted, fontSize: 12 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" },
  price: { fontWeight: "800", color: colors.text, fontSize: 15 },
});

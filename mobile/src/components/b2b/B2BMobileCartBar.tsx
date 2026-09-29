import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "../../theme";
import { b2bMobileCartBarCopy } from "../../utils/b2bMobileCartBar";
import { fmtMoney } from "../../utils/money";

/** Web `MobileCartBar` ile aynı: alt sabit sepet şeridi (badge + tutar + Siparişe geç). */
export function B2BMobileCartBar({
  count,
  total,
  heldCount = 0,
  showPrices = true,
  onPress,
}: {
  count: number;
  total: number;
  heldCount?: number;
  showPrices?: boolean;
  onPress: () => void;
}) {
  const copy = b2bMobileCartBarCopy(count, heldCount);
  if (!copy.visible) return null;
  const actionColor = copy.actionTone === "go" ? "#6EE7B7" : "#FCD34D";

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        paddingHorizontal: 12,
        paddingBottom: 12,
        paddingTop: 4,
      }}
    >
      <Pressable
        testID="b2b-mobile-cart-bar"
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={count > 0 ? `Sepet, ${count} ürün, ${fmtMoney(total)}` : copy.title}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: colors.secondary,
          borderRadius: 16,
          paddingHorizontal: 16,
          paddingVertical: 14,
          shadowColor: "#020617",
          shadowOpacity: 0.35,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
          <View style={{ position: "relative", width: 24, height: 24 }}>
            <Ionicons name="cart" size={22} color="#fff" />
            <View
              testID="b2b-mobile-cart-badge"
              style={{
                position: "absolute",
                top: -8,
                right: -10,
                minWidth: 18,
                height: 18,
                paddingHorizontal: 4,
                borderRadius: 999,
                backgroundColor: colors.primary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{copy.badge}</Text>
            </View>
          </View>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }} numberOfLines={1}>
            {copy.title}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
          {count > 0 && showPrices ? (
            <Text testID="b2b-mobile-cart-total" style={{ color: "#fff", fontWeight: "900", fontSize: 16 }} numberOfLines={1}>
              {fmtMoney(total)}
            </Text>
          ) : null}
          <Text
            testID="b2b-mobile-cart-action"
            style={{ color: actionColor, fontWeight: "700", fontSize: 12 }}
            numberOfLines={1}
          >
            {copy.action}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

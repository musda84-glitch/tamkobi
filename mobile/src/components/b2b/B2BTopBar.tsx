import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { colors } from "../../theme";

/** Üst şerit: sepet butonu + hesap menüsü (şifre / çıkış). */
export function B2BTopBar({
  logo,
  company,
  contact,
  count,
  allowOrders,
  onCart,
  onMenu,
}: {
  logo?: string | null;
  company?: string | null;
  contact?: string | null;
  count: number;
  allowOrders: boolean;
  onCart: () => void;
  onMenu: () => void;
}) {
  return (
    <View testID="b2b-topbar" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      {logo ? (
        <Image source={{ uri: logo }} style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: "#fff" }} />
      ) : (
        <Ionicons name="storefront" size={28} color={colors.primary} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 16 }} numberOfLines={1}>
          {company || "Bayi Portalı"}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
          {contact || "B2B"}
        </Text>
      </View>
      {allowOrders ? (
        <Pressable
          testID="b2b-cart-btn"
          onPress={onCart}
          style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.emerald50, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="cart" size={22} color={colors.primaryHover} />
          {count > 0 ? (
            <View
              testID="b2b-cart-count"
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                minWidth: 18,
                height: 18,
                paddingHorizontal: 4,
                borderRadius: 999,
                backgroundColor: colors.danger,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{count}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
      <Pressable
        testID="b2b-account-menu-btn"
        onPress={onMenu}
        style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.slate100, alignItems: "center", justifyContent: "center" }}
      >
        <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
      </Pressable>
    </View>
  );
}

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";
import { colors } from "../theme";
import { typeface } from "../theme/softFont";

/** Mesaim üst bar: başlık + minimal konum / konumlu giriş durumu. */
export function MesaimHeaderTitle({
  place,
  status,
  on = true,
}: {
  place?: string | null;
  status?: string | null;
  on?: boolean;
}) {
  const line = [place, status].map((s) => String(s || "").trim()).filter(Boolean).join(" · ");
  return (
    <View testID="mesai-header-title" style={{ flexShrink: 1, minWidth: 0, maxWidth: 260, gap: 1 }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800", ...typeface("800") }} numberOfLines={1}>
        Mesaim
      </Text>
      {line ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons
            name={on ? "location" : "location-outline"}
            size={11}
            color={on ? colors.primary : colors.muted}
          />
          <Text
            testID="mesai-header-geo"
            style={{ color: colors.muted, fontSize: 11, fontWeight: "600", flexShrink: 1 }}
            numberOfLines={1}
          >
            {line}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

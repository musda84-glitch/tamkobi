import React from "react";
import { Text, View } from "react-native";
import { colors } from "../theme";
import { greetingLine } from "../utils/greeting";

/** Özet başlığının yanında ince yazıyla selamlama ve aktif firma; gövdede yer kaplamasın diye başlıkta durur. */
export function HomeHeaderTitle({ name, company }: { name?: string | null; company?: string | null }) {
  const greeting = greetingLine(name);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
      <Text style={{ fontWeight: "800", color: colors.text, fontSize: 17 }}>Özet</Text>
      <View style={{ width: 1, height: 20, backgroundColor: colors.border, marginHorizontal: 8 }} />
      <View style={{ flexShrink: 1, maxWidth: 190 }}>
        <Text style={{ color: colors.text, fontSize: 11, fontWeight: "700" }} numberOfLines={1}>
          {greeting}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 10 }} numberOfLines={1}>
          {company || "TamKobi"}
        </Text>
      </View>
    </View>
  );
}

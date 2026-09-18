import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors, radius } from "../theme";
import { QUICK_TONE_COLORS, type QuickTone } from "../utils/quickMenu";

export type ActionTile = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: QuickTone;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
};

/** Ana ekrandaki hızlı menüyle aynı dil: tam genişlik buton yığını yerine kompakt kutucuklar. */
export function ActionTiles({ items, columns = 4 }: { items: ActionTile[]; columns?: 3 | 4 }) {
  const width = `${100 / columns}%` as const;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 }}>
      {items.map((item) => {
        const tone = QUICK_TONE_COLORS[item.tone || "slate"];
        return (
          <Pressable
            key={item.key}
            testID={item.testID}
            onPress={item.onPress}
            disabled={item.disabled || item.busy}
            style={{ width, padding: 4, opacity: item.disabled ? 0.4 : 1 }}
          >
            <View
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                paddingVertical: 10,
                paddingHorizontal: 4,
                alignItems: "center",
                gap: 6,
                minHeight: 76,
              }}
            >
              <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: tone.bg, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={item.busy ? "hourglass-outline" : item.icon} size={18} color={tone.fg} />
              </View>
              <Text style={{ fontWeight: "700", color: colors.text, fontSize: 11, textAlign: "center" }} numberOfLines={2}>
                {item.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

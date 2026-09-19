import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { colors } from "../theme";
import { QUICK_TONE_COLORS, type QuickTone } from "../utils/quickMenu";

export type ActionTile = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: QuickTone;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  badge?: string;
  testID?: string;
};

type TileSize = "xs" | "sm" | "md";

const SIZES = {
  xs: { minHeight: 62, badge: 26, radius: 10, icon: 14, font: 10, padding: 6, gap: 4 },
  sm: { minHeight: 82, badge: 36, radius: 12, icon: 18, font: 11, padding: 10, gap: 8 },
  md: { minHeight: 104, badge: 46, radius: 16, icon: 22, font: 12, padding: 14, gap: 8 },
} as const;

/** Renkli zemin + katı ikon rozeti; ana ekran hızlı menüsü ve kayıt işlemleri aynı dili kullanır. */
export function ActionTiles({
  items,
  columns = 4,
  size = "sm",
}: {
  items: ActionTile[];
  columns?: 3 | 4;
  size?: TileSize;
}) {
  const width = `${100 / columns}%` as const;
  const s = SIZES[size];
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
            style={({ pressed }) => ({
              width,
              padding: 4,
              position: "relative",
              overflow: "visible",
              opacity: item.disabled ? 0.45 : pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            {item.badge ? (
              <View
                testID={item.testID ? `${item.testID}-badge` : undefined}
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  zIndex: 2,
                  minWidth: 20,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 999,
                  backgroundColor: colors.danger,
                  borderWidth: 2,
                  borderColor: "#fff",
                }}
              >
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800", textAlign: "center" }}>{item.badge}</Text>
              </View>
            ) : null}
            <View
              style={{
                backgroundColor: tone.bg,
                borderWidth: 1,
                borderColor: tone.border,
                borderRadius: s.radius + 4,
                paddingVertical: s.padding,
                paddingHorizontal: 6,
                alignItems: "center",
                gap: s.gap,
                minHeight: s.minHeight,
                overflow: "visible",
                ...Platform.select({
                  web: { boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)" },
                  default: {
                    shadowColor: "#0F172A",
                    shadowOpacity: 0.06,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: 1,
                  },
                }),
              }}
            >
              <View
                style={{
                  width: s.badge,
                  height: s.badge,
                  borderRadius: s.radius,
                  backgroundColor: tone.solid,
                  alignItems: "center",
                  justifyContent: "center",
                  ...Platform.select({
                    web: { boxShadow: `0 4px 10px ${tone.solid}33` },
                    default: {
                      shadowColor: tone.solid,
                      shadowOpacity: 0.3,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 3 },
                      elevation: 2,
                    },
                  }),
                }}
              >
                <Ionicons name={item.busy ? "hourglass-outline" : item.icon} size={s.icon} color="#fff" />
              </View>
              <Text
                style={{
                  fontWeight: "800",
                  color: colors.text,
                  fontSize: s.font,
                  textAlign: "center",
                  fontFamily: Platform.OS === "web" ? 'system-ui, "Segoe UI", Roboto, Arial, sans-serif' : undefined,
                }}
                numberOfLines={2}
              >
                {item.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

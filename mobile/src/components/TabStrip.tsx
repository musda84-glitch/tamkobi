import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { colors } from "../theme";

export type TabStripItem<K extends string = string> = {
  key: K;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  count?: number;
  color?: string;
};

/** Kaydırılabilir ince sekme şeridi: ikon + kısa etiket + sayaç. */
export function TabStrip<K extends string>({
  items,
  value,
  onChange,
  testID = "tab-strip",
  variant = "pill",
}: {
  items: TabStripItem<K>[];
  value: K;
  onChange: (key: K) => void;
  testID?: string;
  variant?: "pill" | "icons";
}) {
  if (variant === "icons") {
    return (
      <View testID={testID} style={{ flexDirection: "row", alignItems: "flex-start" }}>
        {items.map((item) => {
          const active = item.key === value;
          const accent = item.color || colors.primary;
          return (
            <Pressable
              key={item.key}
              testID={`${testID}-${item.key}`}
              onPress={() => onChange(item.key)}
              style={{ flex: 1, alignItems: "center", gap: 4, paddingVertical: 6 }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: active ? accent : colors.slate100,
                }}
              >
                <Ionicons name={item.icon} size={20} color={active ? "#fff" : accent} />
                {item.count ? (
                  <View
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -6,
                      minWidth: 18,
                      paddingHorizontal: 4,
                      borderRadius: 999,
                      backgroundColor: colors.danger,
                      borderWidth: 2,
                      borderColor: "#fff",
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800", textAlign: "center" }}>{item.count}</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: "800", color: active ? accent : colors.muted }}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={{ flexGrow: 0, flexShrink: 0 }} testID={`${testID}-wrap`}>
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      testID={testID}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: 6, paddingVertical: 2, alignItems: "center", flexGrow: 0 }}
    >
      {items.map((item) => {
        const active = item.key === value;
        const accent = item.color || colors.primary;
        return (
          <Pressable
            key={item.key}
            testID={`${testID}-${item.key}`}
            onPress={() => onChange(item.key)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? accent : colors.border,
              backgroundColor: active ? accent : colors.surface,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name={item.icon} size={14} color={active ? "#fff" : colors.muted} />
            <Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#fff" : colors.text }}>{item.label}</Text>
            {item.count ? (
              <View style={{ borderRadius: 999, paddingHorizontal: 5, backgroundColor: active ? "rgba(255,255,255,0.25)" : colors.slate100 }}>
                <Text style={{ fontSize: 10, fontWeight: "800", color: active ? "#fff" : colors.muted }}>{item.count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
    </View>
  );
}

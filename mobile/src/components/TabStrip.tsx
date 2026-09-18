import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { colors } from "../theme";

export type TabStripItem<K extends string = string> = {
  key: K;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  count?: number;
};

/** Kaydırılabilir ince sekme şeridi: ikon + kısa etiket + sayaç. */
export function TabStrip<K extends string>({
  items,
  value,
  onChange,
  testID = "tab-strip",
}: {
  items: TabStripItem<K>[];
  value: K;
  onChange: (key: K) => void;
  testID?: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      testID={testID}
      contentContainerStyle={{ gap: 6, paddingVertical: 2 }}
    >
      {items.map((item) => {
        const active = item.key === value;
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
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? colors.primary : colors.surface,
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
  );
}

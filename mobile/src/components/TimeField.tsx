import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import { trUpper } from "../utils/labels";
import { formatHm, hourOptions, minuteOptions, parseHm } from "../utils/clock";

type TimeFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  testID?: string;
  optional?: boolean;
  autoOpen?: boolean;
};

export function TimeField({ label, value, onChangeText, testID, optional, autoOpen }: TimeFieldProps) {
  const [open, setOpen] = useState(false);
  const parsed = parseHm(value);
  const [hour, setHour] = useState(parsed?.hour ?? 16);
  const [minute, setMinute] = useState(parsed?.minute ?? 0);

  const openPicker = () => {
    const now = parseHm(value);
    if (now) {
      setHour(now.hour);
      setMinute(now.minute - (now.minute % 5));
    }
    setOpen(true);
  };

  useEffect(() => {
    if (autoOpen) openPicker();
    // Open once when the confirm row mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  const confirm = () => {
    onChangeText(formatHm(hour, minute));
    setOpen(false);
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 4 }}>{trUpper(label)}</Text>
      <Pressable
        testID={testID}
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[inputStyle, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
      >
        <Text style={{ color: value ? colors.text : colors.muted, fontSize: 15 }}>
          {value || (optional ? "HH:MM (opsiyonel)" : "Saat seçin")}
        </Text>
        <Ionicons name="time-outline" size={18} color={colors.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.35)", justifyContent: "center", padding: 16 }}>
          <Pressable
            testID={testID ? `${testID}-picker` : undefined}
            onPress={(e) => e.stopPropagation()}
            style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ fontWeight: "800", color: colors.text, marginBottom: 10 }}>Saat seçin</Text>
            <View style={{ flexDirection: "row", gap: 12, height: 200 }}>
              <ScrollView style={{ flex: 1 }} testID={testID ? `${testID}-hours` : undefined}>
                {hourOptions().map((h) => (
                  <Pressable
                    key={h}
                    testID={testID ? `${testID}-hour-${h}` : undefined}
                    onPress={() => setHour(h)}
                    style={{ paddingVertical: 8, borderRadius: 8, backgroundColor: h === hour ? colors.emerald100 : "transparent" }}
                  >
                    <Text style={{ textAlign: "center", fontWeight: "700", color: colors.text }}>{String(h).padStart(2, "0")}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <ScrollView style={{ flex: 1 }} testID={testID ? `${testID}-minutes` : undefined}>
                {minuteOptions(5).map((m) => (
                  <Pressable
                    key={m}
                    testID={testID ? `${testID}-minute-${m}` : undefined}
                    onPress={() => setMinute(m)}
                    style={{ paddingVertical: 8, borderRadius: 8, backgroundColor: m === minute ? colors.emerald100 : "transparent" }}
                  >
                    <Text style={{ textAlign: "center", fontWeight: "700", color: colors.text }}>{String(m).padStart(2, "0")}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              {optional ? (
                <Pressable
                  testID={testID ? `${testID}-clear` : undefined}
                  onPress={() => { onChangeText(""); setOpen(false); }}
                  style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontWeight: "700", color: colors.muted }}>Temizle</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={confirm}
                testID={testID ? `${testID}-ok` : undefined}
                style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderRadius: radius.md }}
              >
                <Text style={{ fontWeight: "800", color: "#fff" }}>Seç</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.md,
  paddingHorizontal: 12,
  paddingVertical: 10,
  minHeight: 44,
  fontSize: 15,
  color: colors.text,
  backgroundColor: "#fff",
} as const;

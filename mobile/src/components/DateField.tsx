import { Ionicons } from "@expo/vector-icons";
import React, { createElement, useMemo, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import { trUpper } from "../utils/labels";
import { monthGrid, monthTitle, normalizeYmd, parseYmd, shiftMonth, toYmd, weekdayLabels } from "../utils/calendar";

type DateFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  testID?: string;
  min?: string;
};

const webInputStyle: Record<string, string | number> = {
  width: "100%",
  boxSizing: "border-box",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: colors.border,
  borderRadius: 10,
  paddingLeft: 12,
  paddingRight: 12,
  paddingTop: 10,
  paddingBottom: 10,
  minHeight: 44,
  fontSize: 15,
  color: colors.text,
  backgroundColor: "#fff",
};

export function DateField({ label, value, onChangeText, testID, min }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const ymd = normalizeYmd(value);
  const minYmd = normalizeYmd(min || "");
  const selected = parseYmd(ymd);
  const seed = selected || new Date();
  const [cursor, setCursor] = useState({ year: seed.getFullYear(), month0: seed.getMonth() });
  const cells = useMemo(() => monthGrid(cursor.year, cursor.month0), [cursor.year, cursor.month0]);

  const commit = (next: string) => {
    const clean = normalizeYmd(next);
    onChangeText(clean);
  };

  const pick = (day: number) => {
    const next = toYmd(new Date(cursor.year, cursor.month0, day));
    if (minYmd && next < minYmd) return;
    commit(next);
    setOpen(false);
  };

  const openCal = () => {
    const d = parseYmd(ymd) || new Date();
    setCursor({ year: d.getFullYear(), month0: d.getMonth() });
    setOpen(true);
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 4 }}>{trUpper(label)}</Text>
      {Platform.OS === "web" ? (
        createElement("input", {
          type: "date",
          value: ymd,
          min: minYmd || undefined,
          onChange: (e: { target: { value: string } }) => commit(e.target.value),
          "data-testid": testID,
          style: webInputStyle,
        })
      ) : (
        <Pressable testID={testID} onPress={openCal} style={[inputStyle, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
          <Text style={{ color: ymd ? colors.text : colors.muted, fontSize: 15 }}>{ymd || "Tarih seçin"}</Text>
          <Ionicons name="calendar-outline" size={18} color={colors.muted} />
        </Pressable>
      )}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.35)", justifyContent: "center", padding: 16 }}>
          <Pressable
            testID={testID ? `${testID}-cal` : undefined}
            onPress={(e) => e.stopPropagation()}
            style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <Pressable testID={testID ? `${testID}-prev` : undefined} onPress={() => setCursor((c) => shiftMonth(c.year, c.month0, -1))} style={{ padding: 8 }}>
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </Pressable>
              <Text style={{ fontWeight: "800", color: colors.text, textTransform: "capitalize" }}>{monthTitle(cursor.year, cursor.month0)}</Text>
              <Pressable testID={testID ? `${testID}-next` : undefined} onPress={() => setCursor((c) => shiftMonth(c.year, c.month0, 1))} style={{ padding: 8 }}>
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", marginBottom: 6 }}>
              {weekdayLabels().map((d) => (
                <Text key={d} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700", color: colors.muted }}>{d}</Text>
              ))}
            </View>
            {Array.from({ length: cells.length / 7 }, (_, row) => (
              <View key={row} style={{ flexDirection: "row" }}>
                {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
                  const next = day ? toYmd(new Date(cursor.year, cursor.month0, day)) : "";
                  const active = Boolean(day && next === ymd);
                  const blocked = Boolean(day && minYmd && next < minYmd);
                  return (
                    <Pressable
                      key={`${row}-${col}`}
                      disabled={!day || blocked}
                      onPress={() => day && pick(day)}
                      style={{
                        flex: 1,
                        minHeight: 40,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 999,
                        backgroundColor: active ? colors.primary : "transparent",
                        opacity: blocked ? 0.35 : 1,
                      }}
                    >
                      <Text style={{ fontWeight: "700", color: !day ? "transparent" : active ? "#fff" : colors.text }}>{day || ""}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
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

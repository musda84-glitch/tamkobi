import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import { monthTitle, normalizeYm, parseYm, toYm, ymOrThisMonth } from "../utils/calendar";
import { trUpper } from "../utils/labels";

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

type MonthFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  testID?: string;
  editable?: boolean;
  dense?: boolean;
};

export function MonthField({ label, value, onChangeText, testID, editable = true, dense = false }: MonthFieldProps) {
  const [open, setOpen] = useState(false);
  const ym = normalizeYm(value);
  const parsed = parseYm(ym) || parseYm(ymOrThisMonth(value));
  const [year, setYear] = useState(parsed?.year || new Date().getFullYear());
  const display = useMemo(() => {
    const p = parseYm(ym);
    return p ? monthTitle(p.year, p.month0) : "Ay seçin";
  }, [ym]);

  const commit = (next: string) => {
    onChangeText(normalizeYm(next));
  };

  const pick = (month0: number) => {
    commit(toYm(year, month0));
    setOpen(false);
  };

  const openPicker = () => {
    if (!editable) return;
    const p = parseYm(ym) || parseYm(ymOrThisMonth(""));
    if (p) setYear(p.year);
    setOpen(true);
  };

  return (
    <View style={{ marginBottom: dense ? 0 : spacing.md }}>
      <Text style={{ fontSize: dense ? 10 : 11, fontWeight: "700", color: colors.muted, marginBottom: dense ? 2 : 4 }}>{trUpper(label)}</Text>
      {Platform.OS === "web" ? (
        <input
          type="month"
          data-testid={testID}
          value={ym}
          disabled={!editable}
          onChange={(e) => commit(e.currentTarget.value)}
          onFocus={(e) => {
            const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
            try { el.showPicker?.(); } catch { /* eski tarayıcı */ }
          }}
          onClick={(e) => {
            const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
            try { el.showPicker?.(); } catch { /* eski tarayıcı */ }
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: colors.border,
            borderRadius: 10,
            padding: dense ? "6px 8px" : "10px 12px",
            minHeight: dense ? 40 : 44,
            fontSize: dense ? 14 : 15,
            color: colors.text,
            backgroundColor: "#fff",
          }}
        />
      ) : (
        <Pressable
          testID={testID}
          onPress={openPicker}
          disabled={!editable}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            paddingHorizontal: 12,
            paddingVertical: dense ? 6 : 10,
            minHeight: dense ? 40 : 44,
            backgroundColor: "#fff",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            opacity: editable ? 1 : 0.6,
          }}
        >
          <Text style={{ color: ym ? colors.text : colors.muted, fontSize: dense ? 14 : 15, textTransform: "capitalize" }}>{display}</Text>
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
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Pressable testID={testID ? `${testID}-prev` : undefined} onPress={() => setYear((y) => y - 1)} style={{ padding: 8 }}>
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </Pressable>
              <Text style={{ fontWeight: "800", color: colors.text }}>{year}</Text>
              <Pressable testID={testID ? `${testID}-next` : undefined} onPress={() => setYear((y) => y + 1)} style={{ padding: 8 }}>
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {MONTHS.map((name, month0) => {
                const active = ym === toYm(year, month0);
                return (
                  <Pressable
                    key={name}
                    testID={testID ? `${testID}-m${month0 + 1}` : undefined}
                    onPress={() => pick(month0)}
                    style={{
                      width: "30%",
                      flexGrow: 1,
                      minHeight: 40,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 10,
                      backgroundColor: active ? colors.primary : colors.slate50,
                    }}
                  >
                    <Text style={{ fontWeight: "700", color: active ? "#fff" : colors.text }}>{name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

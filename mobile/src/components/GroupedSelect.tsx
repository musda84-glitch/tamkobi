import { Ionicons } from "@expo/vector-icons";
import React, { createElement, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import { trUpper } from "../utils/labels";
import { Muted } from "./kit";

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectGroup = { label: string; options: SelectOption[] };

function triggerBox(dense?: boolean, swatchColor?: string) {
  return {
    minHeight: dense ? 40 : 48,
    borderWidth: 1.5,
    borderColor: swatchColor || "#C7D2FE",
    borderRadius: radius.md,
    paddingHorizontal: dense ? 10 : 12,
    paddingLeft: swatchColor ? (dense ? 32 : 36) : (dense ? 10 : 12),
    backgroundColor: colors.indigo50,
  } as const;
}

const selectStyle = (dense?: boolean, swatchColor?: string): React.CSSProperties => ({
  ...triggerBox(dense, swatchColor),
  width: "100%",
  borderStyle: "solid",
  paddingRight: 36,
  fontSize: dense ? 14 : 16,
  fontWeight: 700,
  color: colors.text,
  cursor: "pointer",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
});

function StatusSwatch({ color, testID }: { color: string; testID?: string }) {
  return (
    <View
      testID={testID}
      style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color, flexShrink: 0 }}
    />
  );
}

function Chevron({ dense }: { dense?: boolean }) {
  return <Ionicons name="chevron-down" size={dense ? 18 : 20} color={colors.indigo} />;
}

function NativeGroupedSelect({
  value,
  onChange,
  groups,
  emptyLabel,
  testID,
  dense,
  swatchColor,
}: {
  value: string;
  onChange: (v: string) => void;
  groups: SelectGroup[];
  emptyLabel?: string;
  testID?: string;
  dense?: boolean;
  swatchColor?: string;
}) {
  const [open, setOpen] = useState(false);
  const all = groups.flatMap((g) => g.options);
  const selected = all.find((o) => o.value === value);
  const title = selected?.label || emptyLabel || "Seçin";
  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityHint="Açılır menü"
        onPress={() => setOpen((v) => !v)}
        style={{
          ...triggerBox(dense, swatchColor),
          paddingLeft: dense ? 10 : 12,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        {swatchColor ? <StatusSwatch color={swatchColor} testID={testID ? `${testID}-swatch` : undefined} /> : null}
        <Text style={{ flex: 1, fontWeight: "700", color: colors.text, fontSize: dense ? 14 : 15 }}>{title}</Text>
        <Chevron dense={dense} />
      </Pressable>
      {open ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: 6, backgroundColor: "#fff" }}>
          {emptyLabel != null ? (
            <Pressable onPress={() => { onChange(""); setOpen(false); }} style={{ padding: 12 }}>
              <Text style={{ fontWeight: "700", color: colors.muted }}>{emptyLabel}</Text>
            </Pressable>
          ) : null}
          {groups.map((g) => (
            <View key={g.label}>
              <Text style={{ paddingHorizontal: 12, paddingTop: 10, fontSize: 11, fontWeight: "800", color: colors.muted }}>{trUpper(g.label)}</Text>
              {g.options.map((o) => (
                <Pressable
                  key={o.value}
                  testID={testID ? `${testID}-opt-${o.value}` : undefined}
                  onPress={() => { if (o.disabled) return; onChange(o.value); setOpen(false); }}
                  style={{ paddingHorizontal: 12, paddingVertical: 10, backgroundColor: o.value === value ? colors.emerald50 : "#fff", opacity: o.disabled ? 0.5 : 1 }}
                >
                  <Text style={{ fontWeight: "700", color: o.disabled ? colors.muted : colors.text }}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function GroupedSelect({
  label,
  value,
  onChange,
  groups,
  emptyLabel,
  testID,
  dense,
  swatchColor,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  groups: SelectGroup[];
  emptyLabel?: string;
  testID?: string;
  dense?: boolean;
  swatchColor?: string;
}) {
  return (
    <View style={{ marginBottom: dense ? 4 : spacing.md }} testID={testID ? `${testID}-wrap` : undefined}>
      {label ? <Muted>{label}</Muted> : null}
      {Platform.OS === "web"
        ? (
          <View style={{ position: "relative", justifyContent: "center" }}>
            {swatchColor ? (
              <View pointerEvents="none" style={{ position: "absolute", left: 12, top: 0, bottom: 0, justifyContent: "center", zIndex: 1 }}>
                <StatusSwatch color={swatchColor} testID={testID ? `${testID}-swatch` : undefined} />
              </View>
            ) : null}
            {createElement(
              "select",
              {
                value,
                onChange: (e: { target: { value: string } }) => onChange(e.target.value),
                "data-testid": testID,
                "aria-label": label || "Açılır menü",
                style: selectStyle(dense, swatchColor),
              },
              [
                emptyLabel != null ? createElement("option", { key: "__empty", value: "" }, emptyLabel) : null,
                ...groups.map((g) =>
                  createElement(
                    "optgroup",
                    { key: g.label, label: g.label },
                    g.options.map((o) => createElement("option", { key: o.value, value: o.value, disabled: !!o.disabled }, o.label))
                  )
                ),
              ]
            )}
            <View pointerEvents="none" style={{ position: "absolute", right: 10, top: 0, bottom: 0, justifyContent: "center" }}>
              <Chevron dense={dense} />
            </View>
          </View>
        )
        : (
          <NativeGroupedSelect value={value} onChange={onChange} groups={groups} emptyLabel={emptyLabel} testID={testID} dense={dense} swatchColor={swatchColor} />
        )}
    </View>
  );
}

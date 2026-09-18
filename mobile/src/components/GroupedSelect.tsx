import React, { createElement, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import { Muted } from "./kit";

export type SelectOption = { value: string; label: string };
export type SelectGroup = { label: string; options: SelectOption[] };

const selectStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 48,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: colors.border,
  borderRadius: radius.md,
  paddingLeft: 12,
  paddingRight: 12,
  fontSize: 16,
  fontWeight: 700,
  color: colors.text,
  backgroundColor: "#fff",
};

function NativeGroupedSelect({
  value,
  onChange,
  groups,
  emptyLabel,
  testID,
}: {
  value: string;
  onChange: (v: string) => void;
  groups: SelectGroup[];
  emptyLabel?: string;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const all = groups.flatMap((g) => g.options);
  const selected = all.find((o) => o.value === value);
  const title = selected?.label || emptyLabel || "Seçin";
  return (
    <View>
      <Pressable
        testID={testID}
        onPress={() => setOpen((v) => !v)}
        style={{
          minHeight: 48,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: 12,
          justifyContent: "center",
          backgroundColor: "#fff",
        }}
      >
        <Text style={{ fontWeight: "700", color: colors.text }}>{title}</Text>
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
              <Text style={{ paddingHorizontal: 12, paddingTop: 10, fontSize: 11, fontWeight: "800", color: colors.muted, textTransform: "uppercase" }}>{g.label}</Text>
              {g.options.map((o) => (
                <Pressable
                  key={o.value}
                  testID={testID ? `${testID}-opt-${o.value}` : undefined}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                  style={{ paddingHorizontal: 12, paddingVertical: 10, backgroundColor: o.value === value ? colors.emerald50 : "#fff" }}
                >
                  <Text style={{ fontWeight: "700", color: colors.text }}>{o.label}</Text>
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
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  groups: SelectGroup[];
  emptyLabel?: string;
  testID?: string;
}) {
  return (
    <View style={{ marginBottom: spacing.md }} testID={testID ? `${testID}-wrap` : undefined}>
      {label ? <Muted>{label}</Muted> : null}
      {Platform.OS === "web"
        ? createElement(
            "select",
            {
              value,
              onChange: (e: { target: { value: string } }) => onChange(e.target.value),
              "data-testid": testID,
              style: selectStyle,
            },
            [
              emptyLabel != null ? createElement("option", { key: "__empty", value: "" }, emptyLabel) : null,
              ...groups.map((g) =>
                createElement(
                  "optgroup",
                  { key: g.label, label: g.label },
                  g.options.map((o) => createElement("option", { key: o.value, value: o.value }, o.label))
                )
              ),
            ]
          )
        : (
          <NativeGroupedSelect value={value} onChange={onChange} groups={groups} emptyLabel={emptyLabel} testID={testID} />
        )}
    </View>
  );
}

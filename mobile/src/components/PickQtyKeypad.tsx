import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors, radius } from "../theme";

const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
] as const;

/** İlk tuş boş taslağın üstüne yazılır; sonraki tuşlar ekler. Virgül yalnız ondalık birimde. */
export function nextPickDraft(current: string, token: string, decimal: boolean): string {
  if (token === "⌫") return current.slice(0, -1);
  if (token === ",") {
    if (!decimal || current.includes(",")) return current;
    return `${current || "0"},`;
  }
  if (!/^[0-9]$/.test(token)) return current;
  return `${current}${token}`;
}

function KeyButton({
  label,
  testID,
  onPress,
  disabled,
  confirm,
}: {
  label: string;
  testID: string;
  onPress: () => void;
  disabled?: boolean;
  confirm?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityLabel={label === "⌫" ? "Sil" : confirm ? "Onayla" : label}
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        minHeight: 48,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: confirm ? colors.primary : colors.slate100,
        borderWidth: confirm ? 0 : 1,
        borderColor: colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ fontSize: 22, fontWeight: "800", color: confirm ? "#fff" : colors.text }}>{label}</Text>
    </Pressable>
  );
}

export function PickQtyKeypad({
  index,
  decimal,
  disabled,
  onKey,
  onConfirm,
}: {
  index: number | string;
  decimal: boolean;
  disabled?: boolean;
  onKey: (token: string) => void;
  onConfirm: () => void;
}) {
  const tail = decimal ? ["⌫", "0", ","] : ["⌫", "0"];
  return (
    <View testID={`sevk-keypad-${index}`} style={{ gap: 8, marginTop: 4 }}>
      <Text style={{ textAlign: "center", color: colors.muted, fontSize: 12, fontWeight: "700" }}>
        ↑ Adede dokun, istediğin sayıyı yaz
      </Text>
      {ROWS.map((row) => (
        <View key={row.join("-")} style={{ flexDirection: "row", gap: 8 }}>
          {row.map((key) => (
            <KeyButton
              key={key}
              label={key}
              testID={`sevk-keypad-key-${key}-${index}`}
              onPress={() => onKey(key)}
              disabled={disabled}
            />
          ))}
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {tail.map((key) => (
          <KeyButton
            key={key}
            label={key}
            testID={`sevk-keypad-key-${key}-${index}`}
            onPress={() => onKey(key)}
            disabled={disabled}
          />
        ))}
        <KeyButton
          label="✓"
          testID={`sevk-keypad-ok-${index}`}
          onPress={onConfirm}
          disabled={disabled}
          confirm
        />
      </View>
    </View>
  );
}

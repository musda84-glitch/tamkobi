import React, { useRef, useState } from "react";
import { Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { colors, radius, spacing, typeface } from "../theme";
import { getPriceDecimals } from "../utils/money";
import { applyMoneyEdit, formatMoneyBlur, formatMoneyFocus, sameMoney } from "../utils/trMoneyInput";

export type MoneyValue = number | string | null | undefined;

type Props = {
  value?: MoneyValue;
  onChange?: (value: number | null) => void;
  label?: string;
  testID?: string;
  compact?: boolean;
  dense?: boolean;
  suffix?: string;
  editable?: boolean;
  placeholder?: string;
  allowNegative?: boolean;
  decimals?: number;
  maxFractionDigits?: number;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  onBlur?: () => void;
  onFocus?: () => void;
};

function guessCaret(prev: string, next: string): number {
  let i = 0;
  const limit = Math.min(prev.length, next.length);
  while (i < limit && prev[i] === next[i]) i += 1;
  const inserted = next.length - prev.length;
  if (inserted >= 0) return i + inserted;
  return i;
}

function MoneyField({
  mode,
  value,
  onChange,
  label,
  testID,
  compact,
  dense,
  suffix,
  editable = true,
  placeholder,
  allowNegative = false,
  decimals,
  maxFractionDigits,
  style,
  containerStyle,
  onBlur,
  onFocus,
}: Props & { mode: "money" | "quantity" }) {
  const fraction = maxFractionDigits ?? (mode === "quantity" ? 3 : 4);
  const places = decimals ?? (mode === "quantity" ? 0 : getPriceDecimals());
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");
  const textRef = useRef("");
  const editedAt = useRef(0);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  const opts = { maxFractionDigits: fraction, allowNegative };

  const blurText = formatMoneyBlur(value, places, { maxFractionDigits: fraction });
  const shown = focused ? text : blurText;

  const emit = (next: number | null) => {
    if (!onChange || sameMoney(next, value)) return;
    onChange(next);
  };

  const commit = (prev: string, nextRaw: string, caret: number, inputType = "") => {
    const res = applyMoneyEdit(prev, nextRaw, caret, { ...opts, inputType });
    textRef.current = res.text;
    editedAt.current = Date.now();
    setText(res.text);
    setSelection({ start: res.caret, end: res.caret });
    emit(res.value);
  };

  const input = (
    <TextInput
      testID={testID}
      editable={editable}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      keyboardType="decimal-pad"
      value={shown}
      selection={focused ? selection : undefined}
      onFocus={() => {
        const initial = formatMoneyFocus(value, fraction);
        textRef.current = initial;
        setText(initial);
        setFocused(true);
        setSelection({ start: initial.length, end: initial.length });
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        setSelection(undefined);
        onBlur?.();
      }}
      onChangeText={(next) => {
        const prev = textRef.current;
        const inputType = next.length - prev.length > 1 ? "insertFromPaste" : "";
        commit(prev, next, guessCaret(prev, next), inputType);
      }}
      onSelectionChange={(e) => {
        if (!focused) return;
        if (Date.now() - editedAt.current < 80) return;
        setSelection(e.nativeEvent.selection);
      }}
      style={[
        suffix ? styles.bare : styles.input,
        compact && styles.compact,
        dense && styles.dense,
        style,
      ]}
    />
  );

  return (
    <View style={[{ marginBottom: compact || dense ? 0 : spacing.md }, containerStyle]}>
      {label ? <Text style={[styles.label, dense && styles.labelDense]}>{label.toLocaleUpperCase("tr-TR")}</Text> : null}
      {suffix ? (
        <View style={[styles.input, styles.suffixRow, compact && styles.compact, dense && styles.dense]}>
          {input}
          <Text testID={testID ? `${testID}-currency` : undefined} style={styles.suffix}>{suffix}</Text>
        </View>
      ) : input}
    </View>
  );
}

export function MoneyInput(props: Props) {
  return <MoneyField mode="money" {...props} />;
}

export function QuantityInput(props: Props) {
  return <MoneyField mode="quantity" {...props} />;
}

const styles = {
  label: { fontSize: 11, color: colors.muted, marginBottom: 4, ...typeface("700") },
  labelDense: { fontSize: 10, marginBottom: 2 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 15,
    color: colors.text,
    backgroundColor: "#fff",
    ...typeface("400"),
  },
  bare: {
    flex: 1,
    borderWidth: 0,
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: "transparent",
    ...typeface("400"),
  },
  suffixRow: { flexDirection: "row" as const, alignItems: "center" as const, paddingVertical: 0, paddingRight: 12 },
  suffix: { fontSize: 16, color: colors.text, ...typeface("800"), paddingLeft: 8 },
  compact: { minHeight: 40, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14 },
  dense: { minHeight: 30, paddingHorizontal: 6, paddingVertical: 3, fontSize: 13 },
};

export default MoneyInput;

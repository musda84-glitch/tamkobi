import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, radius } from "../theme";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

type Props = {
  operatorName?: string;
  station?: string;
  error?: string;
  busy?: boolean;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
};

export function ShopfloorPinPad({ operatorName, station, error, busy, onSubmit, onCancel }: Props) {
  const [pin, setPin] = useState("");
  const pinRef = useRef("");
  const busyRef = useRef(!!busy);
  const onSubmitRef = useRef(onSubmit);
  const onCancelRef = useRef(onCancel);
  busyRef.current = !!busy;
  onSubmitRef.current = onSubmit;
  onCancelRef.current = onCancel;

  const clear = () => {
    pinRef.current = "";
    setPin("");
  };

  useEffect(() => () => {
    pinRef.current = "";
  }, []);

  useEffect(() => {
    if (error) clear();
  }, [error]);

  const submit = (value: string) => {
    if (busyRef.current) return;
    if (!/^[0-9]{4}$/.test(value)) return;
    clear();
    onSubmitRef.current(value);
  };

  const push = (digit: string) => {
    if (busyRef.current) return;
    const current = pinRef.current;
    if (current.length >= 4) return;
    const next = `${current}${digit}`;
    pinRef.current = next;
    setPin(next);
    if (next.length === 4) submit(next);
  };

  const back = () => {
    if (busyRef.current) return;
    const next = pinRef.current.slice(0, -1);
    pinRef.current = next;
    setPin(next);
  };

  const cancel = () => {
    if (busyRef.current) return;
    clear();
    if (onCancelRef.current) onCancelRef.current();
  };

  const keyStyle = {
    flex: 1,
    minHeight: 56,
    minWidth: 56,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    opacity: busy ? 0.6 : 1,
  };

  return (
    <View testID="shopfloor-pinpad" style={{ gap: 16 }}>
      <View>
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 18 }}>Operatör PIN</Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>
          {operatorName || "Operatör"}
          {station ? ` · ${station}` : ""}
        </Text>
      </View>
      <View accessibilityLabel="PIN" style={{ flexDirection: "row", justifyContent: "center", gap: 12 }}>
        {[0, 1, 2, 3].map((index) => {
          const filled = index < pin.length;
          return (
            <View
              key={index}
              testID={`shopfloor-pin-dot-${index}`}
              accessibilityState={{ selected: filled }}
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                borderWidth: 2,
                borderColor: filled ? colors.text : "#CBD5E1",
                backgroundColor: filled ? colors.text : colors.surface,
              }}
            />
          );
        })}
      </View>
      {error ? (
        <View
          testID="shopfloor-pin-error"
          accessibilityRole="alert"
          style={{ backgroundColor: "#E11D48", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>{error}</Text>
        </View>
      ) : null}
      <View style={{ gap: 8 }}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={{ flexDirection: "row", gap: 8 }}>
            {DIGITS.slice(row * 3, row * 3 + 3).map((digit) => (
              <Pressable
                key={digit}
                testID={`shopfloor-pin-key-${digit}`}
                accessibilityLabel={digit}
                disabled={!!busy}
                onPress={() => push(digit)}
                style={keyStyle}
              >
                <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>{digit}</Text>
              </Pressable>
            ))}
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            testID="shopfloor-pin-cancel"
            accessibilityLabel="Vazgeç"
            disabled={!!busy}
            onPress={cancel}
            style={{ ...keyStyle, backgroundColor: colors.slate50 }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.muted }}>Vazgeç</Text>
          </Pressable>
          <Pressable
            testID="shopfloor-pin-key-0"
            accessibilityLabel="0"
            disabled={!!busy}
            onPress={() => push("0")}
            style={keyStyle}
          >
            <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>0</Text>
          </Pressable>
          <Pressable
            testID="shopfloor-pin-back"
            accessibilityLabel="Sil"
            disabled={!!busy}
            onPress={back}
            style={keyStyle}
          >
            <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>⌫</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

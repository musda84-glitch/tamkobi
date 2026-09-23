import React from "react";
import { Text, View } from "react-native";
import { colors } from "../theme";
import { normalizeLocationSignal, type LocationSignal } from "../utils/locationConsent";

const DOT = {
  green: "#10B981",
  red: "#F43F5E",
  amber: "#F59E0B",
};

export function LocationSignalDot({
  signal,
  testID = "loc-signal",
}: {
  signal?: LocationSignal | null;
  testID?: string;
}) {
  const view = normalizeLocationSignal(signal);
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View
        testID={`${testID}-dot`}
        style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: DOT[view.tone] }}
      />
      <Text style={{ fontWeight: "700", fontSize: 12, color: colors.text }}>{view.label}</Text>
    </View>
  );
}

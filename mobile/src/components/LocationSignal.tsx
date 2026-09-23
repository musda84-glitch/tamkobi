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
  compact = false,
  hideLabel = false,
}: {
  signal?: LocationSignal | null;
  testID?: string;
  compact?: boolean;
  hideLabel?: boolean;
}) {
  const view = normalizeLocationSignal(signal);
  return (
    <View testID={testID} accessibilityLabel={view.label} style={{ flexDirection: "row", alignItems: "center", gap: compact ? 4 : 8 }}>
      <View
        testID={`${testID}-dot`}
        style={{ width: compact ? 7 : 10, height: compact ? 7 : 10, borderRadius: 999, backgroundColor: DOT[view.tone] }}
      />
      {hideLabel ? null : (
        <Text style={{ fontWeight: "700", fontSize: compact ? 9 : 12, color: compact ? colors.muted : colors.text }} numberOfLines={1}>
          {view.label}
        </Text>
      )}
    </View>
  );
}

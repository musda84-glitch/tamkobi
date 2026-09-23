import { Alert, Platform, Pressable, Text } from "react-native";
import { colors } from "../theme";
import { requestConfirm } from "../utils/confirmDialog";

export function Chip({
  label,
  active,
  onPress,
  testID,
  color,
  compact,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  color?: string;
  compact?: boolean;
}) {
  const bg = color || colors.primary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        flexShrink: 0,
        paddingVertical: compact ? 4 : 8,
        paddingHorizontal: compact ? 8 : 12,
        borderRadius: 999,
        backgroundColor: active ? bg : "#fff",
        borderWidth: 1,
        borderColor: active ? bg : colors.border,
      }}
    >
      <Text style={{ color: active ? "#fff" : colors.text, fontWeight: "700", fontSize: compact ? 11 : 12 }}>{label}</Text>
    </Pressable>
  );
}

export function confirmAction(title: string, msg: string, onYes: () => void, confirmLabel = "Tamam") {
  if (Platform.OS === "web") {
    void requestConfirm(title, msg, confirmLabel).then((ok) => {
      if (ok) onYes();
    });
    return;
  }
  Alert.alert(title, msg, [
    { text: "Vazgeç", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onYes },
  ]);
}

export function n(v: string): number {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

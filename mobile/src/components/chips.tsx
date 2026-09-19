import { Alert, Platform, Pressable, Text } from "react-native";
import { colors } from "../theme";

export function Chip({
  label,
  active,
  onPress,
  testID,
  color,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  color?: string;
}) {
  const bg = color || colors.primary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        flexShrink: 0,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 999,
        backgroundColor: active ? bg : "#fff",
        borderWidth: 1,
        borderColor: active ? bg : colors.border,
      }}
    >
      <Text style={{ color: active ? "#fff" : colors.text, fontWeight: "700", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

export function confirmAction(title: string, msg: string, onYes: () => void) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(msg)) onYes();
    return;
  }
  Alert.alert(title, msg, [
    { text: "Vazgeç", style: "cancel" },
    { text: "Tamam", style: "destructive", onPress: onYes },
  ]);
}

export function n(v: string): number {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

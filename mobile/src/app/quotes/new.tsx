import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { Text, View } from "react-native";
import { WorkFormScreen } from "@/screens/WorkFormScreen";
import { colors } from "@/theme";

export default function QuoteNew() {
  return (
    <>
      <Stack.Screen
        options={{
          title: "Yeni teklif",
          headerTitle: () => (
            <View testID="quote-new-header-title" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="create" size={22} color={colors.warning} />
              <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }}>Yeni teklif</Text>
            </View>
          ),
        }}
      />
      <WorkFormScreen kind="quote" />
    </>
  );
}

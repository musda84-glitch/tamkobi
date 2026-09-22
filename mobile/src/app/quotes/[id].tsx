import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { WorkFormScreen } from "@/screens/WorkFormScreen";
import { colors } from "@/theme";

export default function QuoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen
        options={{
          title: "Teklif",
          headerTitle: () => (
            <View testID="quote-header-title" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="create" size={22} color={colors.warning} />
              <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }}>Teklif</Text>
            </View>
          ),
        }}
      />
      <WorkFormScreen kind="quote" docId={id} />
    </>
  );
}

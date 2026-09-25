import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { Text, View } from "react-native";
import { headerBackOptions } from "@/components/StackHeader";
import { WorkListScreen } from "@/screens/WorkListScreen";
import { colors } from "@/theme";

export default function QuotesIndex() {
  return (
    <>
      <Stack.Screen
        options={{
          title: "Teklifler",
          ...headerBackOptions("/"),
          headerTitle: () => (
            <View testID="quotes-header-title" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="create" size={22} color={colors.warning} />
              <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }}>Teklifler</Text>
            </View>
          ),
        }}
      />
      <WorkListScreen kind="quote" />
    </>
  );
}

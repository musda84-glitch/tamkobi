import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { Text, View } from "react-native";
import { headerBackOptions } from "@/components/StackHeader";
import { WorkListScreen } from "@/screens/WorkListScreen";
import { colors } from "@/theme";

export default function SurveysIndex() {
  return (
    <>
      <Stack.Screen
        options={{
          title: "Keşifler",
          ...headerBackOptions("/"),
          headerTitle: () => (
            <View testID="surveys-header-title" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="construct" size={22} color="#0EA5E9" />
              <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }}>Keşifler</Text>
            </View>
          ),
        }}
      />
      <WorkListScreen kind="survey" />
    </>
  );
}

import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { Text, View } from "react-native";
import { WorkFormScreen } from "@/screens/WorkFormScreen";
import { colors } from "@/theme";

export default function SurveyNew() {
  return (
    <>
      <Stack.Screen
        options={{
          title: "Yeni keşif",
          headerTitle: () => (
            <View testID="survey-new-header-title" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="construct" size={22} color="#0EA5E9" />
              <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }}>Yeni keşif</Text>
            </View>
          ),
        }}
      />
      <WorkFormScreen kind="survey" />
    </>
  );
}

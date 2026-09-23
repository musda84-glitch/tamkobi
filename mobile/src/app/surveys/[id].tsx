import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { WorkFormScreen } from "@/screens/WorkFormScreen";
import { colors } from "@/theme";

export default function SurveyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen
        options={{
          title: "Keşif",
          headerTitle: () => (
            <View testID="survey-header-title" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="construct" size={22} color="#0EA5E9" />
              <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }}>Keşif</Text>
            </View>
          ),
        }}
      />
      <WorkFormScreen kind="survey" docId={id} />
    </>
  );
}

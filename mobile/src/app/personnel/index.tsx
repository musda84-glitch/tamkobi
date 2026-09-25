import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { Text, View } from "react-native";
import { headerBackOptions } from "@/components/StackHeader";
import { PersonnelScreen } from "@/screens/PersonnelScreen";
import { colors } from "@/theme";

export default function PersonnelIndex() {
  return (
    <>
      <Stack.Screen
        options={{
          title: "Personel & Bordro",
          ...headerBackOptions("/"),
          headerTitle: () => (
            <View testID="personnel-header-title" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="people" size={22} color={colors.indigo} />
              <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }}>Personel & Bordro</Text>
            </View>
          ),
        }}
      />
      <PersonnelScreen />
    </>
  );
}

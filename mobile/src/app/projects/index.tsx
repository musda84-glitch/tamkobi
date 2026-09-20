import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { Text, View } from "react-native";
import { WorkListScreen } from "@/screens/WorkListScreen";
import { colors } from "@/theme";

export default function ProjectsIndex() {
  return (
    <>
      <Stack.Screen
        options={{
          title: "Projeler",
          headerTitle: () => (
            <View testID="projects-header-title" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="briefcase" size={22} color={colors.indigo} />
              <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }}>Projeler</Text>
            </View>
          ),
        }}
      />
      <WorkListScreen kind="project" />
    </>
  );
}

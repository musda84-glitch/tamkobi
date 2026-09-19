import { PersonelimScreen } from "@/screens/PersonelimScreen";
import { Tabs } from "expo-router";
import { Text } from "react-native";

export default function PersonelimTab() {
  return (
    <>
      <Tabs.Screen
        options={{
          title: "Benim Sayfam",
          tabBarLabel: ({ color }) => (
            <Text testID="tab-benim-sayfam" style={{ color, fontSize: 9, fontWeight: "700", textAlign: "center" }}>
              Benim Sayfam
            </Text>
          ),
        }}
      />
      <PersonelimScreen />
    </>
  );
}

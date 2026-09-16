import { useAuth } from "@/auth/AuthContext";
import { colors } from "@/theme";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

export default function TabsLayout() {
  const { can, moduleOn } = useAuth();
  const show = (path: string) => can(path) && moduleOn(path);
  return (
    <Tabs
      screenOptions={{
        headerTitleStyle: { fontWeight: "800" },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontWeight: "700", fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Özet",
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="saha"
        options={{
          title: "Saha",
          href: show("/saha") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="phone-portrait" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="stok"
        options={{
          title: "Stok",
          href: show("/stock") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="barcode" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="mesai"
        options={{
          title: "Mesaim",
          href: show("/mesai") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="time" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="personelim"
        options={{
          title: "Personelim",
          href: show("/personelim") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="daha"
        options={{
          title: "Daha",
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

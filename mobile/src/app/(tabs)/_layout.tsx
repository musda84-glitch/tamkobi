import { useAuth } from "@/auth/AuthContext";
import { AccountMenu } from "@/components/AccountMenu";
import { HomeHeaderTitle } from "@/components/HomeHeaderTitle";
import { colors } from "@/theme";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Text } from "react-native";

function tabIconColor(color: unknown): string {
  return typeof color === "string" && color ? color : colors.muted;
}

export default function TabsLayout() {
  const { can, moduleOn, user, activeCompany } = useAuth();
  const show = (path: string) => can(path) && moduleOn(path);
  return (
    <Tabs
      screenOptions={{
        headerTitleStyle: { fontWeight: "800", color: colors.text },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        tabBarLabelStyle: { fontWeight: "700", fontSize: 10 },
        headerRight: () => <AccountMenu />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Özet",
          headerTitle: () => <HomeHeaderTitle name={user?.name} company={activeCompany?.name} />,
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" color={tabIconColor(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="saha"
        options={{
          title: "Saha",
          href: show("/saha") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="phone-portrait" color={tabIconColor(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="stok"
        options={{
          title: "Stok",
          href: show("/stock") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="barcode" color={tabIconColor(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="mesai"
        options={{
          title: "Mesaim",
          href: show("/mesai") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="time" color={tabIconColor(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="personelim"
        options={{
          title: "Benim Sayfam",
          tabBarLabel: ({ color }) => (
            <Text style={{ color, fontSize: 9, fontWeight: "700", textAlign: "center" }}>Benim Sayfam</Text>
          ),
          href: show("/personelim") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={tabIconColor(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="daha"
        options={{
          title: "Daha",
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" color={tabIconColor(color)} size={size} />,
        }}
      />
    </Tabs>
  );
}

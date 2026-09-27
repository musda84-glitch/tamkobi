import { useAuth } from "@/auth/AuthContext";
import { useBadges } from "@/auth/BadgeContext";
import { useMesaimGate } from "@/auth/MesaimGateContext";
import { AccountMenu } from "@/components/AccountMenu";
import { HomeHeaderTitle } from "@/components/HomeHeaderTitle";
import { MesaimHeaderTitle } from "@/components/MesaimHeaderTitle";
import { HeaderBack } from "@/components/StackHeader";
import { colors } from "@/theme";
import { typeface } from "@/theme/softFont";
import { resolveMediaUrl } from "@/utils/media";
import { showFinanceSubstituteTabs, showSelfPersonnelTabs } from "@/utils/permissions";
import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import { useEffect } from "react";
import { Text } from "react-native";

function tabIconColor(color: unknown): string {
  return typeof color === "string" && color ? color : colors.muted;
}

export default function TabsLayout() {
  const { can, moduleOn, user, activeCompany, license, baseUrl } = useAuth();
  const { unread } = useBadges();
  const { locked, ready } = useMesaimGate();
  const router = useRouter();
  const show = (path: string) => can(path) && moduleOn(path);
  const selfTabs = showSelfPersonnelTabs(user, license);
  const financeTabs = showFinanceSubstituteTabs(user);
  const homeBadge = unread > 99 ? "99+" : unread > 0 ? unread : undefined;
  const onlyMesaim = locked && selfTabs;

  useEffect(() => {
    if (!ready || !onlyMesaim) return;
    router.replace("/mesai");
  }, [onlyMesaim, ready, router]);

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerTitleStyle: { color: colors.text, ...typeface("800") },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        tabBarLabelStyle: { fontSize: 10, ...typeface("700") },
        headerRight: () => <AccountMenu />,
        headerBackVisible: false,
        headerLeft: onlyMesaim || route.name === "index" || route.name === "mesai"
          ? undefined
          : () => <HeaderBack fallback="/" />,
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Özet",
          href: onlyMesaim ? null : undefined,
          headerTitleAlign: "left",
          headerTitle: () => (
            <HomeHeaderTitle
              name={user?.name}
              company={activeCompany?.name}
              logoUrl={resolveMediaUrl(baseUrl, activeCompany?.logo_url)}
            />
          ),
          tabBarBadge: onlyMesaim ? undefined : homeBadge,
          tabBarBadgeStyle: { backgroundColor: colors.danger, color: "#fff", fontSize: 10, fontWeight: "800" },
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" color={tabIconColor(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="saha"
        options={{
          title: "Saha",
          href: onlyMesaim ? null : show("/saha") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="phone-portrait" color={tabIconColor(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="stok"
        options={{
          title: "Stok",
          href: onlyMesaim ? null : show("/stock") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="barcode" color={tabIconColor(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="mesai"
        options={{
          title: "Mesaim",
          headerTitleAlign: "left",
          headerTitle: () => <MesaimHeaderTitle />,
          href: selfTabs ? undefined : null,
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
          href: onlyMesaim ? null : selfTabs && show("/personelim") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={tabIconColor(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="kasa"
        options={{
          title: "Kasa & Banka",
          tabBarLabel: ({ color }) => (
            <Text style={{ color, fontSize: 9, fontWeight: "700", textAlign: "center" }}>Kasa & Banka</Text>
          ),
          href: onlyMesaim ? null : financeTabs && show("/banking") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" color={tabIconColor(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="cariler"
        options={{
          title: "Cariler",
          href: onlyMesaim ? null : financeTabs && show("/contacts") ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="people" color={tabIconColor(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="daha"
        options={{
          title: "Daha",
          href: onlyMesaim ? null : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" color={tabIconColor(color)} size={size} />,
        }}
      />
    </Tabs>
  );
}

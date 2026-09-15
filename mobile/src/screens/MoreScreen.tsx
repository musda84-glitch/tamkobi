import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Pressable, Text } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { Card, H1, Muted, Screen } from "../components/ui";
import { colors } from "../theme";

const LINKS = [
  { title: "Cariler", path: "/contacts", screen: "Contacts", icon: "people" as const },
  { title: "Faturalar", path: "/invoices", screen: "Invoices", icon: "document-text" as const },
  { title: "Siparişler", path: "/orders", screen: "Orders", icon: "cart" as const },
  { title: "Bildirimler", path: "/", screen: "Notifications", icon: "notifications" as const },
  { title: "Ayarlar", path: "/settings", screen: "Settings", icon: "settings" as const },
];

export function MoreScreen() {
  const { can, moduleOn, user, activeCompany, logout } = useAuth();
  const navigation = useNavigation<any>();
  return (
    <Screen>
      <H1>Daha fazla</H1>
      <Muted>{user?.email} · {activeCompany?.name}</Muted>
      {LINKS.filter((l) => l.path === "/" || l.path === "/settings" || (can(l.path) && moduleOn(l.path))).map((l) => (
        <Pressable key={l.screen} onPress={() => navigation.navigate(l.screen)} style={{ marginTop: 8 }}>
          <Card>
            <Ionicons name={l.icon} size={20} color={colors.primary} />
            <Text style={{ fontWeight: "800", color: colors.text, marginTop: 4 }}>{l.title}</Text>
          </Card>
        </Pressable>
      ))}
      <Pressable onPress={() => logout()} testID="logout-btn" style={{ marginTop: 16 }}>
        <Card>
          <Text style={{ fontWeight: "800", color: colors.danger }}>Çıkış yap</Text>
        </Card>
      </Pressable>
    </Screen>
  );
}

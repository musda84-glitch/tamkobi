import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { Card, H1, Muted, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { isMoreLinkVisible } from "../utils/permissions";

const LINKS = [
  { title: "Benim Sayfam", path: "/personelim", screen: "Personelim", icon: "person" as const },
  { title: "Personel & Bordro", path: "/personnel", screen: "Personnel", icon: "people-circle" as const },
  { title: "Cariler", path: "/contacts", screen: "Contacts", icon: "people" as const },
  { title: "Faturalar", path: "/invoices", screen: "Invoices", icon: "document-text" as const },
  { title: "Siparişler", path: "/orders", screen: "Orders", icon: "cart" as const },
  { title: "Depo Sevkiyat", path: "/sevk", screen: "Sevk", icon: "cube" as const },
  { title: "Kasa & Banka", path: "/banking", screen: "Banking", icon: "wallet" as const },
  { title: "Masraflar", path: "/expenses", screen: "Expenses", icon: "receipt" as const },
  { title: "Taksitler", path: "/installments", screen: "Installments", icon: "calendar" as const },
  { title: "Çek & Senet", path: "/cheques", screen: "Cheques", icon: "card" as const },
  { title: "Teklifler", path: "/quotes", screen: "Quotes", icon: "create" as const },
  { title: "Keşifler", path: "/surveys", screen: "Surveys", icon: "construct" as const },
  { title: "Projeler", path: "/projects", screen: "Projects", icon: "briefcase" as const },
  { title: "Bildirimler", path: "/", screen: "Notifications", icon: "notifications" as const },
  { title: "Ayarlar", path: "/settings", screen: "Settings", icon: "settings" as const },
];

export function MoreScreen() {
  const { user, license, activeCompany, logout } = useAuth();
  return (
    <Screen>
      <H1>Daha fazla</H1>
      <Muted>{user?.email} · {activeCompany?.name}</Muted>
      {LINKS.filter((l) => isMoreLinkVisible(l, user, license)).map((l) => (
        <Pressable key={l.screen} onPress={() => go(l.screen)} testID={`more-link-${l.screen}`} style={{ marginTop: 8 }}>
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

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { Screen } from "../components/kit";
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
  const links = LINKS.filter((l) => isMoreLinkVisible(l, user, license));
  return (
    <Screen padded={false}>
      <Text
        style={{ fontSize: 11, color: colors.muted, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }}
        numberOfLines={1}
      >
        {[user?.email, activeCompany?.name].filter(Boolean).join(" · ")}
      </Text>
      <View
        testID="more-menu-list"
        style={{
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        {links.map((l, i) => (
          <Pressable
            key={l.screen}
            onPress={() => go(l.screen)}
            testID={`more-link-${l.screen}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              minHeight: 40,
              paddingHorizontal: 16,
              borderTopWidth: i ? 1 : 0,
              borderTopColor: colors.slate100,
            }}
          >
            <Ionicons name={l.icon} size={16} color={colors.primary} style={{ width: 22 }} />
            <Text style={{ flex: 1, fontWeight: "600", color: colors.text, fontSize: 14 }}>{l.title}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.muted} />
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => logout()} testID="logout-btn" style={{ minHeight: 40, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontWeight: "700", color: colors.danger, fontSize: 13 }}>Çıkış yap</Text>
      </Pressable>
    </Screen>
  );
}

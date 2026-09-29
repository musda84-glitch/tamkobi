import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import {
  HOME_QUICK_HIDDEN_KEY,
  hiddenQuickTilesToRestore,
  parseHiddenTileIds,
  restoreQuickTile,
  serializeHiddenTileIds,
} from "../utils/homeQuickHidden";
import { isMoreLinkVisible } from "../utils/permissions";
import { QUICK_TONE_COLORS, visibleQuickTiles, type QuickTile } from "../utils/quickMenu";

const LINKS = [
  { title: "Benim Sayfam", path: "/personelim", screen: "Personelim", icon: "person" as const },
  { title: "Personel & Bordro", path: "/personnel", screen: "Personnel", icon: "people-circle" as const },
  { title: "Cariler", path: "/contacts", screen: "Contacts", icon: "people" as const },
  { title: "Faturalar", path: "/invoices", screen: "Invoices", icon: "document-text" as const },
  { title: "Gelen e-Faturalar", path: "/edoc-inbox", screen: "EdocInbox", icon: "file-tray" as const },
  { title: "Siparişler", path: "/orders", screen: "Orders", icon: "cart" as const },
  { title: "Depo Sevkiyat", path: "/sevk", screen: "Sevk", icon: "cube" as const },
  { title: "Araçlarım", path: "/vehicles", screen: "Vehicles", icon: "car" as const },
  { title: "Stok Sayımı", path: "/sayim", screen: "StockCount", icon: "clipboard" as const },
  { title: "Üretim Atölye", path: "/atolye", screen: "Atolye", icon: "build" as const },
  { title: "Üretim & Reçete (BOM)", path: "/production", screen: "Production", icon: "git-network" as const },
  { title: "Kasa & Banka", path: "/banking", screen: "Banking", icon: "wallet" as const },
  { title: "Tahsilat & Ödeme Yap", path: "/banking", screen: "Pay", icon: "cash" as const },
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
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const allowedTiles = useMemo(() => visibleQuickTiles(user, license).filter((t) => t.id !== "notifications"), [user, license]);
  const restoreTiles = useMemo(
    () => hiddenQuickTilesToRestore(allowedTiles, hiddenIds),
    [allowedTiles, hiddenIds],
  );

  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(HOME_QUICK_HIDDEN_KEY)
      .then((raw) => setHiddenIds(parseHiddenTileIds(raw)))
      .catch(() => setHiddenIds([]));
  }, []));

  const restoreTile = useCallback(async (tile: QuickTile) => {
    const next = restoreQuickTile(hiddenIds, tile.id);
    setHiddenIds(next);
    await AsyncStorage.setItem(HOME_QUICK_HIDDEN_KEY, serializeHiddenTileIds(next)).catch(() => null);
  }, [hiddenIds]);

  return (
    <Screen padded={false}>
      <Text
        style={{ fontSize: 11, color: colors.muted, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }}
        numberOfLines={1}
      >
        {[user?.email, activeCompany?.name].filter(Boolean).join(" · ")}
      </Text>
      {restoreTiles.length ? (
        <View style={{ marginBottom: 10 }} testID="more-restore-quick">
          <Text
            style={{
              fontSize: 11,
              fontWeight: "800",
              color: colors.muted,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              paddingHorizontal: 16,
              paddingBottom: 6,
            }}
          >
            Ana ekrana ekle
          </Text>
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: colors.border,
            }}
          >
            {restoreTiles.map((tile, i) => {
              const tone = QUICK_TONE_COLORS[tile.tone] || QUICK_TONE_COLORS.slate;
              return (
                <Pressable
                  key={tile.id}
                  onPress={() => { void restoreTile(tile); }}
                  testID={`more-restore-${tile.id}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: 44,
                    paddingHorizontal: 16,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: colors.slate100,
                    gap: 10,
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      backgroundColor: tone.solid,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name={tile.icon as keyof typeof Ionicons.glyphMap} size={15} color="#fff" />
                  </View>
                  <Text style={{ flex: 1, fontWeight: "700", color: colors.text, fontSize: 14 }}>{tile.label}</Text>
                  <Text style={{ fontWeight: "800", color: colors.primary, fontSize: 12 }}>Ekle</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ fontSize: 11, color: colors.muted, paddingHorizontal: 16, paddingTop: 6 }}>
            Gizlenen karolar burada. Ana ekranda basılı tutarak tekrar gizleyebilirsiniz.
          </Text>
        </View>
      ) : null}
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

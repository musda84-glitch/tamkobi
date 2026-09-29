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
  HOME_QUICK_EXTRA_KEY,
  HOME_QUICK_HIDDEN_KEY,
  MORE_SCREEN_TO_TILE,
  addExtraTile,
  isTileOnHome,
  parseExtraTileIds,
  parseHiddenTileIds,
  restoreQuickTile,
  serializeExtraTileIds,
  serializeHiddenTileIds,
} from "../utils/homeQuickHidden";
import { isMoreLinkVisible } from "../utils/permissions";
import { visibleQuickTiles, type QuickTile } from "../utils/quickMenu";

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
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const tileById = useMemo(() => {
    const map = new Map<string, QuickTile>();
    for (const t of visibleQuickTiles(user, license)) map.set(t.id, t);
    return map;
  }, [user, license]);

  useFocusEffect(useCallback(() => {
    Promise.all([
      AsyncStorage.getItem(HOME_QUICK_HIDDEN_KEY).catch(() => null),
      AsyncStorage.getItem(HOME_QUICK_EXTRA_KEY).catch(() => null),
    ]).then(([hiddenRaw, extraRaw]) => {
      setHiddenIds(parseHiddenTileIds(hiddenRaw));
      setExtraIds(parseExtraTileIds(extraRaw));
    });
  }, []));

  const addToHome = useCallback(async (tile: QuickTile) => {
    if (tile.optIn) {
      const nextExtras = addExtraTile(extraIds, tile.id);
      setExtraIds(nextExtras);
      await AsyncStorage.setItem(HOME_QUICK_EXTRA_KEY, serializeExtraTileIds(nextExtras)).catch(() => null);
      return;
    }
    const nextHidden = restoreQuickTile(hiddenIds, tile.id);
    setHiddenIds(nextHidden);
    await AsyncStorage.setItem(HOME_QUICK_HIDDEN_KEY, serializeHiddenTileIds(nextHidden)).catch(() => null);
  }, [extraIds, hiddenIds]);

  const addableCount = links.filter((l) => {
    const tid = MORE_SCREEN_TO_TILE[l.screen];
    const tile = tid ? tileById.get(tid) : null;
    return tile && !isTileOnHome(tile, hiddenIds, extraIds);
  }).length;

  return (
    <Screen padded={false}>
      <Text
        style={{ fontSize: 11, color: colors.muted, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }}
        numberOfLines={2}
      >
        {[user?.email, activeCompany?.name].filter(Boolean).join(" · ")}
        {addableCount ? `\nAna ekranda olmayanlar → sağdaki Ekle` : ""}
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
        {links.map((l, i) => {
          const tileId = MORE_SCREEN_TO_TILE[l.screen];
          const tile = tileId ? tileById.get(tileId) : undefined;
          const canAdd = !!tile && !isTileOnHome(tile, hiddenIds, extraIds);
          return (
            <Pressable
              key={l.screen}
              onPress={() => go(l.screen)}
              testID={`more-link-${l.screen}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                minHeight: 44,
                paddingHorizontal: 16,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: colors.slate100,
                gap: 8,
              }}
            >
              <Ionicons name={l.icon} size={16} color={colors.primary} style={{ width: 22 }} />
              <Text style={{ flex: 1, fontWeight: "600", color: colors.text, fontSize: 14 }}>{l.title}</Text>
              {canAdd ? (
                <Pressable
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    void addToHome(tile!);
                  }}
                  hitSlop={8}
                  testID={`more-add-home-${l.screen}`}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 8,
                    backgroundColor: "#ECFDF5",
                    borderWidth: 1,
                    borderColor: "#A7F3D0",
                  }}
                >
                  <Text style={{ fontWeight: "800", color: colors.primary, fontSize: 12 }}>Ekle</Text>
                </Pressable>
              ) : (
                <Ionicons name="chevron-forward" size={14} color={colors.muted} />
              )}
            </Pressable>
          );
        })}
      </View>
      <Pressable onPress={() => logout()} testID="logout-btn" style={{ minHeight: 40, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontWeight: "700", color: colors.danger, fontSize: 13 }}>Çıkış yap</Text>
      </Pressable>
    </Screen>
  );
}

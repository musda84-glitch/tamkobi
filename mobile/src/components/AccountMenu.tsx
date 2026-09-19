import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { go } from "../nav";
import { colors, radius } from "../theme";
import { idOf } from "../utils/money";
import { hasSelfPersonnelRecord } from "../utils/permissions";
import { confirmAction } from "./chips";

type MenuItem = {
  key: string;
  label: string;
  hint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  onPress: () => void;
};

function Item({ item, onDone }: { item: MenuItem; onDone: () => void }) {
  return (
    <Pressable
      testID={`account-menu-${item.key}`}
      onPress={() => { onDone(); item.onPress(); }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: 4,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={item.icon} size={18} color={item.danger ? colors.danger : colors.muted} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "700", color: item.danger ? colors.danger : colors.text, fontSize: 14 }}>{item.label}</Text>
        {item.hint ? <Text style={{ color: colors.muted, fontSize: 11 }}>{item.hint}</Text> : null}
      </View>
      {!item.danger ? <Ionicons name="chevron-forward" size={16} color={colors.muted} /> : null}
    </Pressable>
  );
}

/** Başlıktaki "..." düğmesi: hesap, şirket seçimi ve oturum işlemleri. */
export function AccountMenu() {
  const { user, activeCompany, companies, switchCompany, logout, can, moduleOn } = useAuth();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const items: MenuItem[] = [
    ...(hasSelfPersonnelRecord(user) && can("/personelim") && moduleOn("/personelim")
      ? [{ key: "personelim", label: "Benim Sayfam", icon: "person-circle" as const, onPress: () => go("Personelim") }]
      : []),
    { key: "notifications", label: "Bildirimler", icon: "notifications", onPress: () => go("Notifications") },
    { key: "search", label: "Ara", icon: "search", onPress: () => go("Search") },
    { key: "settings", label: "Ayarlar", hint: "Şifre yenile", icon: "settings", onPress: () => go("Settings") },
  ];

  return (
    <>
      <Pressable testID="account-menu-btn" onPress={() => setOpen(true)} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
        <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable onPress={close} style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.35)" }}>
          <Pressable
            testID="account-menu-sheet"
            onPress={(e) => e.stopPropagation()}
            style={{
              marginTop: 64,
              marginHorizontal: 12,
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 14,
              maxHeight: "80%",
            }}
          >
            <ScrollView>
              <Text style={{ fontWeight: "800", color: colors.text, fontSize: 16 }}>{user?.name || "Hesabım"}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {[user?.email, user?.role_name || user?.role].filter(Boolean).join(" · ")}
              </Text>

              {companies.length ? (
                <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase" }}>Şirket</Text>
                  {companies.map((c) => {
                    const id = idOf(c);
                    const active = id === idOf(activeCompany);
                    return (
                      <Pressable
                        key={id}
                        testID={`account-company-${id}`}
                        onPress={() => { close(); if (!active) switchCompany(id); }}
                        style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 }}
                      >
                        <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={16} color={active ? colors.primary : colors.muted} />
                        <Text style={{ flex: 1, fontWeight: active ? "800" : "600", color: active ? colors.primary : colors.text, fontSize: 14 }}>
                          {c.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                {items.map((item) => <Item key={item.key} item={item} onDone={close} />)}
                <Item
                  item={{
                    key: "logout",
                    label: "Çıkış yap",
                    icon: "log-out",
                    danger: true,
                    onPress: () => confirmAction("Çıkış", "Oturumu kapatmak istiyor musunuz?", () => { logout(); }),
                  }}
                  onDone={close}
                />
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

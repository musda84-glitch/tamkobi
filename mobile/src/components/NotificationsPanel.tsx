import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { colors } from "../theme";
import type { Notification } from "../types";
import { idOf } from "../utils/money";
import {
  notificationAge,
  notificationCanDelete,
  notificationLook,
  notificationText,
  notificationTitle,
  type NotificationLook,
} from "../utils/notifications";
import { QUICK_TONE_COLORS } from "../utils/quickMenu";
import { SwipeRevealRow } from "./SwipeRevealRow";

/**
 * Hızlı menüde dört kutucukluk yeri kaplayan geniş bildirim kartı:
 * başlıkta okunmamış sayısı, altında son bildirimler.
 */
export function NotificationsPanel({
  items,
  unread,
  onOpenAll,
  onOpenItem,
  onDeleteItem,
}: {
  items: Notification[];
  unread: number;
  onOpenAll: () => void;
  onOpenItem: (n: Notification) => void;
  onDeleteItem?: (n: Notification) => void;
}) {
  const tone = QUICK_TONE_COLORS.rose;
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <View
      testID="home-notifications-panel"
      style={{
        backgroundColor: tone.bg,
        borderWidth: 1,
        borderColor: tone.border,
        borderRadius: 20,
        padding: 10,
        gap: 6,
        ...Platform.select({
          web: { boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)" },
          default: {
            shadowColor: "#0F172A",
            shadowOpacity: 0.06,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 1,
          },
        }),
      }}
    >
      <Pressable
        testID="home-notifications-all"
        onPress={onOpenAll}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, opacity: pressed ? 0.7 : 1 })}
      >
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 10,
            backgroundColor: tone.solid,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="notifications" size={16} color="#fff" />
        </View>
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13, flex: 1 }}>Bildirimler</Text>
        {unread ? (
          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.danger }}>
            <Text testID="home-notifications-unread" style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>
              {unread} yeni
            </Text>
          </View>
        ) : null}
        <Text style={{ color: tone.fg, fontSize: 11, fontWeight: "800" }}>Tümü</Text>
        <Ionicons name="chevron-forward" size={14} color={tone.fg} />
      </Pressable>

      {!items.length ? (
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: "center" }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Yeni bildirim yok.</Text>
        </View>
      ) : (
        items.map((n) => {
          const key = idOf(n) || n.created_at || notificationTitle(n);
          const row = <NotificationRow item={n} onPress={() => onOpenItem(n)} />;
          if (!onDeleteItem || !notificationCanDelete(n)) {
            return <React.Fragment key={key}>{row}</React.Fragment>;
          }
          return (
            <SwipeRevealRow
              key={key}
              rowKey={key}
              openKey={openKey}
              onOpen={setOpenKey}
              onPress={() => onOpenItem(n)}
              onDelete={() => onDeleteItem(n)}
              testID={`home-notification-${idOf(n)}`}
            >
              <NotificationRow item={n} bare />
            </SwipeRevealRow>
          );
        })
      )}
    </View>
  );
}

function NotificationRow({ item, onPress, bare }: { item: Notification; onPress?: () => void; bare?: boolean }) {
  const look: NotificationLook = notificationLook(item);
  const lookTone = QUICK_TONE_COLORS[look.tone];
  const body = notificationText(item);
  const age = notificationAge(item.created_at);
  return (
    <Pressable
      testID={bare ? undefined : `home-notification-${idOf(item)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.surface,
        borderRadius: 14,
        paddingVertical: 7,
        paddingHorizontal: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        opacity: pressed ? 0.75 : item.is_read ? 0.72 : 1,
      })}
    >
      <Ionicons name={look.icon} size={18} color={lookTone.solid} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 12 }} numberOfLines={1}>
          {notificationTitle(item)}
        </Text>
        {body ? (
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
            {body}
          </Text>
        ) : null}
      </View>
      {age ? <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "700" }}>{age}</Text> : null}
      {!item.is_read ? (
        <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: colors.danger }} />
      ) : null}
    </Pressable>
  );
}

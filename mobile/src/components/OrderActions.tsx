import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { colors } from "../theme";
import type { Order } from "../types";
import { idOf } from "../utils/money";
import { printCargoLabel, printOrderForm } from "../utils/orderShare";
import { QUICK_TONE_COLORS, type QuickTone } from "../utils/quickMenu";
import { ActionTiles, type ActionTile } from "./ActionTiles";
import { confirmAction } from "./chips";
import { Muted } from "./kit";

type ActionDef = {
  key: string;
  label: string;
  icon: ActionTile["icon"];
  tone: QuickTone;
  busyKey: string;
  testID: string;
  onPress: () => void;
};

function ActionPills({ items, busy }: { items: ActionDef[]; busy: string | null }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 4, paddingBottom: 8 }}>
      {items.map((item) => {
        const tone = QUICK_TONE_COLORS[item.tone];
        const waiting = busy === item.busyKey;
        return (
          <Pressable
            key={item.key}
            testID={item.testID}
            onPress={item.onPress}
            disabled={!!busy}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: tone.border,
              backgroundColor: tone.bg,
              opacity: busy && !waiting ? 0.45 : pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name={waiting ? "hourglass-outline" : item.icon} size={13} color={tone.solid} />
            <Text style={{ fontWeight: "800", fontSize: 11, color: colors.text }}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function OrderActions({
  order,
  size = "xs",
  compact = false,
  onMessage,
  onError,
}: {
  order: Order;
  size?: "xs" | "sm";
  compact?: boolean;
  onMessage?: (text: string) => void;
  onError?: (text: string) => void;
}) {
  const { client, activeCompany, can } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const canProduce = can("/production", "edit") || can("/sevk", "edit") || can("/orders", "edit");

  const ensure = async () => {
    if (order.items?.length) return order;
    return get<Order>(client, `/orders/${idOf(order)}`);
  };

  const printForm = async () => {
    setBusy("print");
    try {
      await printOrderForm(await ensure(), activeCompany);
      onMessage?.("Sipariş formu yazdırmaya gönderildi.");
    } catch (err) {
      onError?.(apiErrorMessage(err, "Yazdırılamadı."));
    } finally {
      setBusy(null);
    }
  };

  const printLabel = async () => {
    setBusy("label");
    try {
      const full = await get<Order>(client, `/orders/${idOf(order)}`);
      const kind = await printCargoLabel(full, activeCompany, client);
      post(client, "/orders/mark-labels-printed", { ids: [idOf(full)] }).catch(() => null);
      onMessage?.(kind === "official"
        ? "Pazaryeri / kargo etiketi yazdırmaya gönderildi."
        : "Kargo etiketi yazdırmaya gönderildi.");
    } catch (err) {
      onError?.(apiErrorMessage(err, "Etiket yazdırılamadı."));
    } finally {
      setBusy(null);
    }
  };

  const toProduction = () => {
    confirmAction(
      "Üretim emri",
      `${order.order_number || "Sipariş"} için eksik kalemler üretime alınsın mı?`,
      async () => {
        setBusy("prod");
        try {
          const r = await post<{ message?: string }>(client, `/order-picks/${idOf(order)}/to-production`, {});
          onMessage?.(r.message || "Üretim emri açıldı.");
        } catch (err) {
          onError?.(apiErrorMessage(err, "Üretim emri açılamadı."));
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const defs: ActionDef[] = [
    { key: "print", label: "Yazdır", icon: "print", tone: "slate", busyKey: "print", testID: `order-print-${idOf(order)}`, onPress: printForm },
    { key: "label", label: "Kargo etiketi", icon: "pricetag", tone: "teal", busyKey: "label", testID: `order-label-${idOf(order)}`, onPress: printLabel },
    ...(canProduce
      ? [{ key: "prod", label: "Üretim emri", icon: "construct" as const, tone: "orange" as const, busyKey: "prod", testID: `order-prod-${idOf(order)}`, onPress: toProduction }]
      : []),
  ];

  if (compact) {
    return (
      <>
        <ActionPills items={defs} busy={busy} />
        {busy ? <Muted>Hazırlanıyor…</Muted> : null}
      </>
    );
  }

  const items: ActionTile[] = defs.map((d) => ({
    key: d.key,
    label: d.label,
    icon: d.icon,
    tone: d.tone,
    busy: busy === d.busyKey,
    testID: d.testID,
    onPress: d.onPress,
  }));

  return (
    <>
      <ActionTiles items={items} columns={3} size={size} />
      {busy ? <Muted>Hazırlanıyor…</Muted> : null}
    </>
  );
}

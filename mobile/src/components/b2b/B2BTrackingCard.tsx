import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { colors } from "../../theme";
import type { Order } from "../../types";
import { trackingLabel } from "../../utils/b2bOrders";
import { fmtDate } from "../../utils/money";

export function B2BTrackingCard({ tracking, orderNumber }: { tracking?: Order["tracking"]; orderNumber?: string }) {
  if (!tracking) {
    return <Text style={{ color: colors.muted, fontSize: 12 }}>Kargo bekleniyor</Text>;
  }
  const done = tracking.status === "delivered";
  const late = !!tracking.is_late && !done;
  const fg = done ? colors.primaryHover : late ? colors.danger : "#0369A1";
  const bg = done ? colors.emerald50 : late ? colors.rose50 : "#E0F2FE";
  const steps = tracking.steps || [];
  return (
    <View testID={`b2b-tracking-${orderNumber}`} style={{ backgroundColor: bg, borderRadius: 12, padding: 10, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ color: fg, fontWeight: "800", fontSize: 12, flex: 1 }}>
          {trackingLabel(tracking.status)}{tracking.carrier ? ` · ${tracking.carrier}` : ""}
        </Text>
        {tracking.tracking_number ? (
          tracking.tracking_url ? (
            <Pressable testID={`b2b-tracking-link-${orderNumber}`} onPress={() => Linking.openURL(String(tracking.tracking_url))}>
              <Text style={{ color: colors.indigo, fontWeight: "800", fontSize: 12 }}>{tracking.tracking_number}</Text>
            </Pressable>
          ) : (
            <Text style={{ fontWeight: "800", fontSize: 12 }}>{tracking.tracking_number}</Text>
          )
        ) : null}
      </View>
      {steps.length ? (
        <View style={{ flexDirection: "row", gap: 4 }}>
          {steps.map((s, i) => (
            <View key={s} style={{ flex: 1, height: 5, borderRadius: 99, backgroundColor: i <= (tracking.step ?? -1) ? (done ? colors.primary : "#0EA5E9") : colors.slate200 }} />
          ))}
        </View>
      ) : null}
      {done ? (
        <Text style={{ color: colors.muted, fontSize: 11 }}>Teslim: {fmtDate((tracking.delivered_at || "").slice(0, 10))}</Text>
      ) : tracking.estimated_delivery ? (
        <Text style={{ color: late ? colors.danger : colors.muted, fontSize: 11 }}>
          <Ionicons name="time-outline" size={12} color={late ? colors.danger : colors.muted} /> Tahmini teslim {fmtDate(tracking.estimated_delivery)}{late ? " (gecikti)" : ""}
        </Text>
      ) : null}
    </View>
  );
}

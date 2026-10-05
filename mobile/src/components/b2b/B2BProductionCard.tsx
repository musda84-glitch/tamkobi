import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";
import { colors } from "../../theme";
import type { Order } from "../../types";

type Prod = NonNullable<Order["production"]>;

export function B2BProductionCard({ production, orderNumber }: { production: Prod; orderNumber?: string }) {
  const doneAll = production.status === "completed" || (Number(production.total) > 0 && Number(production.done) >= Number(production.total));
  const fg = doneAll ? colors.primaryHover : "#92400E";
  const bg = doneAll ? colors.emerald50 : "#FFFBEB";
  const steps = production.steps || [];
  return (
    <View testID={`b2b-production-${orderNumber}`} style={{ backgroundColor: bg, borderRadius: 12, padding: 10, gap: 6, borderWidth: 1, borderColor: doneAll ? "#A7F3D0" : "#FDE68A" }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ color: fg, fontWeight: "800", fontSize: 12, flex: 1 }}>
          <Ionicons name="construct-outline" size={14} color={fg} /> {production.status_label || "Üretimde"}
          {production.product_name ? ` · ${production.product_name}` : ""}
        </Text>
        {Number(production.total) > 0 ? (
          <Text testID={`b2b-production-progress-${orderNumber}`} style={{ color: colors.muted, fontWeight: "700", fontSize: 11 }}>
            {production.done}/{production.total}
          </Text>
        ) : null}
      </View>
      {steps.length ? (
        <View style={{ flexDirection: "row", gap: 4 }}>
          {steps.map((s) => (
            <View
              key={`${s.no}-${s.name}`}
              style={{ flex: 1, height: 5, borderRadius: 99, backgroundColor: s.done ? colors.primary : s.current ? "#F59E0B" : colors.slate200 }}
            />
          ))}
        </View>
      ) : null}
      {steps.map((s) => (
        <Text
          key={`${s.no}-${s.name}`}
          testID={`b2b-production-step-${orderNumber}-${s.no}`}
          style={{ color: s.done ? colors.primaryHover : s.current ? "#92400E" : colors.muted, fontSize: 11, fontWeight: s.current ? "700" : "500" }}
        >
          {s.done ? "✓ " : s.current ? "● " : "○ "}
          {s.no}. {s.name}{s.station ? ` · ${s.station}` : ""}
        </Text>
      ))}
      {production.current_step_name && !doneAll ? (
        <Text style={{ color: "#92400E", fontSize: 11 }}>Şu an: {production.current_step_name}</Text>
      ) : null}
    </View>
  );
}

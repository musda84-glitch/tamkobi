import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "../theme";
import { categoryIcon, expenseVendorName } from "../utils/expenseDisplay";
import type { Expense } from "../utils/finance";
import { fmtDate, fmtMoney, idOf } from "../utils/money";

function payBadge(status?: string | null): { label: string; color: string; bg: string } {
  if (status === "paid") return { label: "Ödendi", color: colors.success, bg: colors.emerald100 };
  if (status === "partially_paid") return { label: "Kısmi Ödendi", color: colors.warning, bg: colors.amber50 };
  return { label: "Ödenmedi", color: colors.warning, bg: colors.amber50 };
}

export function ExpenseCard({ expense, onPress }: { expense: Expense; onPress: () => void }) {
  const id = idOf(expense);
  const badge = payBadge(expense.payment_status);
  const subtitle = [expense.expense_number || "—", expense.category || "—", fmtDate(expense.date)].join(" · ");
  return (
    <Pressable
      testID={`exp-row-${id}`}
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 12,
        minHeight: 72,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.indigo50,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={categoryIcon(expense.category) as keyof typeof Ionicons.glyphMap} size={18} color={colors.indigo} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text testID={`exp-row-${id}-vendor`} numberOfLines={1} style={{ fontWeight: "800", fontSize: 15, color: colors.text }}>
          {expenseVendorName(expense)}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>{subtitle}</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4, flexShrink: 0, maxWidth: 120 }}>
        <Text testID={`exp-row-${id}-amount`} numberOfLines={1} style={{ fontWeight: "800", fontSize: 14, color: colors.text }}>
          {fmtMoney(expense.total, expense.currency)}
        </Text>
        <View style={{ borderRadius: 999, backgroundColor: badge.bg, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text testID={`exp-row-${id}-badge`} style={{ color: badge.color, fontSize: 10, fontWeight: "800" }}>{badge.label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewProps,
} from "react-native";
import { publicErrorMessage } from "../api/errors";
import { colors, radius, spacing } from "../theme";
import { trUpper } from "../utils/labels";
import { ProductThumb } from "./ProductThumb";

export function Screen({ children, onRefresh, refreshing, padded = true }: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  padded?: boolean;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, padded && styles.padded, { paddingBottom: 40 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, ...rest }: ViewProps) {
  return <View style={[styles.card, style]} {...rest}>{children}</View>;
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}

export function Muted({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return <Text testID={testID} style={styles.muted}>{children}</Text>;
}

export function Row({ children, style }: ViewProps) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Badge({ label, tone = "slate" }: { label: string; tone?: "slate" | "green" | "red" | "amber" | "indigo" }) {
  const bg = { slate: colors.slate100, green: colors.emerald100, red: colors.rose50, amber: colors.amber50, indigo: colors.indigo50 }[tone];
  const fg = { slate: "#334155", green: colors.primaryHover, red: "#BE123C", amber: "#B45309", indigo: "#3730A3" }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  color = colors.secondary,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  color?: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.btn, { backgroundColor: color, opacity: disabled ? 0.5 : 1 }]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{title}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string; testID?: string; compact?: boolean; dense?: boolean }) {
  const { label, style, compact, dense, ...rest } = props;
  return (
    <View style={{ marginBottom: compact || dense ? 0 : spacing.md }}>
      <Text style={[styles.label, dense && styles.labelDense]}>{trUpper(label)}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, compact && styles.inputCompact, dense && styles.inputDense, style]}
        {...rest}
      />
    </View>
  );
}

export function Empty({ icon, title, hint }: { icon: keyof typeof Ionicons.glyphMap; title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={36} color={colors.muted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </View>
  );
}

export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.error}>
      <Text style={styles.errorText}>{publicErrorMessage(message)}</Text>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  rightColor,
  rightSub,
  rightSubColor,
  rightTestID,
  leading,
  image,
  badge,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string;
  right?: string;
  rightColor?: string;
  rightSub?: string;
  rightSubColor?: string;
  rightTestID?: string;
  leading?: React.ReactNode;
  image?: string;
  badge?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.listRow} disabled={!onPress}>
      {leading || image != null ? (
        <View style={{ flexShrink: 0 }}>{leading || <ProductThumb uri={image || ""} size={56} />}</View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.listTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.muted} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {badge}
      {right || rightSub ? (
        <View style={{ alignItems: "flex-end", marginLeft: 8, minWidth: 88, maxWidth: 168 }}>
          {right ? <Text testID={rightTestID} style={[styles.listRight, rightColor ? { color: rightColor } : null]} numberOfLines={1}>{right}</Text> : null}
          {rightSub ? <Text style={[styles.muted, { fontWeight: "700", color: rightSubColor || colors.muted }]} numberOfLines={1}>{rightSub}</Text> : null}
        </View>
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </Pressable>
  );
}

export type StatRow = { key: string; label: string; value: string; hint?: string; valueColor?: string };

/** Kart yığını yerine ince satırlar: solda etiket, sağda tutar. */
export function StatRows({ items, testID }: { items: StatRow[]; testID?: string }) {
  return (
    <View style={[styles.card, { gap: 0 }]} testID={testID}>
      {items.map((item, i) => (
        <View key={item.key} style={[styles.statRow, i > 0 ? styles.statDivider : null]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.statLabel}>{trUpper(item.label)}</Text>
            {item.hint ? <Text style={styles.statHint} numberOfLines={1}>{item.hint}</Text> : null}
          </View>
          <Text style={[styles.statValue, item.valueColor ? { color: item.valueColor } : null]}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{trUpper(label)}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      {sub ? <Text style={styles.muted}>{sub}</Text> : null}
    </View>
  );
}

/** Minimal düzen: dar boşluklar, ince çerçeveler; dokunma hedefleri 44 px altına inmez. */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1 },
  padded: { padding: spacing.sm + 4, gap: spacing.sm + 2 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    gap: 6,
  },
  h1: { fontSize: 19, fontWeight: "800", color: colors.text },
  muted: { color: colors.muted, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  btn: { borderRadius: radius.md, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  label: { fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 4 },
  labelDense: { fontSize: 10, marginBottom: 2 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 15,
    color: colors.text,
    backgroundColor: "#fff",
  },
  inputCompact: {
    minHeight: 40,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
  },
  inputDense: {
    minHeight: 30,
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontSize: 13,
  },
  empty: { alignItems: "center", paddingVertical: 24, gap: 6 },
  emptyTitle: { fontWeight: "700", color: colors.text },
  error: { backgroundColor: colors.rose50, borderRadius: radius.md, padding: 10 },
  errorText: { color: "#BE123C", fontWeight: "600", fontSize: 13 },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    minHeight: 76,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listTitle: { fontWeight: "700", color: colors.text, fontSize: 14 },
  listRight: { fontWeight: "800", color: colors.text, marginLeft: 8, fontSize: 14 },
  statRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  statDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  statLabel: { fontSize: 11, fontWeight: "700", color: colors.muted },
  statHint: { fontSize: 11, color: colors.muted, marginTop: 1 },
  statValue: { fontSize: 15, fontWeight: "800", color: colors.text },
  kpi: { flex: 1, minWidth: 140, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 },
  kpiLabel: { fontSize: 10, fontWeight: "700", color: colors.muted },
  kpiValue: { fontSize: 16, fontWeight: "800", color: colors.text, marginTop: 2 },
});

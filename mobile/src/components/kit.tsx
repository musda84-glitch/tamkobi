import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
import { colors, radius, spacing, typeface } from "../theme";
import { fieldUsesDatePicker, fieldUsesMonthPicker, fieldUsesTimePicker } from "../utils/fieldKind";
import { contentBottomPad, SCREEN_BASE_PAD } from "../utils/keyboardPad";
import { useKeyboardAwareScroll } from "../utils/useKeyboardAwareScroll";
import { trUpper } from "../utils/labels";
import { listRowText, isListRowNode } from "../utils/listRow";
import { DateField } from "./DateField";
import { MonthField } from "./MonthField";
import { ProductThumb } from "./ProductThumb";
import { TimeField } from "./TimeField";

export function Screen({ children, stickyTop, stickyBottom, onRefresh, refreshing, padded = true, stickyCompact = false }: {
  children: React.ReactNode;
  stickyTop?: React.ReactNode;
  stickyBottom?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  padded?: boolean;
  stickyCompact?: boolean;
}) {
  const { keyboardHeight, scrollRef, scrollProps } = useKeyboardAwareScroll();
  const bottom = contentBottomPad(SCREEN_BASE_PAD, keyboardHeight, Platform.OS);
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {stickyTop ? (
        <View
          testID="screen-sticky-top"
          style={[
            styles.stickyTop,
            padded && (stickyCompact ? styles.stickyPadCompact : styles.stickyPad),
            stickyCompact ? { gap: 4 } : null,
            Platform.OS === "web" ? { position: "sticky" as const, top: 0 } : null,
          ]}
        >
          {stickyTop}
        </View>
      ) : null}
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.content, padded && styles.padded, { paddingBottom: bottom }]}
        {...scrollProps}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
      >
        {children}
      </ScrollView>
      {stickyBottom ? <View style={[styles.stickyBottom, padded && styles.stickyPadBottom]}>{stickyBottom}</View> : null}
    </KeyboardAvoidingView>
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
  icon,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  color?: string;
  testID?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityLabel={title}
      style={[styles.btn, icon ? styles.btnIcon : null, { backgroundColor: color, opacity: disabled ? 0.5 : 1 }]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : icon ? (
        <Ionicons name={icon} size={18} color="#fff" />
      ) : (
        <Text style={styles.btnText}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string; testID?: string; compact?: boolean; dense?: boolean; suffix?: string }) {
  const { label, style, compact, dense, suffix, ...rest } = props;
  if (fieldUsesMonthPicker(props.testID, label, typeof props.placeholder === "string" ? props.placeholder : undefined)) {
    return (
      <MonthField
        label={label}
        value={String(props.value ?? "")}
        onChangeText={props.onChangeText || (() => { /* no-op */ })}
        testID={props.testID}
        editable={props.editable !== false}
        dense={dense}
      />
    );
  }
  if (fieldUsesDatePicker(props.testID, typeof props.placeholder === "string" ? props.placeholder : undefined)) {
    return (
      <DateField
        label={label}
        value={String(props.value ?? "")}
        onChangeText={props.onChangeText || (() => { /* no-op */ })}
        testID={props.testID}
        editable={props.editable !== false}
      />
    );
  }
  if (fieldUsesTimePicker(props.testID, label, typeof props.placeholder === "string" ? props.placeholder : undefined)) {
    return (
      <TimeField
        label={label}
        value={String(props.value ?? "")}
        onChangeText={props.onChangeText || (() => { /* no-op */ })}
        testID={props.testID}
      />
    );
  }
  return (
    <View style={{ marginBottom: compact || dense ? 0 : spacing.md }}>
      <Text style={[styles.label, dense && styles.labelDense]}>{trUpper(label)}</Text>
      {suffix ? (
        <View style={[styles.input, styles.inputSuffixRow, compact && styles.inputCompact, dense && styles.inputDense]}>
          <TextInput
            placeholderTextColor={colors.muted}
            style={[styles.inputBare, compact && styles.inputCompact, dense && styles.inputDense, style]}
            {...rest}
          />
          <Text testID={rest.testID ? `${rest.testID}-currency` : undefined} style={styles.inputSuffix}>{suffix}</Text>
        </View>
      ) : (
        <TextInput
          placeholderTextColor={colors.muted}
          style={[styles.input, compact && styles.inputCompact, dense && styles.inputDense, style]}
          {...rest}
        />
      )}
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
  titleColor,
  titleLines = 1,
  compactRight,
  onPress,
  showChevron,
  action,
  testID,
}: {
  title: React.ReactNode;
  subtitle?: string;
  right?: string;
  rightColor?: string;
  rightSub?: string;
  rightSubColor?: string;
  rightTestID?: string;
  leading?: React.ReactNode;
  image?: string;
  badge?: React.ReactNode;
  titleColor?: string;
  titleLines?: number;
  compactRight?: boolean;
  onPress?: () => void;
  showChevron?: boolean;
  action?: React.ReactNode;
  testID?: string;
}) {
  const body = (
    <>
      {leading || image != null ? (
        <View style={{ flexShrink: 0 }}>{leading || <ProductThumb uri={image || ""} size={56} />}</View>
      ) : null}
      <View style={{ flex: 1, minWidth: 80 }}>
        {isListRowNode(title) ? title : (
          <Text style={[styles.listTitle, titleColor ? { color: titleColor } : null]} numberOfLines={titleLines}>{listRowText(title)}</Text>
        )}
        {subtitle ? <Text style={styles.muted} numberOfLines={2}>{listRowText(subtitle)}</Text> : null}
      </View>
      {badge}
      {right || rightSub ? (
        <View style={{ alignItems: "flex-end", marginLeft: 6, flexShrink: 0, maxWidth: compactRight ? 96 : 120 }}>
          {right ? <Text testID={rightTestID} style={[styles.listRight, rightColor ? { color: rightColor } : null]} numberOfLines={1}>{listRowText(right)}</Text> : null}
          {rightSub ? <Text style={[styles.muted, { fontWeight: "700", color: rightSubColor || colors.muted }]} numberOfLines={1}>{listRowText(rightSub)}</Text> : null}
        </View>
      ) : null}
    </>
  );
  if (action) {
    return (
      <View testID={testID} style={styles.listRow}>
        {onPress ? (
          <Pressable onPress={onPress} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
            {body}
          </Pressable>
        ) : body}
        {action}
        {onPress || showChevron ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
      </View>
    );
  }
  const Row = onPress ? Pressable : View;
  return (
    <Row testID={testID} onPress={onPress} style={styles.listRow}>
      {body}
      {onPress || showChevron ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </Row>
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
  screen: { flex: 1, backgroundColor: colors.background, overflow: "hidden" },
  flex: { flex: 1 },
  content: { flexGrow: 1 },
  padded: { padding: spacing.sm + 4, gap: spacing.sm + 2 },
  stickyTop: { backgroundColor: colors.background, zIndex: 20, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
  stickyBottom: { backgroundColor: colors.background, zIndex: 20, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
  stickyPad: { paddingHorizontal: spacing.sm + 4, paddingTop: spacing.sm + 4, paddingBottom: spacing.xs },
  stickyPadCompact: { paddingHorizontal: spacing.sm + 4, paddingTop: 4, paddingBottom: 4 },
  stickyPadBottom: { paddingHorizontal: spacing.sm + 4, paddingTop: spacing.xs, paddingBottom: spacing.sm + 4 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    gap: 6,
  },
  h1: { fontSize: 19, color: colors.text, ...typeface("800") },
  muted: { color: colors.muted, fontSize: 12, ...typeface("400") },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10, ...typeface("700") },
  btn: { borderRadius: radius.md, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  btnIcon: { paddingHorizontal: 0, minWidth: 44 },
  btnText: { color: "#fff", fontSize: 14, ...typeface("700") },
  label: { fontSize: 11, color: colors.muted, marginBottom: 4, ...typeface("700") },
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
    ...typeface("400"),
  },
  inputSuffixRow: { flexDirection: "row", alignItems: "center", paddingVertical: 0, paddingRight: 12 },
  inputBare: {
    flex: 1,
    borderWidth: 0,
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: "transparent",
    ...typeface("400"),
  },
  inputSuffix: { fontSize: 16, color: colors.text, ...typeface("800"), paddingLeft: 8 },
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
  emptyTitle: { color: colors.text, ...typeface("700") },
  error: { backgroundColor: colors.rose50, borderRadius: radius.md, padding: 10 },
  errorText: { color: "#BE123C", fontSize: 13, ...typeface("600") },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    minHeight: 76,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listTitle: { color: colors.text, fontSize: 14, ...typeface("700") },
  listRight: { color: colors.text, marginLeft: 8, fontSize: 14, ...typeface("800") },
  statRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  statDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  statLabel: { fontSize: 11, color: colors.muted, ...typeface("700") },
  statHint: { fontSize: 11, color: colors.muted, marginTop: 1, ...typeface("400") },
  statValue: { fontSize: 15, color: colors.text, ...typeface("800") },
  kpi: { flex: 1, minWidth: 140, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 },
  kpiLabel: { fontSize: 10, color: colors.muted, ...typeface("700") },
  kpiValue: { fontSize: 16, color: colors.text, marginTop: 2, ...typeface("800") },
});

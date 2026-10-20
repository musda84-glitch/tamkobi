import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../../theme";
import { moveOverviewSection, normalizeOverviewOrder } from "../../utils/homeOverviewOrder";
import {
  OVERVIEW_SECTION_META,
  overviewMonthTitle,
  type OverviewSectionKey,
} from "./overviewSections";

const SECTION_SUBTITLE: Record<OverviewSectionKey, string> = {
  today: "Bugünkü görevler",
  panels: "Onay, mesaj ve bildirim",
  month: "Satış, tahsilat, KDV",
  stock: "Eşik altı ürünler",
  production: "Açık ve geciken emirler",
  projects: "Aktif işler ve bütçe",
};

/**
 * expo-haptics kurulu değil; uzun basma titreşimsiz kalır.
 * İleride gerçek titreşim bu fonksiyona bağlanır. Dinamik import yok.
 */
export function triggerReorderHaptic(): void {
  /* no-op */
}

function rowTitle(key: OverviewSectionKey): string {
  if (key === "month") return overviewMonthTitle();
  return OVERVIEW_SECTION_META[key].title;
}

/** Sıralama modu. Taşıma ▲/▼ ile; ≡ tutamak görseldir. Sürükle-bırak ayrı PR. */
export function HomeOverviewReorder({
  order,
  onChange,
  onDone,
  onCancel,
  onReset,
  resetDisabled,
}: {
  order: readonly OverviewSectionKey[];
  onChange: (next: OverviewSectionKey[]) => void;
  onDone: () => void;
  onCancel: () => void;
  onReset: () => void;
  resetDisabled: boolean;
}) {
  const rows = normalizeOverviewOrder(order);
  return (
    <View testID="home-overview-reorder" style={styles.wrap}>
      <View style={styles.topBar}>
        <Pressable
          testID="home-overview-reorder-cancel"
          onPress={onCancel}
          accessibilityLabel="Vazgeç"
          hitSlop={8}
          style={styles.textBtn}
        >
          <Text style={styles.cancelText}>Vazgeç</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>Bölümleri sırala</Text>
        <Pressable
          testID="home-overview-reorder-done"
          onPress={onDone}
          accessibilityLabel="Bitti"
          hitSlop={8}
          style={styles.doneBtn}
        >
          <Text style={styles.doneText}>Bitti</Text>
        </Pressable>
      </View>
      <Pressable
        testID="home-overview-reorder-reset"
        disabled={resetDisabled}
        accessibilityLabel="Varsayılan sıralama"
        accessibilityState={{ disabled: resetDisabled }}
        onPress={() => { if (!resetDisabled) onReset(); }}
        style={[styles.resetBtn, resetDisabled ? styles.resetDisabled : null]}
      >
        <Text style={[styles.resetText, resetDisabled ? styles.resetTextDisabled : null]}>Varsayılan sıralama</Text>
      </Pressable>
      <Text style={styles.hint}>Kartı basılı tutup sürükleyin · sıra bu şirket ve kullanıcıya saklanır</Text>
      <View style={styles.list}>
        {rows.map((key, index) => {
          const title = rowTitle(key);
          const first = index === 0;
          const last = index === rows.length - 1;
          return (
            <View key={key} testID={`home-overview-reorder-row-${key}`} style={styles.row}>
              <Text style={styles.handle} accessibilityLabel="Tutamak">≡</Text>
              <View style={styles.iconBubble}>
                <Ionicons name={OVERVIEW_SECTION_META[key].icon as keyof typeof Ionicons.glyphMap} size={18} color={colors.indigo} />
              </View>
              <View style={styles.copy}>
                <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{SECTION_SUBTITLE[key]}</Text>
              </View>
              <Pressable
                testID={`home-overview-reorder-up-${key}`}
                accessibilityLabel="Yukarı"
                accessibilityState={{ disabled: first }}
                disabled={first}
                hitSlop={6}
                onPress={() => { if (!first) onChange(moveOverviewSection(rows, key, -1)); }}
                style={styles.stepBtn}
              >
                <Text style={[styles.stepGlyph, first ? styles.stepOff : null]}>▲</Text>
              </Pressable>
              <Pressable
                testID={`home-overview-reorder-down-${key}`}
                accessibilityLabel="Aşağı"
                accessibilityState={{ disabled: last }}
                disabled={last}
                hitSlop={6}
                onPress={() => { if (!last) onChange(moveOverviewSection(rows, key, 1)); }}
                style={styles.stepBtn}
              >
                <Text style={[styles.stepGlyph, last ? styles.stepOff : null]}>▼</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "800", color: colors.text },
  textBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 2 },
  cancelText: { color: colors.muted, fontWeight: "700", fontSize: 14 },
  doneBtn: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  resetBtn: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center" },
  resetDisabled: { opacity: 0.45 },
  resetText: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  resetTextDisabled: { color: colors.muted },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  list: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 6,
    paddingLeft: 8,
    paddingRight: 2,
  },
  handle: { width: 22, textAlign: "center", fontSize: 18, color: colors.muted, fontWeight: "700" },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.indigo50,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  stepBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stepGlyph: { fontSize: 16, fontWeight: "800", color: colors.text },
  stepOff: { color: colors.slate200 },
});

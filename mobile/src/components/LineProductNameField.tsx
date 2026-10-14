import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { colors } from "../theme";
import type { Product } from "../types";
import { trUpper } from "../utils/labels";
import {
  LINE_PRODUCT_SEARCH_DEBOUNCE_MS,
  lineProductHitMeta,
  lineProductHitPrice,
  lineProductSearchEnabled,
  lineProductSearchQuery,
  shouldShowLineProductHits,
  type LineProductHit,
} from "../utils/lineProductSearch";
import { idOf } from "../utils/money";

export function LineProductNameField({
  value,
  isService,
  editable = true,
  label,
  placeholder,
  testID,
  loadHits,
  excludeProductId,
  onChangeText,
  onSelect,
  onScanPress,
  compact,
}: {
  value: string;
  isService?: boolean;
  editable?: boolean;
  label: string;
  placeholder?: string;
  testID: string;
  loadHits: (q: string) => Promise<LineProductHit[]>;
  excludeProductId?: string;
  onChangeText: (v: string) => void;
  onSelect: (p: LineProductHit | Product) => void;
  onScanPress?: () => void;
  compact?: boolean;
}) {
  const [hits, setHits] = useState<LineProductHit[]>([]);
  const [focused, setFocused] = useState(false);
  const seq = useRef(0);
  const searchOn = lineProductSearchEnabled(isService);

  useEffect(() => {
    if (!editable || !searchOn) {
      setHits([]);
      return undefined;
    }
    const q = lineProductSearchQuery(value, false);
    if (!q) {
      setHits([]);
      return undefined;
    }
    const token = ++seq.current;
    const t = setTimeout(() => {
      void loadHits(q)
        .then((rows) => {
          if (seq.current !== token) return;
          const skip = String(excludeProductId || "");
          setHits(skip ? rows.filter((p) => idOf(p) !== skip) : rows);
        })
        .catch(() => {
          if (seq.current === token) setHits([]);
        });
    }, LINE_PRODUCT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [editable, excludeProductId, loadHits, searchOn, value]);

  const open = shouldShowLineProductHits({ isService, query: value, hits, focused: focused && editable });
  const showScan = searchOn && editable && !!onScanPress;

  return (
    <View style={{ zIndex: open ? 8 : 1 }}>
      <Text style={{ fontSize: compact ? 10 : 9, fontWeight: "700", color: colors.muted, marginBottom: 1 }}>
        {trUpper(label)}
      </Text>
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: compact ? 10 : 12,
          backgroundColor: "#fff",
          minHeight: compact ? 36 : 32,
          paddingHorizontal: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={editable}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          style={{ flex: 1, fontWeight: "700", fontSize: 13, color: colors.text, padding: 0, minHeight: compact ? 36 : 32 }}
        />
        {showScan ? (
          <Pressable
            testID={`${testID}-scan`}
            accessibilityLabel="Barkod okut"
            onPress={onScanPress}
            hitSlop={8}
            style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="barcode-outline" size={18} color={colors.indigo} />
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <ScrollView
          testID={`${testID}-hits`}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          style={{
            maxHeight: 168,
            marginTop: 4,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            backgroundColor: "#fff",
          }}
        >
          {hits.map((p) => {
            const pid = idOf(p);
            return (
              <Pressable
                key={pid || p.sku || p.name}
                testID={`${testID}-hit-${pid}`}
                onPressIn={() => {
                  onSelect(p);
                  setHits([]);
                  setFocused(false);
                }}
                style={{ paddingHorizontal: 10, paddingVertical: 8, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.slate100 }}
              >
                <Text style={{ fontWeight: "800", fontSize: 13, color: colors.text }} numberOfLines={2}>{p.name}</Text>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 11, fontWeight: "600", color: colors.muted }} numberOfLines={1}>
                    {lineProductHitMeta(p)}
                  </Text>
                  <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>{lineProductHitPrice(p)}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

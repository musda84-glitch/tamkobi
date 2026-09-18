import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { post, upload } from "../../api/client";
import { apiErrorMessage } from "../../api/errors";
import type { ApiClient } from "../../api/client";
import { colors } from "../../theme";
import type { B2BProduct } from "../../types";
import {
  learnMappings,
  mapUnmatched,
  normalizeAiCart,
  rejectLegacyXls,
  selectedAiLines,
  setAiQty,
  toggleAiItem,
  type AiCartResult,
} from "../../utils/b2bAiCart";
import { appendPickedFile, pickB2bListFile } from "../../utils/b2bPickFile";
import { GroupedSelect } from "../GroupedSelect";
import { Card, Muted, PrimaryButton, Row } from "../kit";
import { B2BSheet } from "./B2BSheet";

export function B2BAiCartPanel({
  client,
  token,
  products,
  onApply,
}: {
  client: ApiClient;
  token: string;
  products: B2BProduct[];
  onApply: (lines: Array<{ product_id: string; quantity: number }>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<AiCartResult | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});

  const choose = async () => {
    setError(null);
    try {
      const file = await pickB2bListFile();
      if (!file) return;
      const blocked = rejectLegacyXls(file.name);
      if (blocked) {
        setError(blocked);
        return;
      }
      setBusy(true);
      const fd = new FormData();
      appendPickedFile(fd, file);
      const data = await upload<{ items?: AiCartResult["items"]; unmatched?: AiCartResult["unmatched"]; filename?: string }>(
        { ...client, token: null },
        `/public/b2b/${token}/ai-cart`,
        fd
      );
      setRes(normalizeAiCart(data));
    } catch (err) {
      setError(apiErrorMessage(err, "Dosya işlenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!res) return;
    const mappings = learnMappings(res);
    if (mappings.length) {
      await post({ ...client, token: null }, `/public/b2b/${token}/ai-cart/learn`, { mappings }).catch(() => null);
    }
    onApply(selectedAiLines(res));
    setRes(null);
  };

  const groups = [{ label: "Katalog", options: products.map((p) => ({ value: p.id, label: p.sku ? `${p.name} (${p.sku})` : p.name })) }];

  return (
    <View>
      <Pressable
        testID="b2b-ai-cart-drop"
        onPress={choose}
        disabled={busy}
        style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.indigo, borderRadius: 14, padding: 12, backgroundColor: colors.indigo50, marginBottom: 8 }}
      >
        <Text style={{ fontWeight: "800", color: colors.text }}>{busy ? "AI sipariş listenizi okuyor…" : "Excel / PDF sipariş listesi yükle"}</Text>
        <Muted>xlsx, csv, pdf · dosya fiyatı yok sayılır, B2B fiyatı geçerli</Muted>
      </Pressable>
      {error ? <Text style={{ color: colors.danger, fontWeight: "700", marginBottom: 8 }}>{error}</Text> : null}

      <B2BSheet visible={!!res} title="AI Sepet Önerisi" subtitle={res ? `${res.filename || "liste"} · ${res.items.length} eşleşen, ${res.unmatched.length} eşleşmeyen` : undefined} onClose={() => setRes(null)} testID="b2b-ai-cart-modal">
        {res?.items.map((it, i) => (
          <Pressable
            key={`${it.product_id}-${i}`}
            testID={`b2b-ai-item-${i}`}
            onPress={() => setRes(toggleAiItem(res, i, !it.on))}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, opacity: it.on ? 1 : 0.5 }}
          >
            <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: colors.primary, backgroundColor: it.on ? colors.primary : "#fff" }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800", color: colors.text }}>{it.matched_name}</Text>
              <Muted>Listede: “{it.requested}” · %{Math.round((it.confidence || 0) * 100)}{it.learned ? " · öğrenilen" : ""}</Muted>
            </View>
            <TextInput
              testID={`b2b-ai-qty-${i}`}
              value={String(it.quantity)}
              keyboardType="number-pad"
              onChangeText={(v) => setRes(setAiQty(res, i, Number(v)))}
              style={{ width: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8, textAlign: "center", fontWeight: "800" }}
            />
          </Pressable>
        ))}
        {res && res.unmatched.length > 0 ? (
          <Card testID="b2b-ai-unmatched">
            <Text style={{ fontWeight: "800", color: colors.text }}>Katalogda bulunamayanlar</Text>
            {res.unmatched.map((u, i) => (
              <View key={`${u.requested}-${i}`} testID={`b2b-ai-unmatched-${i}`} style={{ marginTop: 8 }}>
                <Muted>• {u.requested} × {u.quantity}</Muted>
                <GroupedSelect
                  testID={`b2b-ai-map-select-${i}`}
                  value={pick[i] || ""}
                  onChange={(v) => setPick((p) => ({ ...p, [i]: v }))}
                  groups={groups}
                  emptyLabel="Stok kartı seç…"
                />
                <PrimaryButton
                  title="Eşle"
                  testID={`b2b-ai-map-btn-${i}`}
                  disabled={!pick[i]}
                  onPress={() => {
                    const p = products.find((x) => x.id === pick[i]);
                    if (p) setRes(mapUnmatched(res, i, p));
                  }}
                />
              </View>
            ))}
          </Card>
        ) : null}
        <Row style={{ marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <PrimaryButton title="Vazgeç" onPress={() => setRes(null)} color={colors.slate800} />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton testID="b2b-ai-apply" title="Seçilenleri Sepete Ekle" onPress={apply} disabled={!selectedAiLines(res).length} color={colors.primary} />
          </View>
        </Row>
      </B2BSheet>
    </View>
  );
}

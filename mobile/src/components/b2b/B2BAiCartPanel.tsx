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

type ProductLike = { id?: string; _id?: string; name?: string; sku?: string };

/** B2B portal veya ERP sipariş (auth) AI liste yükleme. */
export function B2BAiCartPanel({
  client,
  token,
  products,
  onApply,
  uploadPath,
  learnPath,
  learnExtra,
  testIdPrefix = "b2b-ai",
  dropLabel = "Excel / PDF sipariş listesi yükle",
  dropHint = "xlsx, csv, pdf · dosya fiyatı yok sayılır, katalog fiyatı geçerli",
  applyLabel = "Seçilenleri Sepete Ekle",
  sheetTitle = "AI Sepet Önerisi",
}: {
  client: ApiClient;
  token?: string | null;
  products: Array<B2BProduct | ProductLike>;
  onApply: (lines: Array<{ product_id: string; quantity: number }>) => void;
  uploadPath?: string;
  learnPath?: string;
  learnExtra?: Record<string, unknown>;
  testIdPrefix?: string;
  dropLabel?: string;
  dropHint?: string;
  applyLabel?: string;
  sheetTitle?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<AiCartResult | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});

  const staffMode = Boolean(uploadPath);
  const uploadUrl = staffMode ? String(uploadPath) : `/public/b2b/${token}/ai-cart`;
  const learnUrl = staffMode ? String(learnPath || "/ai/cart-learn") : `/public/b2b/${token}/ai-cart/learn`;
  const uploadClient = staffMode ? client : { ...client, token: null };

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
        uploadClient,
        uploadUrl,
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
      await post(uploadClient, learnUrl, { mappings, ...(learnExtra || {}) }).catch(() => null);
    }
    onApply(selectedAiLines(res));
    setRes(null);
  };

  const groups = [{
    label: "Katalog",
    options: products.map((p) => {
      const id = String(p.id || (p as { _id?: string })._id || "");
      return { value: id, label: p.sku ? `${p.name} (${p.sku})` : String(p.name || id) };
    }),
  }];

  return (
    <View>
      <Pressable
        testID={`${testIdPrefix}-cart-drop`}
        onPress={choose}
        disabled={busy}
        style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.indigo, borderRadius: 14, padding: 12, backgroundColor: colors.indigo50, marginBottom: 8 }}
      >
        <Text style={{ fontWeight: "800", color: colors.text }}>{busy ? "AI sipariş listenizi okuyor…" : dropLabel}</Text>
        <Muted>{dropHint}</Muted>
      </Pressable>
      {error ? <Text style={{ color: colors.danger, fontWeight: "700", marginBottom: 8 }}>{error}</Text> : null}

      <B2BSheet visible={!!res} title={sheetTitle} subtitle={res ? `${res.filename || "liste"} · ${res.items.length} eşleşen, ${res.unmatched.length} eşleşmeyen` : undefined} onClose={() => setRes(null)} testID={`${testIdPrefix}-cart-modal`}>
        {res?.items.map((it, i) => (
          <Pressable
            key={`${it.product_id}-${i}`}
            testID={`${testIdPrefix}-item-${i}`}
            onPress={() => setRes(toggleAiItem(res, i, !it.on))}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, opacity: it.on ? 1 : 0.5 }}
          >
            <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: colors.primary, backgroundColor: it.on ? colors.primary : "#fff" }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800", color: colors.text }}>{it.matched_name}</Text>
              <Muted>Listede: “{it.requested}” · %{Math.round((it.confidence || 0) * 100)}{it.learned ? " · öğrenilen" : ""}</Muted>
            </View>
            <TextInput
              testID={`${testIdPrefix}-qty-${i}`}
              value={String(it.quantity)}
              keyboardType="number-pad"
              onChangeText={(v) => setRes(setAiQty(res, i, Number(v)))}
              style={{ width: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8, textAlign: "center", fontWeight: "800" }}
            />
          </Pressable>
        ))}
        {res && res.unmatched.length > 0 ? (
          <Card testID={`${testIdPrefix}-unmatched`}>
            <Text style={{ fontWeight: "800", color: colors.text }}>Katalogda bulunamayanlar</Text>
            {res.unmatched.map((u, i) => (
              <View key={`${u.requested}-${i}`} testID={`${testIdPrefix}-unmatched-${i}`} style={{ marginTop: 8 }}>
                <Muted>• {u.requested} × {u.quantity}</Muted>
                <GroupedSelect
                  testID={`${testIdPrefix}-map-select-${i}`}
                  value={pick[i] || ""}
                  onChange={(v) => setPick((p) => ({ ...p, [i]: v }))}
                  groups={groups}
                  emptyLabel="Stok kartı seç…"
                />
                <PrimaryButton
                  title="Eşle"
                  testID={`${testIdPrefix}-map-btn-${i}`}
                  disabled={!pick[i]}
                  onPress={() => {
                    const p = products.find((x) => String(x.id || (x as { _id?: string })._id || "") === pick[i]);
                    if (p) {
                      const pid = String(p.id || (p as { _id?: string })._id || "");
                      setRes(mapUnmatched(res, i, { id: pid, name: String(p.name || "") }));
                    }
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
            <PrimaryButton testID={`${testIdPrefix}-apply`} title={applyLabel} onPress={apply} disabled={!selectedAiLines(res).length} color={colors.primary} />
          </View>
        </Row>
      </B2BSheet>
    </View>
  );
}

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Card, ErrorBanner, Field, H1, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { Product } from "../types";
import {
  PRODUCT_TYPES,
  VAT_RATES,
  draftFromProduct,
  emptyProductDraft,
  generateBarcode,
  productPayload,
  validateProductDraft,
  type ProductDraft,
} from "../utils/productDraft";

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 999,
        backgroundColor: active ? colors.primary : "#fff",
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Text style={{ color: active ? "#fff" : colors.text, fontWeight: "700", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function Flag({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={() => onChange(!value)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: value ? colors.emerald50 : colors.slate50,
        flex: 1,
        minWidth: "45%",
      }}
    >
      <Ionicons name={value ? "checkbox" : "square-outline"} size={20} color={value ? colors.primary : colors.muted} />
      <Text style={{ fontWeight: "700", color: colors.text, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

function confirmDelete(name: string, onYes: () => void) {
  const msg = `${name} stok kartı çöp kutusuna taşınsın mı? İşlem görmüş kartlar silinemez.`;
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(msg)) onYes();
    return;
  }
  Alert.alert("Stok kartını sil", msg, [
    { text: "Vazgeç", style: "cancel" },
    { text: "Sil", style: "destructive", onPress: onYes },
  ]);
}

export function ProductFormScreen({ productId }: { productId?: string }) {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/stock", "edit");
  const isNew = !productId;
  const [draft, setDraft] = useState<ProductDraft>(emptyProductDraft());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!isNew);

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    try {
      const p = await get<Product>(client, `/products/${productId}`);
      setDraft(draftFromProduct(p));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Stok kartı yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [client, productId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const invalid = validateProductDraft(draft);
    if (invalid) { setError(invalid); return; }
    if (!canEdit) { setError("Stok kartı düzenleme yetkiniz yok."); return; }
    setBusy(true);
    setMessage(null);
    try {
      if (isNew) {
        await post<Product>(client, "/products", productPayload(draft, companyId));
        setMessage("Stok kartı oluşturuldu.");
        router.back();
      } else {
        await put<Product>(client, `/products/${productId}`, productPayload(draft));
        setMessage("Stok kartı güncellendi.");
      }
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Stok kartı kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!productId || !canEdit) return;
    confirmDelete(draft.name || "Bu ürün", async () => {
      setBusy(true);
      try {
        await del<{ message?: string }>(client, `/products/${productId}`);
        router.back();
      } catch (err) {
        setError(apiErrorMessage(err, "Stok kartı silinemedi."));
        setBusy(false);
      }
    });
  };

  return (
    <Screen onRefresh={isNew ? undefined : load} refreshing={loading}>
      <H1>{isNew ? "Yeni stok kartı" : draft.name || "Stok kartı"}</H1>
      <Muted>{isNew ? "Ad ve SKU zorunlu. Barkod boşsa sunucu üretir." : [draft.sku, draft.barcode].filter(Boolean).join(" · ")}</Muted>
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}

      <Field label="Ürün adı" testID="stock-name" value={draft.name} onChangeText={(v) => set("name", v)} editable={canEdit} />
      <Field label="SKU" testID="stock-sku" value={draft.sku} onChangeText={(v) => set("sku", v)} autoCapitalize="none" editable={canEdit} />
      <Row>
        <View style={{ flex: 1 }}>
          <Field label="Barkod" testID="stock-barcode" value={draft.barcode} onChangeText={(v) => set("barcode", v)} autoCapitalize="none" keyboardType="number-pad" editable={canEdit} />
        </View>
      </Row>
      {canEdit ? (
        <PrimaryButton title="Barkod üret" color={colors.indigo} onPress={() => set("barcode", generateBarcode())} testID="stock-gen-barcode" />
      ) : null}

      <Muted>Tür</Muted>
      <Row style={{ flexWrap: "wrap" }}>
        {PRODUCT_TYPES.map((t) => (
          <Chip key={t.key} label={t.label} active={draft.type === t.key} onPress={() => canEdit && set("type", t.key)} testID={`stock-type-${t.key}`} />
        ))}
      </Row>
      <Field label="Kategori" testID="stock-category" value={draft.category} onChangeText={(v) => set("category", v)} editable={canEdit} />
      <Field label="Birim" testID="stock-unit" value={draft.unit} onChangeText={(v) => set("unit", v)} editable={canEdit} />

      <Field label="Alış fiyatı (₺)" testID="stock-purchase" value={draft.purchase_price} onChangeText={(v) => set("purchase_price", v)} keyboardType="decimal-pad" editable={canEdit} />
      <Field label="Satış fiyatı (₺)" testID="stock-sale" value={draft.sale_price} onChangeText={(v) => set("sale_price", v)} keyboardType="decimal-pad" editable={canEdit} />
      <Field label="Mevcut stok" testID="stock-qty" value={draft.stock_quantity} onChangeText={(v) => set("stock_quantity", v)} keyboardType="decimal-pad" editable={canEdit} />
      <Field label="Kritik stok" testID="stock-min" value={draft.min_stock_alert} onChangeText={(v) => set("min_stock_alert", v)} keyboardType="decimal-pad" editable={canEdit} />

      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>KDV</Text>
        <Muted>Satış KDV %</Muted>
        <Row style={{ flexWrap: "wrap" }}>
          {VAT_RATES.map((v) => (
            <Chip key={`s${v}`} label={`%${v}`} active={String(draft.vat_rate) === String(v)} onPress={() => canEdit && set("vat_rate", String(v))} />
          ))}
        </Row>
        <Muted>Alış KDV %</Muted>
        <Row style={{ flexWrap: "wrap" }}>
          {VAT_RATES.map((v) => (
            <Chip key={`p${v}`} label={`%${v}`} active={String(draft.purchase_vat_rate) === String(v)} onPress={() => canEdit && set("purchase_vat_rate", String(v))} />
          ))}
        </Row>
        <Field label="KDV istisna kodu" value={draft.vat_exemption_code} onChangeText={(v) => set("vat_exemption_code", v)} placeholder="Örn: 301" editable={canEdit} />
        <Flag label="Satış fiyatı KDV dahil" value={draft.price_includes_vat} onChange={(v) => set("price_includes_vat", v)} testID="stock-vat-included" />
      </Card>

      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>Paket (kargo)</Text>
        <Field label="Paket sayısı" value={draft.package_count} onChangeText={(v) => set("package_count", v)} keyboardType="number-pad" editable={canEdit} />
        <Field label="Desi" value={draft.desi} onChangeText={(v) => set("desi", v)} keyboardType="decimal-pad" editable={canEdit} />
        <Field label="Ağırlık kg" value={draft.weight} onChangeText={(v) => set("weight", v)} keyboardType="decimal-pad" editable={canEdit} />
        <Field label="En cm" value={draft.length} onChangeText={(v) => set("length", v)} keyboardType="decimal-pad" editable={canEdit} />
        <Field label="Boy cm" value={draft.width} onChangeText={(v) => set("width", v)} keyboardType="decimal-pad" editable={canEdit} />
        <Field label="Yükseklik cm" value={draft.height} onChangeText={(v) => set("height", v)} keyboardType="decimal-pad" editable={canEdit} />
      </Card>

      <Row style={{ flexWrap: "wrap" }}>
        <Flag label="B2B'de göster" value={draft.show_in_b2b} onChange={(v) => set("show_in_b2b", v)} testID="stock-b2b" />
        <Flag label="Stok takibi" value={draft.track_stock} onChange={(v) => set("track_stock", v)} testID="stock-track" />
        <Flag label="Aktif" value={draft.is_active} onChange={(v) => set("is_active", v)} testID="stock-active" />
      </Row>

      {canEdit ? (
        <PrimaryButton
          testID="stock-save"
          title={busy ? "Kaydediliyor…" : isNew ? "Stok kartı oluştur" : "Kaydet"}
          onPress={save}
          loading={busy}
          color={colors.primary}
          disabled={!draft.name || !draft.sku}
        />
      ) : null}
      {!isNew && canEdit ? (
        <PrimaryButton testID="stock-delete" title="Stok kartını sil" onPress={remove} color={colors.danger} disabled={busy} />
      ) : null}
    </Screen>
  );
}

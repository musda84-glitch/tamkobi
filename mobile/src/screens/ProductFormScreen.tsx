import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { LazyBarcodeScanner } from "../components/LazyBarcodeScanner";
import { confirmAction } from "../components/chips";
import { ImageUploader } from "../components/ImageUploader";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, Empty, ErrorBanner, Field, H1, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors, spacing } from "../theme";
import type { Product } from "../types";
import { idOf } from "../utils/money";
import { removeGalleryImage } from "../utils/formDataFile";
import { productGalleryUrls } from "../utils/productDisplay";
import {
  PRODUCT_TYPES,
  VAT_RATES,
  draftFromProduct,
  emptyProductDraft,
  generateBarcode,
  generateBarcodeConfirm,
  productPayload,
  validateProductDraft,
  type ProductDraft,
} from "../utils/productDraft";
import { DEFAULT_STOCK_UNIT, mergeUnitOptions, unitNamesFromApi, unitSelectGroups } from "../utils/stockUnits";
import {
  PRINTER_PRESETS,
  defaultEthernetPrinter,
  discoverEthernetPrinters,
  loadEthernetPrinter,
  printLabelEthernet,
  probeEthernetPrinter,
  saveEthernetPrinter,
  type DiscoveredPrinter,
  type EthernetPrinterSettings,
} from "../utils/ethernetPrinter";

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
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [scan, setScan] = useState(false);
  const [savedUnits, setSavedUnits] = useState<string[] | null>(null);
  const [eth, setEth] = useState<EthernetPrinterSettings | null>(null);
  const [ethBusy, setEthBusy] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredPrinter[]>([]);
  const [discoverHint, setDiscoverHint] = useState<string | null>(null);
  /** null | menu (Etiket yazdır) | pick (yazıcı seç) | settings (yazıcı ayarları) */
  const [labelSheet, setLabelSheet] = useState<"menu" | "pick" | "settings" | null>(null);
  const ethCfg = eth || defaultEthernetPrinter();

  const runDiscover = async () => {
    setEthBusy(true);
    setDiscoverHint(null);
    try {
      const r = await discoverEthernetPrinters(ethCfg, client);
      setDiscovered(r.printers);
      const subnet = r.subnet ? ` (${r.subnet})` : "";
      if (!r.printers.length) {
        setDiscoverHint(`Açık yazıcı bulunamadı${subnet}. Aynı Wi‑Fi/LAN ve köprü/API gerekir.`);
      } else {
        setDiscoverHint(`${r.printers.length} yazıcı bulundu${subnet}.`);
        setError(null);
      }
    } catch (err) {
      setDiscovered([]);
      setError(apiErrorMessage(err, "Ağ taraması başarısız."));
      setDiscoverHint(null);
    } finally {
      setEthBusy(false);
    }
  };

  const pickDiscoveredHost = (row: DiscoveredPrinter) => {
    const next = { ...ethCfg, host: row.host, port: row.port || ethCfg.port, enabled: true };
    setEth(next);
    void saveEthernetPrinter(next).then(setEth);
    setMessage(`Yazıcı seçildi: ${row.host}:${row.port || ethCfg.port}`);
    setError(null);
  };

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const load = useCallback(async () => {
    if (!productId || !canEdit) return;
    setLoading(true);
    try {
      const p = await get<Product>(client, `/products/${productId}`);
      setDraft(draftFromProduct(p));
      setPhotos(productGalleryUrls(p));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Stok kartı yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [canEdit, client, productId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    loadEthernetPrinter().then(setEth).catch(() => setEth(null));
  }, []);

  useEffect(() => {
    if (!companyId) return undefined;
    let cancelled = false;
    get<{ name?: string }[]>(client, "/products/units", { company_id: companyId })
      .then((rows) => { if (!cancelled) setSavedUnits(unitNamesFromApi(rows)); })
      .catch(() => { if (!cancelled) setSavedUnits([]); });
    return () => { cancelled = true; };
  }, [client, companyId]);

  const save = async () => {
    const invalid = validateProductDraft(draft);
    if (invalid) { setError(invalid); return; }
    if (!canEdit) { setError("Stok kartı düzenleme yetkiniz yok."); return; }
    setBusy(true);
    setMessage(null);
    try {
      if (isNew) {
        const created = await post<Product>(client, "/products", productPayload(draft, companyId));
        const createdId = idOf(created);
        setMessage("Stok kartı oluşturuldu. Fotoğraf ekleyebilirsiniz.");
        if (createdId) {
          router.replace(`/stock/${createdId}`);
          return;
        }
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

  if (!canEdit) {
    return (
      <Screen>
        <Empty
          icon="lock-closed-outline"
          title="Stok kartı kapalı"
          hint="Personel ve üretim bu forma giremez. Kartı yalnızca depo veya yönetici açabilir."
        />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={isNew ? undefined : load} refreshing={loading}>
      <H1>{isNew ? "Yeni stok kartı" : draft.name || "Stok kartı"}</H1>
      <Muted>{isNew ? "Ad ve SKU zorunlu. Barkod boşsa sunucu üretir." : [draft.sku, draft.barcode].filter(Boolean).join(" · ")}</Muted>
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
      <ImageUploader
        entity="product"
        entityId={productId}
        images={photos}
        onUploaded={(url) => setPhotos((prev) => (prev.includes(url) ? prev : [...prev, url]))}
        onRemoved={(url) => {
          const next = removeGalleryImage(photos, url);
          setPhotos(next);
          if (!productId) return;
          void put(client, `/products/${productId}/images`, { images: next, image_url: next[0] || "" }).catch((err) => {
            setError(apiErrorMessage(err, "Fotoğraf silinemedi."));
          });
        }}
        editable={canEdit}
        testID="stock-photos"
      />

      <Field label="Ürün adı" testID="stock-name" value={draft.name} onChangeText={(v) => set("name", v)} editable={canEdit} />
      <Field label="SKU" testID="stock-sku" value={draft.sku} onChangeText={(v) => set("sku", v)} autoCapitalize="none" editable={canEdit} />
      <Row style={{ alignItems: "flex-end" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Field label="Barkod" testID="stock-barcode" value={draft.barcode} onChangeText={(v) => set("barcode", v)} autoCapitalize="none" keyboardType="number-pad" editable={canEdit} />
        </View>
        {canEdit ? (
          <Pressable
            testID="stock-scan-barcode"
            accessibilityLabel="Kamera ile barkod okut"
            onPress={() => setScan(true)}
            style={{
              minWidth: 72,
              minHeight: 44,
              marginBottom: spacing.md,
              paddingHorizontal: 10,
              borderRadius: 12,
              backgroundColor: colors.indigo,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Ionicons name="camera-outline" size={22} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>Okut</Text>
          </Pressable>
        ) : null}
      </Row>
      {canEdit ? (
        <PrimaryButton
          title="Barkod üret"
          color={colors.indigo}
          onPress={() => confirmAction("Barkod üret", generateBarcodeConfirm(draft.barcode), () => set("barcode", generateBarcode()))}
          testID="stock-gen-barcode"
        />
      ) : null}
      <LazyBarcodeScanner
        visible={scan}
        onClose={() => setScan(false)}
        onScan={(code) => {
          set("barcode", code);
          setScan(false);
        }}
      />

      <Muted>Tür</Muted>
      <Row style={{ flexWrap: "wrap" }}>
        {PRODUCT_TYPES.map((t) => (
          <Chip key={t.key} label={t.label} active={draft.type === t.key} onPress={() => canEdit && set("type", t.key)} testID={`stock-type-${t.key}`} />
        ))}
      </Row>
      <Field label="Kategori" testID="stock-category" value={draft.category} onChangeText={(v) => set("category", v)} editable={canEdit} />
      <GroupedSelect
        label="Birim"
        testID="stock-unit"
        value={draft.unit || DEFAULT_STOCK_UNIT}
        onChange={(v) => canEdit && set("unit", v || DEFAULT_STOCK_UNIT)}
        groups={unitSelectGroups(mergeUnitOptions(savedUnits, draft.unit))}
      />

      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>Kapsama (1 {draft.unit || "Adet"} = ?)</Text>
        <Muted>Reçete M2/Metre hesabı ve kalan fire için. Örn. 1 Adet = 2,98 M2.</Muted>
        <Field
          label={`1 ${draft.unit || "Adet"} =`}
          testID="stock-unit-content-qty"
          value={draft.unit_content_qty}
          onChangeText={(v) => set("unit_content_qty", v)}
          keyboardType="decimal-pad"
          placeholder="örn. 2.98"
          editable={canEdit}
        />
        <GroupedSelect
          label="İçerik birimi"
          testID="stock-unit-content-unit"
          value={draft.unit_content_unit || ""}
          onChange={(v) => canEdit && set("unit_content_unit", v || "")}
          groups={[{ label: "İçerik", options: ["", "M2", "M3", "Metre", "Mt", "Cm", "Kg", "Lt", "Ml"].map((u) => ({ value: u, label: u || "— yok —" })) }]}
        />
      </Card>

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
        <Text style={{ fontWeight: "800", color: colors.text }}>Menşei / GTIP / Üretici</Text>
        <Muted>İthalat-ihracat ve e-ihracat faturalarında kullanılır.</Muted>
        <Field label="Menşei" testID="stock-origin" value={draft.origin_country} onChangeText={(v) => set("origin_country", v)} placeholder="TR, CN, DE…" autoCapitalize="characters" editable={canEdit} />
        <Field label="GTIP" testID="stock-gtip" value={draft.gtip} onChangeText={(v) => set("gtip", v)} placeholder="8471.30.00.00.00" autoCapitalize="none" editable={canEdit} />
        <Field label="Üretici kodu" testID="stock-manufacturer-code" value={draft.manufacturer_code} onChangeText={(v) => set("manufacturer_code", v)} placeholder="Üretici / MPN" autoCapitalize="none" editable={canEdit} />
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

      {!isNew ? (
        <PrimaryButton
          testID="stock-label-print"
          title="Etiket yazdır"
          icon="pricetag"
          color={colors.indigo}
          onPress={() => setLabelSheet("menu")}
        />
      ) : null}

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

      <B2BSheet
        visible={labelSheet === "menu"}
        title="Etiket yazdır"
        subtitle={ethCfg.host ? `${ethCfg.brand} ${ethCfg.model} · ${ethCfg.host}` : "Yazıcı henüz ayarlanmadı"}
        onClose={() => setLabelSheet(null)}
        testID="stock-label-menu"
      >
        <PrimaryButton
          title="Yazıcı seç"
          testID="stock-label-pick-btn"
          color={colors.primary}
          onPress={() => setLabelSheet("pick")}
        />
        <PrimaryButton
          title="Yazıcı ayarları"
          testID="stock-label-settings-btn"
          color={colors.secondary}
          onPress={() => setLabelSheet("settings")}
        />
      </B2BSheet>

      <B2BSheet
        visible={labelSheet === "pick"}
        title="Yazıcı seç"
        subtitle="Model seçip etiketi yazıcıya gönderin"
        onClose={() => setLabelSheet(null)}
        testID="stock-label-pick"
      >
        <GroupedSelect
          label="Model"
          testID="eth-preset"
          value={ethCfg.presetId}
          onChange={(v) => {
            const p = PRINTER_PRESETS.find((x) => x.id === v) || PRINTER_PRESETS[0];
            void saveEthernetPrinter({
              ...ethCfg,
              presetId: p.id,
              brand: p.brand,
              model: p.model,
              port: p.port,
              protocol: p.protocol,
              dpi: p.dpi,
            }).then(setEth);
          }}
          groups={[{ label: "Yazıcılar", options: PRINTER_PRESETS.map((p) => ({ value: p.id, label: `${p.brand} ${p.model}` })) }]}
        />
        <PrimaryButton
          title={ethBusy ? "Taranıyor…" : "Ağdaki yazıcıları bul"}
          testID="eth-discover"
          color={colors.secondary}
          disabled={ethBusy}
          loading={ethBusy}
          onPress={runDiscover}
        />
        {discoverHint ? <Muted testID="eth-discover-hint">{discoverHint}</Muted> : null}
        {discovered.map((row) => (
          <PrimaryButton
            key={`${row.host}:${row.port}`}
            title={`${row.host}:${row.port}`}
            testID={`eth-found-${row.host.replace(/\./g, "-")}`}
            color={ethCfg.host === row.host ? colors.primary : colors.indigo}
            onPress={() => pickDiscoveredHost(row)}
          />
        ))}
        <Muted>{ethCfg.host ? `IP ${ethCfg.host}:${ethCfg.port}` : "Önce yazıcı ayarlarından IP girin veya ağdan bulun."}</Muted>
        <PrimaryButton
          title={ethBusy ? "Gönderiliyor…" : "Bu yazıcıya yazdır"}
          testID="eth-print"
          color={colors.indigo}
          disabled={ethBusy || !ethCfg.host || !(draft.barcode || draft.sku)}
          loading={ethBusy}
          onPress={async () => {
            setEthBusy(true);
            try {
              const cfg = await saveEthernetPrinter({ ...ethCfg, enabled: true });
              setEth(cfg);
              await printLabelEthernet({
                product: {
                  name: draft.name,
                  sku: draft.sku,
                  barcode: draft.barcode,
                  sale_price: Number(draft.sale_price) || null,
                },
                tpl: { width_mm: 100, height_mm: 30 },
                copies: 1,
                client,
                settings: cfg,
              });
              setMessage(`Ethernet yazıcıya gönderildi (${cfg.host}:${cfg.port})`);
              setError(null);
              setLabelSheet(null);
            } catch (err) {
              setError(apiErrorMessage(err, "Ethernet yazdırma başarısız."));
            } finally {
              setEthBusy(false);
            }
          }}
        />
        <PrimaryButton title="Geri" color={colors.secondary} testID="stock-label-pick-back" onPress={() => setLabelSheet("menu")} />
      </B2BSheet>

      <B2BSheet
        visible={labelSheet === "settings"}
        title="Yazıcı ayarları"
        subtitle="Ethernet / IP etiket yazıcı (Xprinter XP-490B vb.)"
        onClose={() => setLabelSheet(null)}
        testID="ethernet-printer-card"
      >
        <GroupedSelect
          label="Model"
          testID="eth-settings-preset"
          value={ethCfg.presetId}
          onChange={(v) => {
            const p = PRINTER_PRESETS.find((x) => x.id === v) || PRINTER_PRESETS[0];
            void saveEthernetPrinter({
              ...ethCfg,
              presetId: p.id,
              brand: p.brand,
              model: p.model,
              port: p.port,
              protocol: p.protocol,
              dpi: p.dpi,
            }).then(setEth);
          }}
          groups={[{ label: "Yazıcılar", options: PRINTER_PRESETS.map((p) => ({ value: p.id, label: `${p.brand} ${p.model}` })) }]}
        />
        <Field
          label="Yazıcı IP"
          testID="eth-host"
          value={ethCfg.host}
          onChangeText={(v) => {
            setEth({ ...ethCfg, host: v });
            void saveEthernetPrinter({ ...ethCfg, host: v, enabled: !!v.trim() });
          }}
          placeholder="192.168.1.100"
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
        />
        <PrimaryButton
          title={ethBusy ? "Taranıyor…" : "Ağdaki yazıcıları bul"}
          testID="eth-settings-discover"
          color={colors.secondary}
          disabled={ethBusy}
          loading={ethBusy}
          onPress={runDiscover}
        />
        {discoverHint ? <Muted testID="eth-settings-discover-hint">{discoverHint}</Muted> : null}
        {discovered.map((row) => (
          <PrimaryButton
            key={`settings-${row.host}:${row.port}`}
            title={`${row.host}:${row.port}`}
            testID={`eth-settings-found-${row.host.replace(/\./g, "-")}`}
            color={ethCfg.host === row.host ? colors.primary : colors.indigo}
            onPress={() => pickDiscoveredHost(row)}
          />
        ))}
        <Field
          label="Port"
          testID="eth-port"
          value={String(ethCfg.port)}
          onChangeText={(v) => {
            const port = Number(v) || 9100;
            setEth({ ...ethCfg, port });
            void saveEthernetPrinter({ ...ethCfg, port });
          }}
          keyboardType="number-pad"
        />
        <GroupedSelect
          label="Gönderim"
          testID="eth-mode"
          value={ethCfg.mode}
          onChange={(v) => {
            const mode = v === "api" ? "api" : "bridge";
            void saveEthernetPrinter({ ...ethCfg, mode }).then(setEth);
          }}
          groups={[{
            label: "Mod",
            options: [
              { value: "bridge", label: "Yerel köprü (mobil / Wi‑Fi)" },
              { value: "api", label: "API sunucusu → yazıcı" },
            ],
          }]}
        />
        {ethCfg.mode === "bridge" ? (
          <Field
            label="Köprü URL"
            testID="eth-bridge"
            value={ethCfg.bridgeUrl}
            onChangeText={(v) => {
              setEth({ ...ethCfg, bridgeUrl: v });
              void saveEthernetPrinter({ ...ethCfg, bridgeUrl: v });
            }}
            placeholder="http://192.168.1.50:19100"
            autoCapitalize="none"
          />
        ) : null}
        <PrimaryButton
          title={ethBusy ? "…" : "Bağlantı testi"}
          testID="eth-probe"
          color={colors.secondary}
          disabled={ethBusy || !ethCfg.host}
          onPress={async () => {
            setEthBusy(true);
            try {
              const r = await probeEthernetPrinter(ethCfg, client);
              setMessage(`Yazıcı OK: ${r.host || ethCfg.host}:${r.port || ethCfg.port}`);
              setError(null);
            } catch (err) {
              setError(apiErrorMessage(err, "Yazıcıya ulaşılamadı."));
            } finally {
              setEthBusy(false);
            }
          }}
        />
        <PrimaryButton title="Geri" color={colors.secondary} testID="stock-label-settings-back" onPress={() => setLabelSheet("menu")} />
      </B2BSheet>
    </Screen>
  );
}

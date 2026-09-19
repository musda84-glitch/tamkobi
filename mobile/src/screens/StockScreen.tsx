import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { fileUrl, get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { GroupedSelect } from "../components/GroupedSelect";
import { Badge, Empty, ErrorBanner, Field, ListRow, Screen } from "../components/kit";
import { go } from "../nav";
import { colors, radius } from "../theme";
import type { Product } from "../types";
import { productTypeTr } from "../utils/labels";
import { fmtMoney, idOf } from "../utils/money";
import { filterProducts, productCategoryGroups, productImage, stockBadge, stockQtyLabel, stockRightLabel, stockRowSubtitle, type ProductCategory } from "../utils/productDisplay";

function ProductThumb({ uri }: { uri: string }) {
  const { client } = useAuth();
  const box = {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.slate100,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  };
  if (!uri) {
    return (
      <View style={box}>
        <Ionicons name="cube-outline" size={20} color={colors.muted} />
      </View>
    );
  }
  return (
    <View style={box}>
      <Image source={{ uri: fileUrl(client.baseUrl, uri) }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={120} />
    </View>
  );
}

export function StockScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/stock", "edit");
  const params = useLocalSearchParams<{ scan?: string | string[] }>();
  const [rows, setRows] = useState<Product[]>([]);
  const [cats, setCats] = useState<ProductCategory[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [scan, setScan] = useState(false);
  const [hit, setHit] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const flag = Array.isArray(params.scan) ? params.scan[0] : params.scan;
    if (flag === "1" || flag === "true") setScan(true);
  }, [params.scan]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [data, catRows] = await Promise.all([
        get<Product[]>(client, "/products", { company_id: companyId }),
        get<ProductCategory[]>(client, "/products/categories", { company_id: companyId }).catch(() => []),
      ]);
      setRows(data || []);
      setCats(catRows || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Stok yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const lookup = async (code: string) => {
    try {
      const local = rows.find((p) => p.barcode === code || p.sku === code);
      if (local) { setHit(local); setQ(code); return; }
      const p = await get<Product>(client, `/products/barcode/${encodeURIComponent(code)}`, { company_id: companyId });
      setHit(p);
      setQ(code);
    } catch (err) {
      setHit(null);
      setError(apiErrorMessage(err, "Barkod ile ürün bulunamadı."));
    }
  };

  const catGroups = useMemo(() => productCategoryGroups(cats, rows), [cats, rows]);

  const filtered = useMemo(() => {
    if (hit) return [hit];
    return filterProducts(rows, q, cat, 100);
  }, [cat, hit, q, rows]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <ActionTiles
        items={[
          ...(canEdit ? [{ key: "new", label: "Yeni kart", icon: "add-circle" as const, tone: "emerald" as const, testID: "stock-new", onPress: () => go("StockNew") }] : []),
          { key: "scan", label: "Barkod okut", icon: "barcode", tone: "indigo", testID: "stock-scan", onPress: () => setScan(true) },
          { key: "refresh", label: "Yenile", icon: "refresh", tone: "slate", testID: "stock-refresh", onPress: load },
        ]}
        columns={3}
      />
      <GroupedSelect
        label="Kategori"
        testID="stock-category"
        value={cat}
        onChange={(v) => { setCat(v || "all"); setHit(null); }}
        groups={catGroups}
      />
      <Field label="Ara" testID="stock-search" value={q} onChangeText={(v) => { setQ(v); setHit(null); }} placeholder="Ad, SKU, barkod" />
      <ErrorBanner message={error} />
      {!filtered.length ? (
        <Empty icon="cube-outline" title="Ürün yok" hint={canEdit ? "Kategori veya aramayı değiştirin, ya da yeni stok kartı ekleyin." : "Kategori veya aramayı değiştirin, ya da barkod okutun."} />
      ) : filtered.map((p) => {
        const badge = stockBadge(p);
        const qty = stockQtyLabel(p);
        const qtyTone = badge?.tone === "danger" ? "red" : badge?.tone === "warning" ? "amber" : "green";
        return (
          <ListRow
            key={idOf(p)}
            testID={`stock-row-${idOf(p)}`}
            leading={<ProductThumb uri={productImage(p)} />}
            title={p.name}
            subtitle={`${qty} · ${stockRowSubtitle(p, productTypeTr(p.type), fmtMoney(p.sale_price))}`}
            right={stockRightLabel(p)}
            rightColor={qtyTone === "red" ? colors.danger : qtyTone === "amber" ? colors.warning : colors.text}
            rightTestID={`stock-qty-${idOf(p)}`}
            badge={<Badge label={qty} tone={qtyTone} />}
            onPress={() => go("StockDetail", { id: idOf(p), name: p.name })}
          />
        );
      })}
      <BarcodeScannerModal visible={scan} onClose={() => setScan(false)} onScan={lookup} />
    </Screen>
  );
}

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { fileUrl, get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { Empty, ErrorBanner, Field, ListRow, PrimaryButton, Screen } from "../components/kit";
import { go } from "../nav";
import { colors, radius } from "../theme";
import type { Product } from "../types";
import { productTypeTr } from "../utils/labels";
import { fmtMoney, idOf } from "../utils/money";
import { productImage, stockBadge } from "../utils/productDisplay";

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
  const [q, setQ] = useState("");
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
      const data = await get<Product[]>(client, "/products", { company_id: companyId, lite: true });
      setRows(data || []);
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

  const filtered = useMemo(() => {
    if (hit) return [hit];
    const s = q.trim().toLowerCase();
    const list = s
      ? rows.filter((p) => [p.name, p.sku, p.barcode, p.category].some((v) => String(v || "").toLowerCase().includes(s)))
      : rows;
    return list.slice(0, 100);
  }, [hit, q, rows]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      {canEdit ? (
        <PrimaryButton title="Yeni stok kartı" onPress={() => go("StockNew")} color={colors.primary} testID="stock-new" />
      ) : null}
      <PrimaryButton title="Barkod okut" onPress={() => setScan(true)} testID="stock-scan" />
      <Field label="Ara" testID="stock-search" value={q} onChangeText={(v) => { setQ(v); setHit(null); }} placeholder="Ad, SKU, barkod" />
      <ErrorBanner message={error} />
      {!filtered.length ? (
        <Empty icon="cube-outline" title="Ürün yok" hint={canEdit ? "Yeni stok kartı ekleyin veya aramayı değiştirin." : "Aramayı değiştirin veya barkod okutun."} />
      ) : filtered.map((p) => {
        const badge = stockBadge(p);
        return (
          <ListRow
            key={idOf(p)}
            testID={`stock-row-${idOf(p)}`}
            leading={<ProductThumb uri={productImage(p)} />}
            title={p.name}
            subtitle={[
              p.sku || "SKU yok",
              p.barcode ? `barkod ${p.barcode}` : "barkodsuz",
              productTypeTr(p.type),
              p.is_active === false ? "Pasif" : "",
            ].filter(Boolean).join(" · ")}
            right={fmtMoney(p.sale_price)}
            rightSub={badge ? `stok ${badge.label}` : undefined}
            rightSubColor={badge?.tone === "danger" ? colors.danger : badge?.tone === "warning" ? colors.warning : undefined}
            onPress={() => go("StockDetail", { id: idOf(p), name: p.name })}
          />
        );
      })}
      <BarcodeScannerModal visible={scan} onClose={() => setScan(false)} onScan={lookup} />
    </Screen>
  );
}

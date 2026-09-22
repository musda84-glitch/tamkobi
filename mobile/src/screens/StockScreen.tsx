import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { GroupedSelect } from "../components/GroupedSelect";
import { Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Screen } from "../components/kit";
import { LazyBarcodeScanner } from "../components/LazyBarcodeScanner";
import { ProductThumb } from "../components/ProductThumb";
import { go } from "../nav";
import { colors } from "../theme";
import type { Product } from "../types";
import { productTypeTr } from "../utils/labels";
import { cacheIsFresh, peekCachedRows, readCachedRows, writeCachedRows } from "../utils/listCache";
import { listRowText } from "../utils/listRow";
import { LIST_INITIAL_ROWS, nextRowLimit, visibleRows } from "../utils/listPaging";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { asList, filterProducts, lastPurchaseLabel, productCategoryGroups, productImage, slimListProducts, stockBadge, stockQtyLabel, stockRightLabel, stockRowSubtitle, type ProductCategory } from "../utils/productDisplay";
import { moveChange, parseStockMoves, type StockMove } from "../utils/stockMoves";

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
  const [movesFor, setMovesFor] = useState<Product | null>(null);
  const [moves, setMoves] = useState<StockMove[]>([]);
  const [movesBusy, setMovesBusy] = useState(false);
  const [shown, setShown] = useState(LIST_INITIAL_ROWS);

  const applyRows = useCallback((raw: unknown) => {
    try {
      const next = slimListProducts<Product>(raw);
      setRows(next);
      return next;
    } catch {
      setRows([]);
      return [];
    }
  }, []);

  useEffect(() => {
    const flag = Array.isArray(params.scan) ? params.scan[0] : params.scan;
    if (flag === "1" || flag === "true") setScan(true);
  }, [params.scan]);

  useEffect(() => {
    const mem = peekCachedRows<Product>("products", companyId);
    if (mem?.rows?.length) applyRows(mem.rows);
    readCachedRows<Product>("products", companyId).then((cached) => {
      if (cached?.rows?.length) applyRows(cached.rows);
    });
  }, [applyRows, companyId]);

  const load = useCallback(async (force = false) => {
    const cached = peekCachedRows<Product>("products", companyId) || await readCachedRows<Product>("products", companyId);
    if (cached?.rows?.length) applyRows(cached.rows);
    if (!force && cacheIsFresh(cached?.savedAt) && cached?.rows?.length) return;
    const waitForFirst = !cached?.rows?.length;
    if (force || waitForFirst) setRefreshing(true);
    try {
      const [data, catRows] = await Promise.all([
        get<Product[]>(client, "/products", { company_id: companyId, lite: true }),
        get<ProductCategory[]>(client, "/products/categories", { company_id: companyId }).catch(() => []),
      ]);
      const next = applyRows(data);
      setCats(asList<ProductCategory>(catRows));
      await writeCachedRows("products", companyId, next);
      setError(null);
    } catch (err) {
      if (!cached?.rows?.length) setError(apiErrorMessage(err, "Stok yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [applyRows, client, companyId]);

  useFocusEffect(useCallback(() => { load(false); }, [load]));

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

  const openMoves = async (p: Product) => {
    setMovesFor(p);
    setMoves([]);
    setMovesBusy(true);
    try {
      const data = await get<{
        movements?: StockMove[];
        items?: StockMove[];
        last_purchase_price?: number | null;
        last_purchase_supplier?: string | null;
        purchase_price?: number | null;
      }>(client, `/products/${idOf(p)}/movements`);
      setMoves(parseStockMoves(data));
      setMovesFor({
        ...p,
        last_purchase_price: data?.last_purchase_price ?? p.last_purchase_price,
        last_purchase_supplier: data?.last_purchase_supplier ?? p.last_purchase_supplier,
        purchase_price: data?.purchase_price ?? p.purchase_price,
      });
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Stok hareketleri yüklenemedi."));
    } finally {
      setMovesBusy(false);
    }
  };

  const catGroups = useMemo(() => productCategoryGroups(cats, rows), [cats, rows]);

  const matched = useMemo(() => {
    if (hit) return [hit];
    return filterProducts(rows, q, cat, 5000);
  }, [cat, hit, q, rows]);

  const filtered = useMemo(() => visibleRows(matched, shown), [matched, shown]);
  const hasMore = !hit && shown < matched.length;

  useEffect(() => {
    setShown(LIST_INITIAL_ROWS);
  }, [cat, q, hit]);

  return (
    <Screen
      onRefresh={() => load(true)}
      refreshing={refreshing}
      stickyTop={(
        <>
          <ActionTiles
            items={[
              ...(canEdit ? [{ key: "new", label: "Yeni kart", icon: "add-circle" as const, tone: "emerald" as const, testID: "stock-new", onPress: () => go("StockNew") }] : []),
              { key: "scan", label: "Barkod okut", icon: "barcode", tone: "indigo", testID: "stock-scan", onPress: () => setScan(true) },
              { key: "refresh", label: "Yenile", icon: "refresh", tone: "slate", testID: "stock-refresh", onPress: () => load(true) },
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
        </>
      )}
    >
        <ErrorBanner message={error} />
        {!filtered.length ? (
          <Empty icon="cube-outline" title="Ürün yok" hint={canEdit ? "Kategori veya aramayı değiştirin, ya da yeni stok kartı ekleyin." : "Kategori veya aramayı değiştirin, ya da barkod okutun."} />
        ) : filtered.map((p) => {
          const badge = stockBadge(p);
          const qty = stockQtyLabel(p);
          const qtyTone = badge?.tone === "danger" ? "red" : badge?.tone === "warning" ? "amber" : "green";
          const name = listRowText(p.name);
          return (
            <View key={idOf(p) || name} style={{ gap: 4 }}>
              <ListRow
                testID={`stock-row-${idOf(p)}`}
                leading={<ProductThumb uri={p.thumbnail_url || productImage(p)} />}
                title={name}
                titleLines={2}
                subtitle={[qty, stockRowSubtitle(p, productTypeTr(p.type), fmtMoney(p.sale_price))].filter(Boolean).join(" · ")}
                right={stockRightLabel(p)}
                rightColor={qtyTone === "red" ? colors.danger : qtyTone === "amber" ? colors.warning : colors.text}
                rightTestID={`stock-qty-${idOf(p)}`}
                onPress={canEdit ? () => go("StockDetail", { id: idOf(p), name }) : undefined}
              />
              <PrimaryButton title="Hareketler" onPress={() => openMoves(p)} color={colors.secondary} testID={`stock-moves-${idOf(p)}`} />
            </View>
          );
        })}
        {hasMore ? (
          <PrimaryButton
            title={`Daha fazla göster (${filtered.length} / ${matched.length})`}
            onPress={() => setShown((n) => nextRowLimit(n, matched.length))}
            color={colors.secondary}
            testID="stock-load-more"
          />
        ) : matched.length > LIST_INITIAL_ROWS ? (
          <Muted testID="stock-list-count">{matched.length} ürün</Muted>
        ) : null}
        <LazyBarcodeScanner visible={scan} onClose={() => setScan(false)} onScan={lookup} />
        {movesFor ? (
        <B2BSheet
          visible
          title="Stok hareketleri"
          subtitle={[listRowText(movesFor.name), lastPurchaseLabel(movesFor, fmtMoney)].filter(Boolean).join(" · ") || undefined}
          onClose={() => setMovesFor(null)}
          testID="stock-moves-sheet"
        >
          {movesBusy ? <Muted>Yükleniyor…</Muted> : null}
          {!movesBusy && !moves.length ? (
            <Muted testID="stock-moves-empty">
              {lastPurchaseLabel(movesFor, fmtMoney)
                ? `${lastPurchaseLabel(movesFor, fmtMoney)}. Fatura/sipariş satırı henüz düşmedi.`
                : "Fatura, sipariş veya sayım hareketi bulunamadı."}
            </Muted>
          ) : null}
          {moves.map((m, i) => {
            const change = moveChange(m);
            return (
              <ListRow
                key={idOf(m) || i}
                testID={`stock-move-${idOf(m) || i}`}
                title={`${change > 0 ? "+" : ""}${change}`}
                subtitle={[m.reason, fmtDate(m.date)].filter(Boolean).join(" · ")}
              />
            );
          })}
        </B2BSheet>
        ) : null}
    </Screen>
  );
}

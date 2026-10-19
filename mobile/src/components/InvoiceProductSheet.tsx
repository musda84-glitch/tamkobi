import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "../theme";
import type { Product } from "../types";
import {
  appendProductPage,
  FREQUENT_INVOICE_PRODUCTS,
  invoicePickAddLabel,
  invoicePickMeta,
  invoicePickStock,
  invoiceQtyForProduct,
  INVOICE_PRODUCT_SEARCH_DEBOUNCE_MS,
  mergeFreshProducts,
  parseInvoiceProductPage,
  productsFromIdsPayload,
  readFrequentInvoiceProducts,
} from "../utils/invoiceProductPick";
import { fmtMoney, idOf } from "../utils/money";
import { productImage } from "../utils/productDisplay";
import { B2BSheet } from "./b2b/B2BSheet";
import { Field, Muted, PrimaryButton } from "./kit";
import { productPickPrice } from "./ProductPickRow";
import { ProductThumb } from "./ProductThumb";

const STOCK_COLOR = {
  green: colors.primary,
  amber: colors.warning,
  red: colors.danger,
  muted: colors.muted,
} as const;

export function InvoiceProductSheet({
  visible,
  companyId,
  priceType = "sales",
  currency = "TRY",
  items,
  notice,
  search,
  fetchByIds,
  onClose,
  onAdd,
  onScan,
  onFreeLine,
  onServiceLine,
}: {
  visible: boolean;
  companyId: string;
  priceType?: "sales" | "purchase";
  currency?: string;
  items: Array<{ product_id?: string; quantity?: number }>;
  notice?: { tone: "ok" | "err"; text: string } | null;
  search: (q: string, page: number) => Promise<unknown>;
  fetchByIds?: (ids: string[]) => Promise<unknown>;
  onClose: () => void;
  onAdd: (picks: Array<{ product: Product; quantity: number }>) => void;
  onScan: () => void;
  onFreeLine: () => void;
  onServiceLine: () => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Product[]>([]);
  const [mode, setMode] = useState<"frequent" | "results">("frequent");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const req = useRef(0);
  const known = useRef(new Map<string, Product>());
  const searchRef = useRef(search);
  const fetchByIdsRef = useRef(fetchByIds);
  const companyRef = useRef(companyId);
  searchRef.current = search;
  fetchByIdsRef.current = fetchByIds;
  companyRef.current = companyId;

  for (const row of rows) {
    const id = idOf(row);
    if (id) known.current.set(id, row);
  }

  const loadServer = useCallback(async (q: string, pageNum: number, append: boolean, token: number) => {
    setLoading(true);
    try {
      const data = await searchRef.current(q, pageNum);
      if (token !== req.current) return;
      const parsed = parseInvoiceProductPage(data);
      setRows((prev) => (append ? appendProductPage(prev, parsed.items) : parsed.items));
      setHasMore(parsed.has_more);
      setPage(parsed.page || pageNum);
      setMode("results");
    } catch {
      if (token !== req.current) return;
      if (!append) {
        setRows([]);
        setHasMore(false);
        setMode("results");
      }
    } finally {
      if (token === req.current) setLoading(false);
    }
  }, []);

  const showFrequents = useCallback(async (token: number) => {
    let freq: Product[] = [];
    try {
      freq = await readFrequentInvoiceProducts(companyRef.current);
    } catch {
      freq = [];
    }
    if (token !== req.current) return;
    if (freq.length) {
      setMode("frequent");
      setRows(freq.slice(0, FREQUENT_INVOICE_PRODUCTS));
      setHasMore(false);
      setPage(1);
      setLoading(false);
      const ids = freq.map((row) => idOf(row)).filter(Boolean);
      if (!ids.length || !fetchByIdsRef.current) return;
      try {
        const fresh = productsFromIdsPayload(await fetchByIdsRef.current(ids));
        if (token !== req.current || !fresh.length) return;
        setRows(mergeFreshProducts(freq, fresh).slice(0, FREQUENT_INVOICE_PRODUCTS));
      } catch {
        /* kayıtlı kart fiyatı durur */
      }
      return;
    }
    await loadServer("", 1, false, token);
  }, [loadServer]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setPicked({});
      setRows([]);
      setHasMore(false);
      req.current += 1;
      return () => { req.current += 1; };
    }
    setPicked({});
    const token = ++req.current;
    void showFrequents(token);
    return () => { req.current += 1; };
  }, [visible, companyId, showFrequents]);

  useEffect(() => {
    if (!visible) return;
    const q = query.trim();
    if (!q) return;
    const token = ++req.current;
    const handle = setTimeout(() => {
      if (token !== req.current) return;
      void loadServer(q, 1, false, token);
    }, INVOICE_PRODUCT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, visible, loadServer]);

  const onQuery = (value: string) => {
    setQuery(value);
    if (value.trim()) return;
    const token = ++req.current;
    void showFrequents(token);
  };

  const loadMore = () => {
    if (!hasMore || loading || mode !== "results") return;
    const token = ++req.current;
    void loadServer(query.trim(), page + 1, true, token);
  };

  const select = (product: Product) => {
    const id = idOf(product);
    if (!id) return;
    known.current.set(id, product);
    setPicked((prev) => (prev[id] ? prev : { ...prev, [id]: 1 }));
  };

  const bump = (id: string, delta: number) => {
    setPicked((prev) => {
      const nextQty = (prev[id] || 0) + delta;
      if (nextQty <= 0) {
        const rest = { ...prev };
        delete rest[id];
        return rest;
      }
      return { ...prev, [id]: nextQty };
    });
  };

  const pickedCount = Object.keys(picked).length;
  const pickedQty = Object.values(picked).reduce((sum, qty) => sum + qty, 0);
  const section = mode === "frequent" ? "SIK KULLANILANLAR" : "ARAMA SONUÇLARI";

  const commit = () => {
    const picks = Object.entries(picked).flatMap(([id, quantity]) => {
      const product = known.current.get(id);
      return product && quantity > 0 ? [{ product, quantity }] : [];
    });
    if (!picks.length) return;
    onAdd(picks);
  };

  return (
    <B2BSheet
      visible={visible}
      title="Ürün ekle"
      onClose={onClose}
      testID="inv-product-sheet"
      showHandle
      header={(
        <View style={{ gap: 8 }}>
          {notice?.text ? (
            <View
              testID="inv-pick-banner"
              style={{
                backgroundColor: notice.tone === "err" ? "#FFF1F2" : "#D1FAE5",
                borderRadius: 10,
                paddingHorizontal: 10,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: notice.tone === "err" ? colors.danger : "#047857", fontWeight: "800" }}>{notice.text}</Text>
            </View>
          ) : null}
          <Field
            label="Ürün ara"
            testID="inv-prod-search"
            value={query}
            onChangeText={onQuery}
            placeholder="Ad / SKU / barkod"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              testID="inv-scan"
              accessibilityLabel="Barkod okut"
              onPress={onScan}
              style={{ flex: 1.15, backgroundColor: "#F59E0B", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6, alignItems: "center" }}
            >
              <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center", fontSize: 12 }}>📷 Barkod okut</Text>
            </Pressable>
            <View testID="inv-free-line" style={{ flex: 1 }}>
              <Pressable
                testID="inv-add-line"
                accessibilityLabel="Serbest satır"
                onPress={onFreeLine}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6, alignItems: "center" }}
              >
                <Text style={{ color: colors.text, fontWeight: "800", textAlign: "center", fontSize: 12 }}>✎ Serbest satır</Text>
              </Pressable>
            </View>
            <Pressable
              testID="inv-service-line"
              accessibilityLabel="Hizmet"
              onPress={onServiceLine}
              style={{ flex: 0.8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6, alignItems: "center" }}
            >
              <Text style={{ color: colors.text, fontWeight: "800", textAlign: "center", fontSize: 12 }}>🛠 Hizmet</Text>
            </Pressable>
          </View>
        </View>
      )}
      footer={(
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            onPress={onClose}
            style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ fontWeight: "800", color: colors.text }}>Vazgeç</Text>
          </Pressable>
          <View style={{ flex: 1.6 }}>
            <PrimaryButton
              title={invoicePickAddLabel(pickedCount, pickedQty)}
              testID="inv-pick-add"
              color="#F59E0B"
              disabled={pickedCount === 0}
              onPress={commit}
            />
          </View>
        </View>
      )}
    >
      <Text testID="inv-pick-section" style={{ fontSize: 11, fontWeight: "800", letterSpacing: 0.4, color: colors.muted, marginBottom: 6 }}>{section}</Text>
      {rows.map((product) => {
        const id = idOf(product);
        if (!id) return null;
        const qty = picked[id] || 0;
        const stock = invoicePickStock(product);
        const onInvoice = invoiceQtyForProduct(items, id);
        return (
          <View
            key={id}
            testID={`prod-pick-${id}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}
          >
            <ProductThumb uri={productImage(product)} size={42} testID={`prod-pick-thumb-${id}`} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontWeight: "800", color: colors.text }}>{product.name}</Text>
              <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 12 }}>{invoicePickMeta(product, onInvoice)}</Text>
            </View>
            <View style={{ alignItems: "flex-end", maxWidth: 96 }}>
              <Text numberOfLines={1} style={{ fontWeight: "800", color: colors.text }}>{fmtMoney(productPickPrice(product, priceType), currency)}</Text>
              <Text testID={`inv-pick-stock-${id}`} numberOfLines={1} style={{ color: STOCK_COLOR[stock.tone], fontWeight: "800", fontSize: 12 }}>{stock.label}</Text>
            </View>
            {qty > 0 ? (
              <View testID={`inv-pick-qty-${id}`} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Pressable
                  testID={`inv-pick-dec-${id}`}
                  accessibilityLabel="Adet azalt"
                  onPress={() => bump(id, -1)}
                  style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontWeight: "800", color: colors.text }}>−</Text>
                </Pressable>
                <Text style={{ minWidth: 18, textAlign: "center", fontWeight: "800", color: colors.text }}>{qty}</Text>
                <Pressable
                  testID={`inv-pick-inc-${id}`}
                  accessibilityLabel="Adet artır"
                  onPress={() => bump(id, 1)}
                  style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontWeight: "800", color: "#fff" }}>+</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                testID={`inv-pick-plus-${id}`}
                accessibilityLabel="Ürün seç"
                onPress={() => select(product)}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 20 }}>+</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      {!rows.length && !loading ? <Muted>Sonuç yok</Muted> : null}
      {loading ? <Muted>Aranıyor…</Muted> : null}
      {hasMore ? (
        <Pressable testID="inv-pick-more" onPress={loadMore} style={{ paddingVertical: 12, alignItems: "center" }}>
          <Text style={{ color: "#B45309", fontWeight: "800" }}>Daha fazla</Text>
        </Pressable>
      ) : null}
    </B2BSheet>
  );
}

import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { confirmAction } from "../components/chips";
import { ProductPickRow } from "../components/ProductPickRow";
import { Card, ErrorBanner, Field, H1, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { Order, Product } from "../types";
import { addOrBump, cartTotals, lineFromProduct, type CartLine } from "../utils/cart";
import { fmtMoney, idOf } from "../utils/money";
import { orderNumberLabel, statusTr } from "../utils/labels";
import {
  canStaffDeleteOrder,
  canStaffEditOrder,
  cartFromOrderItems,
  orderStatusOf,
  orderUpdatePayload,
  setCartLineQty,
} from "../utils/orderEdit";

export function OrderFormScreen() {
  const { client, companyId, can } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const canEdit = can("/orders", "edit") || can("/saha", "edit");
  const [order, setOrder] = useState<Order | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [notes, setNotes] = useState("");
  const [po, setPo] = useState("");
  const [prodQ, setProdQ] = useState("");
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, p] = await Promise.all([
        get<Order>(client, `/orders/${id}`),
        get<Product[]>(client, "/products", { company_id: companyId, lite: true }).catch(() => []),
      ]);
      setOrder(o);
      setProducts((p || []).filter((x) => x.is_active !== false && x.type !== "raw_material"));
      setCart(cartFromOrderItems(o.items));
      setNotes(o.notes || o.order_note || "");
      setPo(o.customer_order_number || "");
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Sipariş yüklenemedi."));
    }
  }, [client, companyId, id]);

  useEffect(() => { load(); }, [load]);

  const prodHits = useMemo(() => {
    const q = prodQ.trim().toLowerCase();
    if (q.length < 2) return [];
    return products.filter((p) => [p.name, p.sku, p.barcode].some((v) => String(v || "").toLowerCase().includes(q))).slice(0, 8);
  }, [prodQ, products]);

  const totals = cartTotals(cart);
  const editable = !!(order && canEdit && canStaffEditOrder(order));
  const deletable = !!(order && canEdit && canStaffDeleteOrder(order));

  const addProduct = (p: Product) => {
    setCart((prev) => addOrBump(prev, lineFromProduct(p as unknown as Record<string, unknown>), 1));
    setProdQ("");
    setMessage(`${p.name} eklendi`);
  };

  const lookupBarcode = async (code: string) => {
    const local = products.find((p) => p.barcode === code || p.sku === code);
    if (local) { addProduct(local); return; }
    try {
      const p = await get<Product>(client, `/products/barcode/${encodeURIComponent(code)}`, { company_id: companyId });
      addProduct(p);
    } catch (err) {
      setError(apiErrorMessage(err, "Barkod ile ürün bulunamadı."));
    }
  };

  const save = async () => {
    if (!order || !editable) { setError("Bu sipariş düzenlenemez."); return; }
    if (!cart.length) { setError("Siparişte en az bir ürün olmalı."); return; }
    setBusy(true);
    try {
      const r = await put<{ message?: string; order?: Order }>(client, `/orders/${idOf(order)}`, orderUpdatePayload(cart, notes, po));
      setMessage(r.message || "Sipariş güncellendi.");
      setError(null);
      if (r.order) {
        setOrder(r.order);
        setCart(cartFromOrderItems(r.order.items));
      } else {
        await load();
      }
    } catch (err) {
      setError(apiErrorMessage(err, "Sipariş güncellenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!order || !deletable) { setError("Bu sipariş silinemez."); return; }
    confirmAction(
      "Siparişi sil",
      `${orderNumberLabel(order)} çöp kutusuna taşınsın mı?`,
      async () => {
        setBusy(true);
        try {
          await del(client, `/orders/${idOf(order)}`);
          router.back();
        } catch (err) {
          setError(apiErrorMessage(err, "Silinemedi."));
          setBusy(false);
        }
      },
    );
  };

  if (!order) return <Screen><ErrorBanner message={error || "Yükleniyor…"} /></Screen>;

  return (
    <Screen onRefresh={load}>
      <H1>{orderNumberLabel(order)}</H1>
      <Muted>{order.customer_name} · {statusTr(orderStatusOf(order))}</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}
      {!editable ? <Muted>Faturalanmış, iptal veya pazaryeri siparişi düzenlenemez.</Muted> : null}

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "800", color: colors.text }}>Kalemler</Text>
          {editable ? <PrimaryButton title="Barkod" onPress={() => setScan(true)} /> : null}
        </Row>
        {editable ? (
          <>
            <Field label="Ürün ara" value={prodQ} onChangeText={setProdQ} placeholder="Ad / SKU / barkod" testID="order-edit-search" />
            {prodHits.map((p) => (
              <ProductPickRow key={idOf(p)} product={p} onPress={() => addProduct(p)} />
            ))}
          </>
        ) : null}
        {!cart.length ? <Muted>Kalem yok.</Muted> : cart.map((it, i) => (
          <Row key={`${it.product_id}-${i}`} style={{ justifyContent: "space-between", alignItems: "center" }} testID={`order-edit-line-${i}`}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontWeight: "700", color: colors.text }} numberOfLines={2}>{it.product_name}</Text>
              <Muted>{it.sku ? `${it.sku} · ` : ""}{fmtMoney(it.unit_price_incl || it.unit_price)}</Muted>
            </View>
            {editable ? (
              <>
                <Pressable testID={`order-edit-dec-${i}`} onPress={() => setCart((c) => setCartLineQty(c, i, it.quantity - 1))} accessibilityLabel="Azalt">
                  <Ionicons name="remove-circle" size={26} color={colors.muted} />
                </Pressable>
                <Text style={{ fontWeight: "800", width: 28, textAlign: "center", color: colors.text }}>{it.quantity}</Text>
                <Pressable testID={`order-edit-inc-${i}`} onPress={() => setCart((c) => setCartLineQty(c, i, it.quantity + 1))} accessibilityLabel="Artır">
                  <Ionicons name="add-circle" size={26} color={colors.primary} />
                </Pressable>
              </>
            ) : (
              <Text style={{ fontWeight: "800", color: colors.text, marginHorizontal: 8 }}>{it.quantity}×</Text>
            )}
            <Text style={{ fontWeight: "800", color: colors.text, marginLeft: 8 }}>{fmtMoney(it.total_incl)}</Text>
          </Row>
        ))}
        <Field label="Sipariş notu" value={notes} onChangeText={setNotes} testID="order-edit-notes" editable={editable} />
        <Field label="Müşteri sipariş no" value={po} onChangeText={setPo} testID="order-edit-po" editable={editable} autoCapitalize="none" />
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>Toplam</Text>
          <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }} testID="order-edit-total">{fmtMoney(totals.totalIncl)}</Text>
        </Row>
        {editable ? (
          <PrimaryButton title={busy ? "Kaydediliyor…" : "Kaydet"} onPress={save} loading={busy} color={colors.primary} testID="order-edit-save" />
        ) : null}
        {deletable ? (
          <PrimaryButton title="Sil" onPress={remove} color={colors.danger} testID="order-edit-delete" disabled={busy} />
        ) : null}
      </Card>
      <BarcodeScannerModal visible={scan} onClose={() => setScan(false)} onScan={lookupBarcode} />
    </Screen>
  );
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Pressable, Share, Text, TextInput, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BAiCartPanel } from "../components/b2b/B2BAiCartPanel";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { B2BTopBar } from "../components/b2b/B2BTopBar";
import { B2BTrackingCard } from "../components/b2b/B2BTrackingCard";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { confirmAction } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Badge, Card, Empty, ErrorBanner, Field, Kpi, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { B2BPortal, B2BProduct, Order } from "../types";
import { addCartLine, b2bFlashChrome, cartCount, formatCartSheetMeta, formatOrderItemLabel, parseStoredCart, productCartQty, setCartLineQty, type B2BCart } from "../utils/b2bCart";
import { isLegalAccepted, legalAcceptPayload, seedLegalAccept, toggleLegalAccept, type LegalAcceptMap } from "../utils/b2bLegal";
import { applyB2BScan, canAddProduct, categorySelectGroups, filterCatalog, hasListDiscount, normalizeScanText, parseDraftQty, qtyDraftOnBlur, qtyDraftOnFocus, qtyDraftShown } from "../utils/b2bCatalog";
import {
  addEditProduct,
  canCancelOrder,
  canEditOrder,
  cancelBadge,
  editLinesFromOrder,
  installmentDueText,
  installmentRemaining,
  installmentTitle,
  invoiceRemaining,
  payStatus,
  previewLineCode,
  previewLineImage,
  setEditQty,
  type EditLine,
} from "../utils/b2bOrders";
import { b2bGross, b2bNet, b2bOrderGross } from "../utils/b2bPricing";
import { statusTr } from "../utils/labels";
import { resolveMediaUrl } from "../utils/media";
import { fmtDate, fmtMoney, idOf, setPriceDecimals } from "../utils/money";

type TabId = "catalog" | "orders" | "statement" | "installments";

const TABS: { id: TabId; label: string; flag?: keyof B2BPortal["settings"] }[] = [
  { id: "catalog", label: "Ürünler" },
  { id: "orders", label: "Siparişlerim" },
  { id: "statement", label: "Hesap Ekstresi", flag: "show_statement" },
  { id: "installments", label: "Taksitlerim", flag: "show_installments" },
];

function CatalogTile({
  product: p,
  img,
  showPrices,
  showStock,
  allowOrders,
  qty,
  note,
  inCart,
  added,
  onQty,
  onNote,
  onAdd,
}: {
  product: B2BProduct;
  img?: string | null;
  showPrices: boolean;
  showStock: boolean;
  allowOrders: boolean;
  qty: string;
  note: string;
  inCart: number;
  added: boolean;
  onQty: (v: string) => void;
  onNote: (v: string) => void;
  onAdd: () => void;
}) {
  const listCut = showPrices && hasListDiscount(p);
  const addOk = canAddProduct(p, showStock, allowOrders);
  const stockOut = p.in_stock === false;
  return (
    <Card testID={`b2b-product-${p.id}`} style={{ flex: 1, padding: 10, gap: 8 }}>
      <View
        testID={`b2b-image-${p.id}`}
        style={{
          aspectRatio: 1.5,
          borderRadius: 12,
          backgroundColor: colors.slate50,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {img ? (
          <Image source={{ uri: img }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
        ) : (
          <Ionicons name="cube-outline" size={28} color={colors.muted} />
        )}
        {inCart > 0 ? (
          <View
            testID={`b2b-in-cart-${p.id}`}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              flexDirection: "row",
              alignItems: "center",
              gap: 3,
              minHeight: 22,
              paddingHorizontal: 6,
              borderRadius: 999,
              backgroundColor: added ? colors.primaryHover : colors.primary,
            }}
          >
            <Ionicons name="checkmark" size={12} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{inCart}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ minWidth: 0, flex: 1 }}>
        <Text numberOfLines={2} style={{ fontWeight: "800", fontSize: 12, lineHeight: 16, color: colors.text }}>{p.name}</Text>
        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, monospace" }) }}>
          {[p.sku, p.barcode].filter(Boolean).join(" · ")}
        </Text>
        {p.tags?.length ? (
          <Row style={{ flexWrap: "wrap", gap: 4, marginTop: 2 }}>
            {p.tags.slice(0, 3).map((t) => <Badge key={t} label={t} />)}
          </Row>
        ) : null}
      </View>
      <Row style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {showPrices ? (
            <>
              <Text numberOfLines={1} style={{ fontWeight: "900", fontSize: 15, color: colors.text }}>{fmtMoney(b2bGross(p))}</Text>
              {listCut ? <Text style={{ color: colors.muted, textDecorationLine: "line-through", fontSize: 10 }}>{fmtMoney(b2bGross(p, "list_price"))}</Text> : null}
              <Text style={{ color: colors.muted, fontSize: 10 }}>{Number(p.vat_rate) ? `KDV %${p.vat_rate} dahil` : "KDV'siz"} · {p.unit || "Adet"}</Text>
            </>
          ) : <Muted>Fiyat gizli</Muted>}
        </View>
        {showStock ? (
          <Text style={{ color: stockOut ? colors.danger : colors.primaryHover, fontWeight: "700", fontSize: 10 }}>
            {stockOut ? "Yok" : p.stock_quantity == null ? "Stokta" : `Stok ${p.stock_quantity}`}
          </Text>
        ) : null}
      </Row>
      {allowOrders ? (
        <View style={{ gap: 6 }}>
          <View>
            <Text style={{ fontSize: 9, fontWeight: "700", color: colors.muted, marginBottom: 2 }}>SİPARİŞ STOK NOTU</Text>
            <TextInput
              testID={`b2b-item-note-${p.id}`}
              value={note}
              onChangeText={onNote}
              placeholder="Fişte stok açıklamasının altında basılır"
              placeholderTextColor={colors.muted}
              style={{
                minHeight: 32,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
                paddingHorizontal: 8,
                paddingVertical: 6,
                fontSize: 10,
                color: colors.text,
                backgroundColor: colors.slate50,
              }}
            />
          </View>
          <Row>
            <View style={{ width: 48, borderWidth: 2, borderColor: colors.slate200, borderRadius: 12, backgroundColor: colors.slate50, paddingVertical: 2 }}>
              <Text style={{ fontSize: 8, fontWeight: "700", color: colors.muted, textAlign: "center" }}>Adet</Text>
              <TextInput
                testID={`b2b-add-qty-${p.id}`}
                value={qty}
                keyboardType="number-pad"
                onFocus={() => onQty(qtyDraftOnFocus())}
                onBlur={() => onQty(qtyDraftOnBlur(qty))}
                onChangeText={(v) => onQty(v.replace(/\D/g, ""))}
                style={{ textAlign: "center", fontWeight: "900", fontSize: 14, color: colors.text, paddingVertical: 2 }}
              />
            </View>
            <Pressable
              testID={`b2b-add-${p.id}`}
              onPress={onAdd}
              disabled={!addOk}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                backgroundColor: added ? colors.primaryHover : colors.primary,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                opacity: addOk ? 1 : 0.5,
              }}
            >
              <Ionicons name={added ? "checkmark-circle" : "cart-outline"} size={16} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>{added ? "Eklendi" : "Ekle"}</Text>
            </Pressable>
          </Row>
        </View>
      ) : null}
    </Card>
  );
}

function Chip({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 999,
        backgroundColor: active ? colors.secondary : "#fff",
        borderWidth: 1,
        borderColor: active ? colors.secondary : colors.border,
      }}
    >
      <Text style={{ color: active ? "#fff" : colors.text, fontWeight: "700", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function cartStorageKey(token: string) {
  return `tamkobi.b2bCart.${token}`;
}

function copyText(value: string) {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(value).catch(() => Share.share({ message: value }));
    return;
  }
  Share.share({ message: value }).catch(() => null);
}

export function B2BPortalScreen() {
  const { client, b2bToken, b2bName, logout, baseUrl } = useAuth();
  const [data, setData] = useState<B2BPortal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabId>("catalog");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useState<B2BCart>({});
  const [draftQty, setDraftQty] = useState<Record<string, string>>({});
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [customerOrderNo, setCustomerOrderNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [scan, setScan] = useState(false);
  const [scanQty, setScanQty] = useState("1");
  const [scanStatus, setScanStatus] = useState("");
  const [done, setDone] = useState<Order | null>(null);
  const [preview, setPreview] = useState<Order | null>(null);
  const [edit, setEdit] = useState<Order | null>(null);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editNote, setEditNote] = useState("");
  const [editAdd, setEditAdd] = useState("");
  const [cancel, setCancel] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [legal, setLegal] = useState<{ title: string; text: string } | null>(null);
  const [legalAccept, setLegalAccept] = useState<LegalAcceptMap>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!b2bToken) return;
    setRefreshing(true);
    try {
      const portal = await get<B2BPortal>({ ...client, token: null }, `/public/b2b/${b2bToken}`);
      setPriceDecimals(portal?.company?.price_decimals);
      setData(portal);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Portal yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [b2bToken, client]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!b2bToken) return;
    AsyncStorage.getItem(cartStorageKey(b2bToken)).then((raw) => setCart(parseStoredCart(raw || "{}")));
  }, [b2bToken]);

  useEffect(() => {
    if (!b2bToken) return;
    AsyncStorage.setItem(cartStorageKey(b2bToken), JSON.stringify(cart));
  }, [b2bToken, cart]);

  const settings = data?.settings || {};
  const showPrices = settings.show_prices !== false;
  const showStock = settings.show_stock !== false;
  const allowOrders = settings.allow_orders !== false;
  const allowAiCart = allowOrders && settings.allow_ai_cart !== false;
  const minOrder = Number(settings.min_order_amount) || 0;
  const tabs = useMemo(() => TABS.filter((t) => !t.flag || settings[t.flag] !== false), [settings]);
  const installments = Array.isArray(data?.installments) ? data.installments : [];

  useEffect(() => {
    if (!data) return;
    if (!tabs.some((t) => t.id === tab)) setTab("catalog");
  }, [data, tabs, tab]);

  useEffect(() => {
    setLegalAccept((cur) => seedLegalAccept(cur, data?.legal));
  }, [data?.legal]);

  const products = data?.products || [];
  const catGroups = useMemo(() => categorySelectGroups(products), [products]);
  const prods = useMemo(() => filterCatalog(products, q, cat), [products, q, cat]);
  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([key, row]) => ({ key, p: products.find((x) => x.id === row.productId), qty: row.qty, note: row.note || "" }))
        .filter((l): l is { key: string; p: B2BProduct; qty: number; note: string } => !!l.p && l.qty > 0),
    [cart, products]
  );
  const sub = lines.reduce((s, l) => s + b2bNet(l.p) * l.qty, 0);
  const vat = lines.reduce((s, l) => s + (b2bGross(l.p) - b2bNet(l.p)) * l.qty, 0);
  const cartTotal = sub + vat;
  const count = cartCount(cart);
  const flash = b2bFlashChrome(flashOn);

  const addProduct = (p: B2BProduct) => {
    if (!canAddProduct(p, showStock, allowOrders)) return;
    const qty = parseDraftQty(draftQty[p.id]);
    setCart((c) => addCartLine(c, p.id, qty, draftNotes[p.id] || ""));
    setAddedId(p.id);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAddedId(null), 1600);
    setMessage(`${p.name} sepete eklendi (${qty})`);
  };

  const addFromScan = (code: string) => {
    const hit = applyB2BScan({ products, code, qty: scanQty, allowOrders, showStock });
    setScanStatus(hit.message);
    setQ(normalizeScanText(code));
    if (hit.action === "add" && hit.product) {
      setCart((c) => addCartLine(c, hit.product.id, hit.qty, draftNotes[hit.product.id] || ""));
      setAddedId(hit.product.id);
      if (addedTimer.current) clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => setAddedId(null), 1600);
      setMessage(hit.message);
    }
  };

  useEffect(() => () => {
    if (addedTimer.current) clearTimeout(addedTimer.current);
  }, []);

  useEffect(() => {
    if (!message) {
      setFlashOn(false);
      return undefined;
    }
    setFlashOn(false);
    const t = setTimeout(() => setFlashOn(true), 60);
    return () => clearTimeout(t);
  }, [message]);

  const submitOrder = async () => {
    if (!allowOrders || !b2bToken) return;
    if (minOrder > 0 && cartTotal + 1e-9 < minOrder) {
      setError(`Minimum sipariş tutarı ${fmtMoney(minOrder)}.`);
      return;
    }
    if (!lines.length) {
      setError("Sepet boş.");
      return;
    }
    setBusy(true);
    try {
      const res = await post<{ message?: string; order?: Order }>(
        { ...client, token: null },
        `/public/b2b/${b2bToken}/orders`,
        {
          items: lines.map((l) => ({ product_id: l.p.id, quantity: l.qty, note: l.note || "" })),
          note,
          customer_order_number: customerOrderNo.trim(),
          ...legalAcceptPayload(legalAccept),
        }
      );
      setDone(res.order || null);
      setCart({});
      setNote("");
      setCustomerOrderNo("");
      setCartOpen(false);
      setMessage(res.message || "Sipariş gönderildi.");
      setError(null);
      setTab("orders");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Sipariş gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (!b2bToken) return;
    if (newPw !== newPw2) {
      setError("Yeni şifreler eşleşmiyor.");
      return;
    }
    setBusy(true);
    try {
      await post({ ...client, token: null }, `/public/b2b/${b2bToken}/change-password`, {
        current_password: currentPw,
        new_password: newPw,
      });
      setMessage("Şifreniz güncellendi.");
      setError(null);
      setPwOpen(false);
      setCurrentPw("");
      setNewPw("");
      setNewPw2("");
    } catch (err) {
      setError(apiErrorMessage(err, "Şifre değiştirilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (o: Order) => {
    setEdit(o);
    setEditLines(editLinesFromOrder(o.items));
    setEditNote(o.notes || "");
    setEditAdd("");
  };

  const saveEdit = async () => {
    if (!b2bToken || !edit) return;
    if (!editLines.length) {
      setError("Siparişte en az bir ürün olmalı.");
      return;
    }
    setBusy(true);
    try {
      const res = await put<{ message?: string }>(
        { ...client, token: null },
        `/public/b2b/${b2bToken}/orders/${idOf(edit)}`,
        { items: editLines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })), note: editNote }
      );
      setMessage(res.message || "Sipariş güncellendi.");
      setEdit(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Güncellenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const removeOrder = async (o: Order) => {
    if (!b2bToken) return;
    setBusy(true);
    try {
      const res = await del<{ message?: string }>({ ...client, token: null }, `/public/b2b/${b2bToken}/orders/${idOf(o)}`);
      setMessage(res.message || "Sipariş silindi.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Silinemedi."));
    } finally {
      setBusy(false);
    }
  };

  const sendCancel = async () => {
    if (!b2bToken || !cancel) return;
    setBusy(true);
    try {
      const res = await post<{ message?: string }>(
        { ...client, token: null },
        `/public/b2b/${b2bToken}/orders/${idOf(cancel)}/cancel-request`,
        { reason: cancelReason }
      );
      setMessage(res.message || "İptal talebi gönderildi.");
      setCancel(null);
      setCancelReason("");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Talep gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const openLegal = async (slug: string, title: string) => {
    if (!b2bToken) return;
    try {
      const doc = await get<{ title?: string; text?: string; html?: string }>({ ...client, token: null }, `/public/b2b/${b2bToken}/legal/${slug}`);
      setLegal({ title: doc.title || title, text: doc.text || "" });
    } catch (err) {
      setError(apiErrorMessage(err, "Belge açılamadı."));
    }
  };

  const logo = resolveMediaUrl(baseUrl, data?.company?.logo_url);
  const bal = data?.contact?.balance || 0;
  const inStockProducts = products.filter((p) => p.in_stock !== false);

  return (
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyTop={
        <View testID="b2b-portal-top" style={{ gap: 8 }}>
          <B2BTopBar
            logo={logo}
            company={data?.company?.name}
            contact={data?.contact?.name || b2bName}
            count={count}
            ping={!!addedId}
            allowOrders={allowOrders}
            onCart={() => setCartOpen(true)}
            onMenu={() => setMenuOpen(true)}
          />
          {message ? (
            <View
              testID="b2b-flash-message"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                borderWidth: 2,
                borderStyle: flash.borderStyle,
                borderColor: flash.borderColor,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: flash.backgroundColor,
                ...(Platform.OS === "web" ? { transition: "background-color 220ms ease, border-color 220ms ease" } : null),
              }}
            >
              <Ionicons name="checkmark-circle" size={18} color={flash.icon} />
              <Text style={{ flex: 1, color: flash.text, fontWeight: "700" }}>{message}</Text>
              <Pressable onPress={() => setMessage(null)} hitSlop={8} testID="b2b-flash-close">
                <Ionicons name="close" size={18} color={flash.icon} />
              </Pressable>
            </View>
          ) : null}
        </View>
      }
    >
      <View testID="b2b-portal">
        <ErrorBanner message={error} />
        {done ? (
          <Card testID="b2b-order-done">
            <Text style={{ fontWeight: "800", color: colors.primaryHover }}>Sipariş alındı · {done.order_number}</Text>
            <Muted>
              {done.customer_order_number ? `Sizin no ${done.customer_order_number} · ` : ""}
              {fmtMoney(b2bOrderGross(done))} · Onaylandığında kargo takip numarası burada görünecek.
            </Muted>
          </Card>
        ) : null}
        {settings.welcome_note ? (
          <Card>
            <Text style={{ color: colors.text }}>{settings.welcome_note}</Text>
          </Card>
        ) : null}
        <Row>
          <Kpi label="Cari bakiye" value={fmtMoney(Math.abs(bal))} sub={bal > 0 ? "Borcunuz" : bal < 0 ? "Alacağınız" : "Bakiye yok"} />
          <Kpi label="İskonto" value={`%${Number(data?.contact?.discount || 0)}`} sub={`${count} ürün sepette`} />
        </Row>
        <Row style={{ flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <Chip
              key={t.id}
              label={t.id === "orders" && data?.orders?.length ? `${t.label} (${data.orders.length})` : t.id === "installments" && installments.length ? `${t.label} (${installments.length})` : t.label}
              active={tab === t.id}
              onPress={() => setTab(t.id)}
              testID={`b2b-tab-${t.id}`}
            />
          ))}
        </Row>

        {tab === "catalog" ? (
          <View>
            {!allowOrders ? (
              <Card testID="b2b-orders-closed">
                <Text style={{ color: "#B45309", fontWeight: "700" }}>Bu portalda sipariş alımı kapalı. Ürünleri inceleyebilirsiniz.</Text>
              </Card>
            ) : null}
            {allowAiCart && b2bToken ? (
              <B2BAiCartPanel
                client={client}
                token={b2bToken}
                products={products}
                onApply={(sel) => {
                  setCart((c) => sel.reduce((n, i) => addCartLine(n, i.product_id, i.quantity, ""), c));
                  setMessage(`${sel.length} kalem sepete eklendi`);
                }}
              />
            ) : null}
            {catGroups.some((g) => g.label === "Kategoriler") ? (
              <GroupedSelect
                label="Kategori"
                testID="b2b-cat"
                value={cat}
                onChange={setCat}
                groups={catGroups}
              />
            ) : null}
            <Row>
              <TextInput
                testID="b2b-search"
                value={q}
                onChangeText={setQ}
                placeholder="Ürün, kod, barkod veya etiket ara"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  fontSize: 16,
                  color: colors.text,
                  backgroundColor: "#fff",
                }}
              />
              <Pressable
                testID="b2b-scan"
                onPress={() => setScan(true)}
                style={{ paddingHorizontal: 12, minHeight: 48, justifyContent: "center", alignItems: "center" }}
              >
                <Ionicons name="barcode-outline" size={26} color={colors.indigo} />
                <Text style={{ color: colors.indigo, fontSize: 10, fontWeight: "800" }}>Okut</Text>
              </Pressable>
            </Row>
            {!prods.length ? <Empty icon="cube-outline" title="Ürün yok" hint={q ? "Aramayı daraltın." : "Katalog boş."} /> : (
              <View testID="b2b-catalog-grid" style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 }}>
                {prods.slice(0, 200).map((p) => (
                  <View key={p.id} style={{ width: "50%", paddingHorizontal: 4, paddingBottom: 8 }}>
                    <CatalogTile
                      product={p}
                      img={resolveMediaUrl(baseUrl, p.image_url)}
                      showPrices={showPrices}
                      showStock={showStock}
                      allowOrders={allowOrders}
                      qty={qtyDraftShown(draftQty, p.id)}
                      note={draftNotes[p.id] || ""}
                      inCart={productCartQty(cart, p.id)}
                      added={addedId === p.id}
                      onQty={(v) => setDraftQty((dq) => ({ ...dq, [p.id]: v }))}
                      onNote={(v) => setDraftNotes((n) => ({ ...n, [p.id]: v }))}
                      onAdd={() => addProduct(p)}
                    />
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {tab === "orders" ? (
          <View testID="b2b-orders">
            {!data?.orders?.length ? <Empty icon="cart-outline" title="Henüz sipariş yok" /> : data.orders.map((o) => {
              const oid = String(o.id || o._id || o.order_number);
              const extra = cancelBadge(o);
              return (
                <Card key={oid} testID={`b2b-order-${o.order_number}`}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Text style={{ fontWeight: "800", color: colors.text }}>{o.order_number}</Text>
                    <Badge label={statusTr(o.order_status)} tone={o.order_status === "cancelled" ? "red" : o.order_status === "delivered" ? "green" : "amber"} />
                  </Row>
                  {extra ? <Badge label={extra} tone="amber" /> : null}
                  <Muted>{fmtDate(o.order_date)}{o.customer_order_number ? ` · Sizin no ${o.customer_order_number}` : ""}</Muted>
                  <Muted>{(o.items || []).map((it) => formatOrderItemLabel(it as { quantity?: number; product_name?: string; name?: string; note?: string })).join(", ")}</Muted>
                  <Text style={{ fontWeight: "800", color: colors.text }}>{fmtMoney(b2bOrderGross(o))}</Text>
                  <B2BTrackingCard tracking={o.tracking} orderNumber={o.order_number} />
                  <Row style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    <Pressable testID={`b2b-order-preview-${o.order_number}`} onPress={() => setPreview(o)}>
                      <Text style={{ color: colors.indigo, fontWeight: "800" }}>Önizle</Text>
                    </Pressable>
                    {canEditOrder(o) ? (
                      <>
                        <Pressable testID={`b2b-order-edit-${o.order_number}`} onPress={() => openEdit(o)}>
                          <Text style={{ color: colors.text, fontWeight: "800" }}>Düzenle</Text>
                        </Pressable>
                        <Pressable testID={`b2b-order-delete-${o.order_number}`} onPress={() => removeOrder(o)}>
                          <Text style={{ color: colors.danger, fontWeight: "800" }}>Sil</Text>
                        </Pressable>
                      </>
                    ) : null}
                    {canCancelOrder(o) ? (
                      <Pressable testID={`b2b-order-cancel-${o.order_number}`} onPress={() => setCancel(o)}>
                        <Text style={{ color: "#B45309", fontWeight: "800" }}>İptal talebi</Text>
                      </Pressable>
                    ) : null}
                  </Row>
                </Card>
              );
            })}
          </View>
        ) : null}

        {tab === "statement" ? (
          <View testID="b2b-statement">
            <Card>
              <Text style={{ fontWeight: "800", color: colors.text }}>Faturalarım</Text>
              <Muted>
                Güncel bakiye: {fmtMoney(Math.abs(bal))} {bal > 0 ? "(borcunuz)" : bal < 0 ? "(alacağınız)" : ""}
              </Muted>
              {data?.company?.iban ? (
                <Pressable onPress={() => copyText([data.company.bank_name, data.company.iban].filter(Boolean).join(" "))}>
                  <Muted>Ödeme: {data.company.bank_name} {data.company.iban} · kopyala</Muted>
                </Pressable>
              ) : null}
            </Card>
            {!data?.invoices?.length ? <Empty icon="document-text-outline" title="Fatura yok" /> : data.invoices.map((i) => {
              const remain = invoiceRemaining(i);
              return (
                <ListRow
                  key={i.invoice_number}
                  title={i.invoice_number || "Fatura"}
                  subtitle={`Tarih ${fmtDate(i.issue_date)}${i.due_date ? ` · Vade ${fmtDate(i.due_date)}` : ""} · ${statusTr(payStatus(i.payment_status))} · ödenen ${fmtMoney(i.paid_amount)}`}
                  right={fmtMoney(i.grand_total)}
                  rightSub={remain > 0.01 ? `kalan ${fmtMoney(remain)}` : undefined}
                  rightSubColor={remain > 0.01 ? colors.danger : undefined}
                />
              );
            })}
          </View>
        ) : null}

        {tab === "installments" ? (
          <View testID="b2b-installments">
            {!installments.length ? <Empty icon="calendar-outline" title="Açık taksit yok" /> : installments.map((row) => (
              <ListRow
                key={String(row.id || row._id || `${row.invoice_number}-${row.no}`)}
                title={installmentTitle(row)}
                subtitle={installmentDueText(row)}
                right={fmtMoney(installmentRemaining(row))}
                rightSubColor={row.is_overdue ? colors.danger : undefined}
              />
            ))}
          </View>
        ) : null}

      </View>

      <B2BSheet visible={cartOpen} title={`Sepet · ${count} kalem`} onClose={() => setCartOpen(false)} testID="b2b-cart">
        {!lines.length ? <Empty icon="cart-outline" title="Sepet boş" /> : (
          <View>
            {lines.map((l) => (
              <View
                key={l.key}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  marginBottom: 8,
                  backgroundColor: "#fff",
                }}
              >
                <Row style={{ alignItems: "center", gap: 6 }}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text
                      testID={`b2b-cart-line-${l.p.id}`}
                      numberOfLines={2}
                      style={{ color: colors.text, fontWeight: "700", fontSize: 12, lineHeight: 16 }}
                    >
                      {l.p.name}
                    </Text>
                    <Text
                      testID={`b2b-cart-line-meta-${l.p.id}`}
                      numberOfLines={1}
                      style={{ color: colors.muted, fontWeight: "700", fontSize: 12, lineHeight: 16 }}
                    >
                      {formatCartSheetMeta(l.qty, showPrices ? fmtMoney(b2bGross(l.p)) : "", l.note)}
                    </Text>
                  </View>
                  <Pressable onPress={() => setCart((c) => setCartLineQty(c, l.key, l.qty - 1))} testID={`b2b-qty-dec-${l.p.id}`}>
                    <Ionicons name="remove-circle" size={22} color={colors.muted} />
                  </Pressable>
                  <Pressable onPress={() => setCart((c) => setCartLineQty(c, l.key, l.qty + 1))} testID={`b2b-qty-inc-${l.p.id}`}>
                    <Ionicons name="add-circle" size={22} color={colors.primary} />
                  </Pressable>
                  <Pressable onPress={() => setCart((c) => setCartLineQty(c, l.key, 0))} testID={`b2b-qty-del-${l.p.id}`}>
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </Row>
              </View>
            ))}
            {showPrices ? (
              <View>
                <Muted>Ara toplam {fmtMoney(sub)} · KDV {fmtMoney(vat)}</Muted>
                <Text style={{ fontWeight: "800", color: colors.text, fontSize: 18 }}>{fmtMoney(cartTotal)}</Text>
                {minOrder > 0 ? <Muted>Minimum sipariş {fmtMoney(minOrder)}</Muted> : null}
              </View>
            ) : null}
            <Field label="Sipariş notu (teslimat, adres…)" value={note} onChangeText={setNote} testID="b2b-order-note" />
            <Field label="Sizin sipariş no" value={customerOrderNo} onChangeText={setCustomerOrderNo} testID="b2b-po-number" autoCapitalize="none" />
            {(data?.legal || []).length ? (
              <View
                testID="b2b-legal-consent"
                style={{
                  gap: 8,
                  padding: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.slate50,
                }}
              >
                {data?.legal?.map((doc) => {
                  const checked = isLegalAccepted(legalAccept, doc.slug);
                  return (
                    <Row key={doc.slug} style={{ alignItems: "center", gap: 8 }}>
                      <Pressable
                        onPress={() => setLegalAccept((cur) => toggleLegalAccept(cur, doc.slug))}
                        testID={`b2b-legal-check-${doc.slug}`}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                        hitSlop={8}
                      >
                        <Ionicons name={checked ? "checkbox" : "square-outline"} size={20} color={checked ? colors.primary : colors.muted} />
                      </Pressable>
                      <Pressable onPress={() => openLegal(doc.slug, doc.title)} testID={`b2b-legal-${doc.slug}`} style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: colors.indigo, fontWeight: "700", fontSize: 12 }}>
                          {doc.title}
                        </Text>
                      </Pressable>
                    </Row>
                  );
                })}
              </View>
            ) : null}
            <PrimaryButton testID="b2b-order-submit" title={busy ? "Gönderiliyor…" : "Siparişi Gönder"} onPress={submitOrder} loading={busy} color={colors.primary} />
          </View>
        )}
      </B2BSheet>

      <B2BSheet visible={menuOpen} title={data?.contact?.name || b2bName || "Hesap"} onClose={() => setMenuOpen(false)} testID="b2b-account-menu">
        <Pressable
          testID="b2b-password-toggle"
          onPress={() => { setMenuOpen(false); setPwOpen(true); }}
          style={{ paddingVertical: 12 }}
        >
          <Text style={{ fontWeight: "800", color: colors.text }}>{data?.contact?.has_password === false ? "Şifre belirle" : "Şifre değiştir"}</Text>
        </Pressable>
        <Pressable
          testID="b2b-logout"
          onPress={() => {
            setMenuOpen(false);
            confirmAction("Çıkış", "Oturumu kapatmak istiyor musunuz?", () => logout());
          }}
          style={{ paddingVertical: 12 }}
        >
          <Text style={{ fontWeight: "800", color: colors.danger }}>Çıkış yap</Text>
        </Pressable>
      </B2BSheet>

      <B2BSheet visible={pwOpen} title={data?.contact?.has_password === false ? "Şifre belirle" : "Şifre değiştir"} onClose={() => setPwOpen(false)} testID="b2b-password-sheet">
        {data?.contact?.has_password !== false ? <Field label="Mevcut şifre" secureTextEntry value={currentPw} onChangeText={setCurrentPw} testID="b2b-current-password" /> : null}
        <Field label="Yeni şifre" secureTextEntry value={newPw} onChangeText={setNewPw} testID="b2b-new-password" />
        <Field label="Yeni şifre (tekrar)" secureTextEntry value={newPw2} onChangeText={setNewPw2} />
        <PrimaryButton title={busy ? "Kaydediliyor…" : "Şifreyi güncelle"} onPress={changePassword} loading={busy} color={colors.primary} testID="b2b-password-save" />
      </B2BSheet>

      <BarcodeScannerModal
        visible={scan}
        continuous
        qtyEnabled
        qty={scanQty}
        onQtyChange={setScanQty}
        status={scanStatus}
        onClose={() => { setScan(false); setScanStatus(""); }}
        onScan={addFromScan}
      />

      <B2BSheet visible={!!preview} title="Sipariş önizleme" subtitle={preview?.order_number} onClose={() => setPreview(null)} testID="b2b-order-preview">
        {preview ? (
          <View>
            <Muted>{fmtDate(preview.order_date)} · {statusTr(preview.order_status)}</Muted>
            {preview.customer_order_number ? <Text testID="b2b-preview-customer-order-no" style={{ fontWeight: "700" }}>Sizin no {preview.customer_order_number}</Text> : null}
            {(preview.items || []).map((it, i) => {
              const rec = it as { product_id?: string; product_name?: string; quantity?: number; unit?: string; unit_price?: number; total?: number; image_url?: string; sku?: string; barcode?: string };
              const img = resolveMediaUrl(baseUrl, previewLineImage(rec, products));
              const code = previewLineCode(rec, products);
              return (
                <Row key={String(rec.product_id || i)} testID={`b2b-preview-line-${i}`}>
                  {img ? <Image source={{ uri: img }} style={{ width: 48, height: 48, borderRadius: 8 }} /> : <Ionicons name="cube-outline" size={24} color={colors.muted} />}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800" }}>{rec.product_name}</Text>
                    <Muted>{rec.quantity} {rec.unit || "Adet"}{rec.unit_price != null ? ` · ${fmtMoney(rec.unit_price)}` : ""}{code ? ` · ${code}` : ""}</Muted>
                  </View>
                  <Text style={{ fontWeight: "800" }}>{fmtMoney(rec.total)}</Text>
                </Row>
              );
            })}
            <Text style={{ fontWeight: "900", textAlign: "right" }}>Toplam {fmtMoney(b2bOrderGross(preview))}</Text>
          </View>
        ) : null}
      </B2BSheet>

      <B2BSheet visible={!!edit} title="Siparişi düzenle" subtitle={edit?.order_number} onClose={() => setEdit(null)} testID="b2b-edit-order-modal">
        {editLines.map((l) => (
          <Row key={l.product_id} testID={`b2b-edit-line-${l.sku || l.product_id}`}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800" }}>{l.product_name}</Text>
              <Muted>{fmtMoney(l.unit_price)}</Muted>
            </View>
            <Pressable testID={`b2b-edit-dec-${l.sku}`} onPress={() => setEditLines((ls) => setEditQty(ls, l.product_id, l.quantity - 1))}>
              <Ionicons name="remove-circle" size={24} color={colors.muted} />
            </Pressable>
            <Text style={{ fontWeight: "800", width: 28, textAlign: "center" }}>{l.quantity}</Text>
            <Pressable testID={`b2b-edit-inc-${l.sku}`} onPress={() => setEditLines((ls) => setEditQty(ls, l.product_id, l.quantity + 1))}>
              <Ionicons name="add-circle" size={24} color={colors.primary} />
            </Pressable>
          </Row>
        ))}
        <GroupedSelect
          testID="b2b-edit-add-product"
          emptyLabel="Ürün ekle…"
          value={editAdd}
          onChange={setEditAdd}
          groups={[{ label: "Stokta", options: inStockProducts.map((p) => ({ value: p.id, label: p.name })) }]}
        />
        <PrimaryButton
          testID="b2b-edit-add-btn"
          title="Ekle"
          disabled={!editAdd}
          onPress={() => {
            const p = products.find((x) => x.id === editAdd);
            if (p) setEditLines((ls) => addEditProduct(ls, p));
            setEditAdd("");
          }}
        />
        <Field label="Sipariş notu" value={editNote} onChangeText={setEditNote} testID="b2b-edit-note" />
        <PrimaryButton testID="b2b-edit-save" title={busy ? "Kaydediliyor…" : "Kaydet"} onPress={saveEdit} loading={busy} color={colors.primary} />
      </B2BSheet>

      <B2BSheet visible={!!cancel} title="İptal talebi gönder" subtitle={cancel?.order_number} onClose={() => setCancel(null)} testID="b2b-cancel-modal">
        <Muted>Sipariş onaylandı; satıcı talebinizi değerlendirecek.</Muted>
        <Field label="İptal gerekçesi (isteğe bağlı)" value={cancelReason} onChangeText={setCancelReason} testID="b2b-cancel-reason" />
        <PrimaryButton testID="b2b-cancel-submit" title={busy ? "Gönderiliyor…" : "Talep gönder"} onPress={sendCancel} loading={busy} color="#D97706" />
      </B2BSheet>

      <B2BSheet visible={!!legal} title={legal?.title || "Belge"} onClose={() => setLegal(null)} testID="b2b-legal-modal">
        <Text style={{ color: colors.text, fontSize: 13, lineHeight: 20 }}>{legal?.text}</Text>
      </B2BSheet>
    </Screen>
  );
}

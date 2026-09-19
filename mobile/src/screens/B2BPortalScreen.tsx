import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Linking, Platform, Pressable, Share, Text, TextInput, View } from "react-native";
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
import { addCartLine, cartCount, formatOrderItemLabel, parseStoredCart, setCartLineQty, type B2BCart } from "../utils/b2bCart";
import { canAddProduct, categorySelectGroups, filterCatalog, hasListDiscount, normalizeScanText, parseDraftQty } from "../utils/b2bCatalog";
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
import { fmtDate, fmtMoney, idOf } from "../utils/money";

type TabId = "catalog" | "orders" | "statement" | "installments";

const TABS: { id: TabId; label: string; flag?: keyof B2BPortal["settings"] }[] = [
  { id: "catalog", label: "Ürünler" },
  { id: "orders", label: "Siparişlerim" },
  { id: "statement", label: "Hesap Ekstresi", flag: "show_statement" },
  { id: "installments", label: "Taksitlerim", flag: "show_installments" },
];

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
  const [done, setDone] = useState<Order | null>(null);
  const [preview, setPreview] = useState<Order | null>(null);
  const [edit, setEdit] = useState<Order | null>(null);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editNote, setEditNote] = useState("");
  const [editAdd, setEditAdd] = useState("");
  const [cancel, setCancel] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [legal, setLegal] = useState<{ title: string; text: string } | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    if (!b2bToken) return;
    setRefreshing(true);
    try {
      const portal = await get<B2BPortal>({ ...client, token: null }, `/public/b2b/${b2bToken}`);
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

  const addProduct = (p: B2BProduct) => {
    if (!canAddProduct(p, showStock, allowOrders)) return;
    const qty = parseDraftQty(draftQty[p.id]);
    setCart((c) => addCartLine(c, p.id, qty, draftNotes[p.id] || ""));
    setMessage(`${p.name} sepete eklendi (${qty})`);
  };

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
    <Screen onRefresh={load} refreshing={refreshing}>
      <View testID="b2b-portal">
        <B2BTopBar
          logo={logo}
          company={data?.company?.name}
          contact={data?.contact?.name || b2bName}
          count={count}
          allowOrders={allowOrders}
          onCart={() => setCartOpen(true)}
          onMenu={() => setMenuOpen(true)}
        />
        {data?.company?.phone ? (
          <Pressable onPress={() => Linking.openURL(`tel:${data.company.phone}`)}>
            <Muted>{data.company.phone}</Muted>
          </Pressable>
        ) : null}
        <ErrorBanner message={error} />
        {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
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
            {!prods.length ? <Empty icon="cube-outline" title="Ürün yok" hint={q ? "Aramayı daraltın." : "Katalog boş."} /> : prods.slice(0, 200).map((p) => {
              const img = resolveMediaUrl(baseUrl, p.image_url);
              const listCut = showPrices && hasListDiscount(p);
              const addOk = canAddProduct(p, showStock, allowOrders);
              return (
                <Card key={p.id} testID={`b2b-product-${p.id}`}>
                  <Row>
                    {img ? <Image source={{ uri: img }} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: colors.slate100 }} /> : <Ionicons name="cube-outline" size={28} color={colors.muted} />}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontWeight: "800", color: colors.text }}>{p.name}</Text>
                      <Muted>{[p.sku, p.barcode].filter(Boolean).join(" · ")}</Muted>
                      {p.tags?.length ? (
                        <Row style={{ flexWrap: "wrap", gap: 4 }}>
                          {p.tags.slice(0, 3).map((t) => <Badge key={t} label={t} />)}
                        </Row>
                      ) : null}
                      {showStock ? (
                        <Text style={{ color: p.in_stock === false ? colors.danger : colors.primaryHover, fontWeight: "700", fontSize: 12 }}>
                          {p.in_stock === false ? "Stok yok" : p.stock_quantity == null ? "Stokta" : `Stok ${p.stock_quantity} ${p.unit || "Adet"}`}
                        </Text>
                      ) : null}
                    </View>
                    {showPrices ? (
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontWeight: "800", color: colors.text }}>{fmtMoney(b2bGross(p))}</Text>
                        {listCut ? <Text style={{ color: colors.muted, textDecorationLine: "line-through", fontSize: 11 }}>{fmtMoney(b2bGross(p, "list_price"))}</Text> : null}
                        <Muted>{Number(p.vat_rate) ? `KDV %${p.vat_rate} dahil` : "KDV'siz"} · {p.unit || "Adet"}</Muted>
                      </View>
                    ) : <Muted>Fiyat gizli</Muted>}
                  </Row>
                  {allowOrders ? (
                    <View>
                      <Field
                        label="Sipariş stok notu"
                        testID={`b2b-item-note-${p.id}`}
                        value={draftNotes[p.id] || ""}
                        onChangeText={(v) => setDraftNotes((n) => ({ ...n, [p.id]: v }))}
                        placeholder="Fişte stok açıklamasının altında basılır"
                      />
                      <Row>
                        <TextInput
                          testID={`b2b-add-qty-${p.id}`}
                          value={draftQty[p.id] ?? "1"}
                          keyboardType="number-pad"
                          onChangeText={(v) => setDraftQty((dq) => ({ ...dq, [p.id]: v.replace(/\D/g, "") }))}
                          style={{ width: 56, borderWidth: 1, borderColor: colors.border, borderRadius: 12, textAlign: "center", fontWeight: "800", paddingVertical: 10 }}
                        />
                        <View style={{ flex: 1 }}>
                          <PrimaryButton title="Sepete ekle" onPress={() => addProduct(p)} disabled={!addOk} color={colors.primary} testID={`b2b-add-${p.id}`} />
                        </View>
                      </Row>
                    </View>
                  ) : null}
                </Card>
              );
            })}
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
                  subtitle={`Tarih ${i.issue_date || "—"}${i.due_date ? ` · Vade ${i.due_date}` : ""} · ${statusTr(payStatus(i.payment_status))} · ödenen ${fmtMoney(i.paid_amount)}`}
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
              <Row key={l.key} style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>{l.p.name}</Text>
                  <Muted>{l.qty} × {showPrices ? fmtMoney(b2bGross(l.p)) : ""}{l.note ? ` · ${l.note}` : ""}</Muted>
                </View>
                <Pressable onPress={() => setCart((c) => setCartLineQty(c, l.key, l.qty - 1))} testID={`b2b-qty-dec-${l.p.id}`}>
                  <Ionicons name="remove-circle" size={26} color={colors.muted} />
                </Pressable>
                <Pressable onPress={() => setCart((c) => setCartLineQty(c, l.key, l.qty + 1))} testID={`b2b-qty-inc-${l.p.id}`}>
                  <Ionicons name="add-circle" size={26} color={colors.primary} />
                </Pressable>
                <Pressable onPress={() => setCart((c) => setCartLineQty(c, l.key, 0))} testID={`b2b-qty-del-${l.p.id}`}>
                  <Ionicons name="trash-outline" size={22} color={colors.danger} />
                </Pressable>
              </Row>
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
              <Row style={{ flexWrap: "wrap" }}>
                {data?.legal?.map((doc) => (
                  <Pressable key={doc.slug} onPress={() => openLegal(doc.slug, doc.title)} testID={`b2b-legal-${doc.slug}`}>
                    <Text style={{ color: colors.indigo, fontWeight: "700", fontSize: 12, marginRight: 10 }}>{doc.title}</Text>
                  </Pressable>
                ))}
              </Row>
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

      <BarcodeScannerModal visible={scan} onClose={() => setScan(false)} onScan={(code) => { setQ(normalizeScanText(code)); setScan(false); }} />

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

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Badge, Card, Empty, ErrorBanner, Field, H1, Kpi, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { B2BPortal, B2BProduct, Order } from "../types";
import { addCartLine, cartCount, formatOrderItemLabel, parseStoredCart, setCartLineQty, type B2BCart } from "../utils/b2bCart";
import { b2bGross, b2bNet, b2bOrderGross } from "../utils/b2bPricing";
import { matchesB2BQuery } from "../utils/b2bSearch";
import { statusTr } from "../utils/labels";
import { resolveMediaUrl } from "../utils/media";
import { fmtDate, fmtMoney } from "../utils/money";

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

function payStatus(v?: string | null): string {
  return ["paid", "partially_paid", "unpaid", "overdue"].includes(String(v || "")) ? String(v) : "unpaid";
}

function installmentDueText(row: { due_date?: string; is_overdue?: boolean; days_left?: number | null }): string {
  const due = String(row.due_date || "").slice(0, 10);
  if (!due) return "Vade belirsiz";
  if (row.is_overdue) return `Vade ${due} — ${Math.abs(Number(row.days_left) || 0)} gün gecikti`;
  if (row.days_left != null) return `Vade ${due} — ${row.days_left} gün kaldı`;
  return `Vade ${due}`;
}

function cartStorageKey(token: string) {
  return `tamkobi.b2bCart.${token}`;
}

export function B2BPortalScreen() {
  const { client, b2bToken, b2bName, logout, baseUrl } = useAuth();
  const [data, setData] = useState<B2BPortal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabId>("catalog");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<B2BCart>({});
  const [note, setNote] = useState("");
  const [customerOrderNo, setCustomerOrderNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

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
  const minOrder = Number(settings.min_order_amount) || 0;
  const tabs = useMemo(
    () => TABS.filter((t) => !t.flag || settings[t.flag] !== false),
    [settings]
  );
  const installments = Array.isArray(data?.installments) ? data.installments : [];

  useEffect(() => {
    if (!data) return;
    if (!tabs.some((t) => t.id === tab)) setTab("catalog");
  }, [data, tabs, tab]);

  const products = data?.products || [];
  const prods = useMemo(
    () => products.filter((p) => matchesB2BQuery(p, q)),
    [products, q]
  );
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
    if (!allowOrders) return;
    setCart((c) => addCartLine(c, p.id, 1, ""));
    setMessage(`${p.name} sepete eklendi`);
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
      setCart({});
      setNote("");
      setCustomerOrderNo("");
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

  const logo = resolveMediaUrl(baseUrl, data?.company?.logo_url);
  const bal = data?.contact?.balance || 0;

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <View testID="b2b-portal">
        <Row style={{ justifyContent: "space-between" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Row>
              {logo ? <Image source={{ uri: logo }} style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: "#fff" }} /> : <Ionicons name="storefront" size={28} color={colors.primary} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <H1>{data?.company?.name || "Bayi Portalı"}</H1>
                <Muted>{data?.contact?.name || b2bName || "B2B"}</Muted>
              </View>
            </Row>
          </View>
          <Badge label="B2B" tone="green" />
        </Row>
        <ErrorBanner message={error} />
        {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
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
            <TextInput
              testID="b2b-search"
              value={q}
              onChangeText={setQ}
              placeholder="Ürün, SKU veya barkod ara"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 12,
                fontSize: 16,
                color: colors.text,
                backgroundColor: "#fff",
                marginBottom: 8,
              }}
            />
            {!prods.length ? <Empty icon="cube-outline" title="Ürün yok" hint={q ? "Aramayı daraltın." : "Katalog boş."} /> : prods.slice(0, 80).map((p) => {
              const img = resolveMediaUrl(baseUrl, p.image_url);
              return (
                <Card key={p.id} testID={`b2b-product-${p.id}`}>
                  <Row>
                    {img ? <Image source={{ uri: img }} style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: colors.slate100 }} /> : <Ionicons name="cube-outline" size={28} color={colors.muted} />}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontWeight: "800", color: colors.text }}>{p.name}</Text>
                      <Muted>{[p.sku, p.barcode].filter(Boolean).join(" · ")}</Muted>
                      {showStock ? <Muted>{p.in_stock === false ? "Stok yok" : p.stock_quantity == null ? "Stok takip edilmiyor" : `Stok ${p.stock_quantity} ${p.unit || "Adet"}`}</Muted> : null}
                    </View>
                    {showPrices ? <Text style={{ fontWeight: "800", color: colors.text }}>{fmtMoney(b2bGross(p))}</Text> : null}
                  </Row>
                  {allowOrders ? (
                    <PrimaryButton title="Sepete ekle" onPress={() => addProduct(p)} color={colors.primary} testID={`b2b-add-${p.id}`} />
                  ) : null}
                </Card>
              );
            })}
            {allowOrders && count > 0 ? (
              <Card testID="b2b-cart">
                <Text style={{ fontWeight: "800", color: colors.text }}>Sepet · {count} kalem</Text>
                {lines.map((l) => (
                  <Row key={l.key} style={{ justifyContent: "space-between" }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: colors.text, fontWeight: "700" }}>{l.p.name}</Text>
                      <Muted>{l.qty} × {showPrices ? fmtMoney(b2bGross(l.p)) : ""}</Muted>
                    </View>
                    <Pressable onPress={() => setCart((c) => setCartLineQty(c, l.key, l.qty - 1))} testID={`b2b-qty-dec-${l.p.id}`}>
                      <Ionicons name="remove-circle" size={26} color={colors.muted} />
                    </Pressable>
                    <Pressable onPress={() => setCart((c) => setCartLineQty(c, l.key, l.qty + 1))} testID={`b2b-qty-inc-${l.p.id}`}>
                      <Ionicons name="add-circle" size={26} color={colors.primary} />
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
                <Field label="Sipariş notu" value={note} onChangeText={setNote} testID="b2b-order-note" />
                <Field label="Sizin sipariş no" value={customerOrderNo} onChangeText={setCustomerOrderNo} testID="b2b-po-number" autoCapitalize="none" />
                <PrimaryButton testID="b2b-order-submit" title={busy ? "Gönderiliyor…" : "Siparişi Gönder"} onPress={submitOrder} loading={busy} color={colors.primary} />
              </Card>
            ) : null}
          </View>
        ) : null}

        {tab === "orders" ? (
          <View testID="b2b-orders">
            {!data?.orders?.length ? <Empty icon="cart-outline" title="Henüz sipariş yok" /> : data.orders.map((o) => (
              <Card key={String(o.id || o._id || o.order_number)}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text style={{ fontWeight: "800", color: colors.text }}>{o.order_number}</Text>
                  <Badge label={statusTr(o.order_status)} tone={o.order_status === "cancelled" ? "red" : o.order_status === "delivered" ? "green" : "amber"} />
                </Row>
                <Muted>{fmtDate(o.order_date)}{o.customer_order_number ? ` · Sizin no ${o.customer_order_number}` : ""}</Muted>
                <Muted>{(o.items || []).map((it) => formatOrderItemLabel(it as { quantity?: number; product_name?: string; name?: string; note?: string })).join(", ")}</Muted>
                <Text style={{ fontWeight: "800", color: colors.text }}>{fmtMoney(b2bOrderGross(o))}</Text>
              </Card>
            ))}
          </View>
        ) : null}

        {tab === "statement" ? (
          <View testID="b2b-statement">
            <Card>
              <Text style={{ fontWeight: "800", color: colors.text }}>Faturalarım</Text>
              <Muted>
                Güncel bakiye: {fmtMoney(Math.abs(bal))} {bal > 0 ? "(borcunuz)" : bal < 0 ? "(alacağınız)" : ""}
              </Muted>
              {data?.company?.iban ? <Muted>Ödeme: {data.company.bank_name} {data.company.iban}</Muted> : null}
            </Card>
            {!data?.invoices?.length ? <Empty icon="document-text-outline" title="Fatura yok" /> : data.invoices.map((i) => (
              <ListRow
                key={i.invoice_number}
                title={i.invoice_number || "Fatura"}
                subtitle={`Tarih ${i.issue_date || "—"}${i.due_date ? ` · Vade ${i.due_date}` : ""} · ${statusTr(payStatus(i.payment_status))}`}
                right={fmtMoney(i.grand_total)}
              />
            ))}
          </View>
        ) : null}

        {tab === "installments" ? (
          <View testID="b2b-installments">
            {!installments.length ? <Empty icon="calendar-outline" title="Açık taksit yok" /> : installments.map((row) => (
              <ListRow
                key={String(row.id || row._id || `${row.invoice_number}-${row.no}`)}
                title={row.label || row.invoice_number || "Taksit"}
                subtitle={installmentDueText(row)}
                right={fmtMoney(row.amount)}
              />
            ))}
          </View>
        ) : null}

        <Card>
          <Pressable onPress={() => setPwOpen((v) => !v)} testID="b2b-password-toggle">
            <Text style={{ fontWeight: "800", color: colors.text }}>Şifre değiştir</Text>
          </Pressable>
          {pwOpen ? (
            <View>
              <Field label="Mevcut şifre" secureTextEntry value={currentPw} onChangeText={setCurrentPw} testID="b2b-current-password" />
              <Field label="Yeni şifre" secureTextEntry value={newPw} onChangeText={setNewPw} testID="b2b-new-password" />
              <Field label="Yeni şifre (tekrar)" secureTextEntry value={newPw2} onChangeText={setNewPw2} />
              <PrimaryButton title={busy ? "Kaydediliyor…" : "Şifreyi güncelle"} onPress={changePassword} loading={busy} color={colors.primary} testID="b2b-password-save" />
            </View>
          ) : null}
        </Card>
        <Pressable onPress={() => logout()} testID="b2b-logout">
          <Card>
            <Text style={{ fontWeight: "800", color: colors.danger }}>Çıkış yap</Text>
          </Card>
        </Pressable>
      </View>
    </Screen>
  );
}

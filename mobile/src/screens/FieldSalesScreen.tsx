import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { ProductPickRow } from "../components/ProductPickRow";
import { ChannelLogo } from "../components/ChannelLogo";
import { Card, Empty, ErrorBanner, Field, ListRow, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { Contact, Order, Product } from "../types";
import { addOrBump, cartTotals, lineFromProduct, type CartLine } from "../utils/cart";
import { orderNumberLabel, statusTr } from "../utils/labels";
import { fmtMoney, idOf, todayIso } from "../utils/money";

export function FieldSalesScreen() {
  const { client, companyId, user, can } = useAuth();
  const canEdit = can("/saha", "edit");
  const { contact_id: prefillId } = useLocalSearchParams<{ contact_id?: string }>();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [custQ, setCustQ] = useState("");
  const [prodQ, setProdQ] = useState("");
  const [customer, setCustomer] = useState<Contact | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [notes, setNotes] = useState("");
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, p, o] = await Promise.all([
        get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true }),
        get<Product[]>(client, "/products", { company_id: companyId, lite: true }),
        get<Order[]>(client, "/orders", { company_id: companyId }),
      ]);
      setContacts((c || []).filter((x) => !x.type || ["customer", "both"].includes(x.type)));
      setProducts((p || []).filter((x) => x.is_active !== false && x.type !== "raw_material"));
      setOrders(o || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Saha verileri yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!prefillId) return;
    const hit = contacts.find((row) => idOf(row) === String(prefillId));
    if (hit) setCustomer(hit);
  }, [contacts, prefillId]);

  const custHits = useMemo(() => {
    const q = custQ.trim().toLowerCase();
    if (q.length < 2) return [];
    return contacts.filter((c) => [c.name, c.phone, c.tax_number_or_id, c.city].some((v) => String(v || "").toLowerCase().includes(q))).slice(0, 8);
  }, [contacts, custQ]);

  const prodHits = useMemo(() => {
    const q = prodQ.trim().toLowerCase();
    if (q.length < 2) return [];
    return products.filter((p) => [p.name, p.sku, p.barcode].some((v) => String(v || "").toLowerCase().includes(q))).slice(0, 8);
  }, [prodQ, products]);

  const todayOrders = useMemo(() => {
    const day = todayIso();
    return orders.filter((o) => o.channel === "saha" && String(o.order_date || "").slice(0, 10) === day).slice(0, 8);
  }, [orders]);

  const totals = cartTotals(cart);

  const addProduct = (p: Product) => {
    setCart((prev) => addOrBump(prev, lineFromProduct(p as unknown as Record<string, unknown>), 1));
    setProdQ("");
    setMessage(`${p.name} sepete eklendi`);
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

  const submit = async () => {
    if (!canEdit) { setError("Sipariş oluşturma yetkiniz yok."); return; }
    const name = (customer?.name || newName).trim();
    if (!name) { setError("Önce müşteri seçin veya ad yazın."); return; }
    if (!cart.length) { setError("Sepete en az bir ürün ekleyin."); return; }
    setBusy(true);
    try {
      let contactId = idOf(customer);
      if (!contactId && newName.trim()) {
        const created = await post<Contact>(client, "/contacts", {
          company_id: companyId,
          type: "customer",
          name: newName.trim(),
          phone: newPhone,
          tax_number_or_id: "11111111111",
          category: "Saha Müşterisi",
          address: "-",
          city: "-",
        });
        contactId = idOf(created);
      }
      const items = cart.map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        sku: it.sku,
        quantity: it.quantity,
        unit_price: it.unit_price,
        unit_price_incl: it.unit_price_incl,
        vat_rate: it.vat_rate,
        total: it.total,
        vat_amount: it.vat_amount,
        total_incl: it.total_incl,
      }));
      const r = await post<Order>(client, "/orders", {
        company_id: companyId,
        channel: "saha",
        order_status: "pending",
        customer_name: name,
        customer_phone: customer?.phone || newPhone || "",
        shipping_address: customer?.address || "-",
        city: customer?.city || "-",
        contact_id: contactId || null,
        notes,
        salesperson_name: user?.name || "",
        items,
        total_amount: totals.totalIncl,
      });
      setMessage(`Sipariş alındı: ${r.order_number}`);
      setCart([]);
      setNotes("");
      setCustomer(null);
      setNewName("");
      setNewPhone("");
      setError(null);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "Sipariş kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen onRefresh={load}>
      <ErrorBanner message={error} />
      {message ? <Card><Text style={{ color: colors.accent, fontWeight: "700" }}>{message}</Text></Card> : null}
      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>1. Müşteri</Text>
        {customer ? (
          <ListRow title={customer.name} subtitle={customer.phone || customer.city} onPress={() => setCustomer(null)} />
        ) : (
          <>
            <Field label="Müşteri ara" value={custQ} onChangeText={setCustQ} placeholder="Ad / telefon" />
            {custHits.map((c) => (
              <ListRow key={idOf(c)} title={c.name} subtitle={c.phone || c.city} onPress={() => { setCustomer(c); setCustQ(""); }} />
            ))}
            <Field label="Yeni cari adı" value={newName} onChangeText={setNewName} />
            <Field label="Telefon" value={newPhone} onChangeText={setNewPhone} keyboardType="phone-pad" />
          </>
        )}
      </Card>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "800", color: colors.text }}>2. Ürün</Text>
          <PrimaryButton title="Barkod" onPress={() => setScan(true)} />
        </Row>
        <Field label="Ürün ara" value={prodQ} onChangeText={setProdQ} placeholder="Ad / SKU / barkod" />
        {prodHits.map((p) => (
          <ProductPickRow key={idOf(p)} product={p} onPress={() => addProduct(p)} />
        ))}
      </Card>
      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>Sepet ({totals.count})</Text>
        {!cart.length ? <Empty icon="cart-outline" title="Sepet boş" /> : cart.map((it, i) => (
          <ListRow
            key={`${it.product_id}-${i}`}
            title={`${it.quantity}× ${it.product_name}`}
            subtitle={it.sku}
            right={fmtMoney(it.total_incl)}
            onPress={() => setCart((prev) => prev.filter((_, idx) => idx !== i))}
          />
        ))}
        <Field label="Not" value={notes} onChangeText={setNotes} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 18, fontWeight: "800" }}>Toplam</Text>
          <Text style={{ fontSize: 18, fontWeight: "800" }} testID="saha-total">{fmtMoney(totals.totalIncl)}</Text>
        </View>
        <PrimaryButton testID="saha-submit" title={busy ? "Kaydediliyor…" : "Siparişi Al"} onPress={submit} loading={busy} disabled={!canEdit} color={colors.accent} />
      </Card>
      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>Bugünkü saha siparişleri</Text>
        {!todayOrders.length ? <Empty icon="clipboard-outline" title="Henüz saha siparişi yok" /> : todayOrders.map((o) => (
          <ListRow key={idOf(o)} title={orderNumberLabel({ ...o, channel: o.channel || "saha" })} subtitle={`${o.customer_name} · ${statusTr(o.order_status)}`} leading={<ChannelLogo channel={o.channel || "saha"} />} right={fmtMoney(o.grand_total || o.total_amount)} />
        ))}
      </Card>
      <BarcodeScannerModal visible={scan} onClose={() => setScan(false)} onScan={lookupBarcode} />
    </Screen>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useParams } from "react-router-dom";
import { ShoppingCart, Package, FileText, Truck, CalendarClock, Loader2, Search, CheckCircle2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { getPriceDecimals, setPriceDecimals } from "../utils/money";
import { resolveImageUrl } from "../utils/imageUrl";
import { fmt, b2bGross, b2bNet, B2BHeader, CartBody, MobileCartBar, OrdersList, StatementList } from "../components/B2BPortalParts";
import { B2BAiCart } from "../components/B2BAiCart";
import { ScanButton } from "../components/CameraScanner";
import { addCartLine, cartHasItems, discardHeldCart, heldCartTabs, heldStorageKey, holdActiveCart, lineKey, mergePortalOrderLists, parseHeldCarts, parseStoredCart, resumeHeldCart, setCartLineQty } from "../utils/b2bCart";
import { applyB2BScan, matchesB2BQuery, qtyDraftOnBlur, qtyDraftOnFocus, qtyDraftShown } from "../utils/b2bSearch";
import { scanQtyOnBlur, scanQtyOnFocus, scanQtyShown } from "../utils/scanQty";

const ALL_TABS = [
  { id: "catalog", label: "Ürünler", Icon: Package },
  { id: "orders", label: "Siparişlerim", Icon: Truck },
  { id: "statement", label: "Hesap Ekstresi", Icon: FileText, flag: "show_statement" },
  { id: "installments", label: "Taksitlerim", Icon: CalendarClock, flag: "show_installments" },
];

function installmentDueText(row) {
  const due = String(row.due_date || "").slice(0, 10);
  if (!due) return "Vade belirsiz";
  if (row.is_overdue) return `Vade ${due} — ${Math.abs(Number(row.days_left) || 0)} gün gecikti`;
  if (row.days_left != null) return `Vade ${due} — ${row.days_left} gün kaldı`;
  return `Vade ${due}`;
}

export default function B2BPortalPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("catalog");
  const [q, setQ] = useState("");
  const [scanQty, setScanQty] = useState("1");
  const [scanStatus, setScanStatus] = useState("");
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useState(() => {
    try { return parseStoredCart(localStorage.getItem(`b2b_cart_${token}`) || "{}"); }
    catch { return {}; }
  });
  const [heldCarts, setHeldCarts] = useState(() => {
    try { return parseHeldCarts(localStorage.getItem(heldStorageKey(token)) || "[]"); }
    catch { return []; }
  });
  const [draftQty, setDraftQty] = useState({});
  const [draftNotes, setDraftNotes] = useState({});
  const [note, setNote] = useState("");
  const [customerOrderNo, setCustomerOrderNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [sheet, setSheet] = useState(false);

  const load = useCallback(
    () => axios.get(`${API_URL}/public/b2b/${token}`)
      .then((r) => setData(r.data))
      .catch((e) => setErr(e.response?.data?.detail || "Portal yüklenemedi.")),
    [token],
  );
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data?.company) return undefined;
    const prev = getPriceDecimals();
    setPriceDecimals(data.company.price_decimals);
    return () => setPriceDecimals(prev);
  }, [data]);
  useEffect(() => { localStorage.setItem(`b2b_cart_${token}`, JSON.stringify(cart)); }, [cart, token]);
  useEffect(() => { localStorage.setItem(heldStorageKey(token), JSON.stringify(heldCarts)); }, [heldCarts, token]);

  /** Sepetteki ürünleri panel/mobil Siparişler listesinde göstermek için sunucuya yaz. */
  useEffect(() => {
    if (!token || !data) return undefined;
    const items = Object.values(cart || {})
      .filter((row) => (Number(row?.qty) || 0) > 0 && row?.productId)
      .map((row) => ({ product_id: row.productId, quantity: row.qty, note: row.note || "" }));
    const t = setTimeout(() => {
      axios.put(`${API_URL}/public/b2b/${token}/active-cart`, {
        items,
        note,
        customer_order_number: customerOrderNo.trim(),
      }).catch(() => { /* çevrimdışı / eski API — yerel sepet kalır */ });
    }, 600);
    return () => clearTimeout(t);
  }, [cart, note, customerOrderNo, token, data]);

  const settings = data?.settings || {};
  const showPrices = settings.show_prices !== false;
  const showStock = settings.show_stock !== false;
  const allowOrders = settings.allow_orders !== false;
  const allowAiCart = allowOrders && settings.allow_ai_cart !== false;
  const minOrder = Number(settings.min_order_amount) || 0;
  const tabs = useMemo(
    () => ALL_TABS.filter((t) => !t.flag || settings[t.flag] !== false),
    [settings],
  );
  const installments = Array.isArray(data?.installments) ? data.installments : [];

  useEffect(() => {
    if (!data) return;
    if (!tabs.some((t) => t.id === tab)) setTab("catalog");
  }, [data, tabs, tab]);

  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div className="bg-white rounded-2xl p-8 shadow-xl text-center font-bold text-slate-800" data-testid="b2b-error">{err}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  const cats = ["all", ...Array.from(new Set(data.products.map((p) => p.category).filter(Boolean)))];
  const prods = data.products.filter((p) => (cat === "all" || p.category === cat) && matchesB2BQuery(p, q));
  const lines = Object.entries(cart)
    .map(([key, row]) => ({ key, p: data.products.find((x) => x.id === row.productId), qty: row.qty, note: row.note || "" }))
    .filter((l) => l.p && l.qty > 0);
  const sub = lines.reduce((s, l) => s + b2bNet(l.p) * l.qty, 0);
  const vat = lines.reduce((s, l) => s + (b2bGross(l.p) - b2bNet(l.p)) * l.qty, 0);
  const cartTotal = sub + vat;

  const setQty = (key, qty) => setCart((c) => setCartLineQty(c, key, qty));
  const addWithQty = (p) => {
    if (!allowOrders) return;
    const qty = Math.max(1, parseInt(String(draftQty[p.id] ?? "1"), 10) || 1);
    setCart((c) => addCartLine(c, p.id, qty, draftNotes[p.id] || ""));
  };
  const addFromScan = (code) => {
    const hit = applyB2BScan({ products: data.products, code, qty: scanQty, allowOrders, showStock });
    setQ(String(code || "").trim());
    setScanStatus(hit.message);
    if (hit.action === "add" && hit.product) {
      setCart((c) => addCartLine(c, hit.product.id, hit.qty, draftNotes[hit.product.id] || ""));
      toast.success(hit.message);
      return;
    }
    if (hit.action === "miss") toast.error(hit.message);
    else toast.message(hit.message);
  };

  const submit = async () => {
    if (!allowOrders) return;
    if (minOrder > 0 && cartTotal + 1e-9 < minOrder) {
      toast.error(`Minimum sipariş tutarı ${fmt(minOrder)} ₺.`);
      return;
    }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/public/b2b/${token}/orders`, {
        items: lines.map((l) => ({ product_id: l.p.id, quantity: l.qty, note: l.note || "" })),
        note,
        customer_order_number: customerOrderNo.trim(),
      });
      setDone(r.data.order);
      setCart({});
      setNote("");
      setCustomerOrderNo("");
      setSheet(false);
      toast.success(r.data.message);
      load();
      setTab("orders");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sipariş gönderilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const holdCart = async () => {
    if (!cartHasItems(cart)) {
      toast.error("Beklemeye alınacak ürün yok.");
      return;
    }
    const payload = {
      items: lines.map((l) => ({ product_id: l.p.id, quantity: l.qty, note: l.note || "" })),
      note,
      customer_order_number: customerOrderNo.trim(),
    };
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/public/b2b/${token}/held-carts`, payload);
      setCart({});
      setNote("");
      setCustomerOrderNo("");
      setSheet(false);
      toast.success(r.data.message || "Bekleyen sepet kaydedildi.");
      await load();
      setTab("orders");
    } catch (e) {
      // API yoksa / çevrimdışı: yerel bekleyen sepet (eski davranış)
      const r = holdActiveCart(heldCarts, cart, { note, customerOrderNo });
      setHeldCarts(r.held);
      setCart(r.cart);
      setNote("");
      setCustomerOrderNo("");
      const label = r.held[r.held.length - 1]?.label || "Bekleyen sepet";
      toast.success(`${label} beklemeye alındı (yerel).`);
    } finally {
      setBusy(false);
    }
  };

  const cartFromOrderItems = (items) => {
    const next = {};
    (items || []).forEach((it) => {
      const pid = it.product_id || it.id;
      if (!pid) return;
      const noteText = it.note || "";
      const key = lineKey(pid, noteText);
      next[key] = { productId: pid, qty: Number(it.quantity) || 0, note: noteText };
    });
    return next;
  };

  const loadHeld = async (holdId) => {
    const serverOrd = (data?.orders || []).find((o) => String(o.id || o._id) === String(holdId) && (o.is_held_cart || o.order_status === "held_cart"));
    if (serverOrd) {
      setBusy(true);
      try {
        if (cartHasItems(cart)) {
          await axios.post(`${API_URL}/public/b2b/${token}/held-carts`, {
            items: lines.map((l) => ({ product_id: l.p.id, quantity: l.qty, note: l.note || "" })),
            note,
            customer_order_number: customerOrderNo.trim(),
          });
        }
        setCart(cartFromOrderItems(serverOrd.items));
        setNote(serverOrd.notes || "");
        setCustomerOrderNo(serverOrd.customer_order_number || "");
        await axios.delete(`${API_URL}/public/b2b/${token}/held-carts/${serverOrd.id || serverOrd._id}`);
        await load();
        toast.message("Bekleyen sepet yüklendi.");
        setTab("catalog");
      } catch (e) {
        toast.error(e.response?.data?.detail || "Bekleyen sepet yüklenemedi.");
      } finally {
        setBusy(false);
      }
      return;
    }
    const r = resumeHeldCart(heldCarts, cart, holdId, { note, customerOrderNo });
    setHeldCarts(r.held);
    setCart(r.cart);
    if (r.meta) {
      setNote(r.meta.note || "");
      setCustomerOrderNo(r.meta.customerOrderNo || "");
    }
    toast.message("Bekleyen sepet yüklendi.");
  };

  const removeHeld = async (holdId) => {
    if (!window.confirm("Bu bekleyen sepet silinsin mi?")) return;
    const serverOrd = (data?.orders || []).find((o) => String(o.id || o._id) === String(holdId) && (o.is_held_cart || o.order_status === "held_cart"));
    if (serverOrd) {
      try {
        await axios.delete(`${API_URL}/public/b2b/${token}/held-carts/${serverOrd.id || serverOrd._id}`);
        toast.success("Bekleyen sepet silindi.");
        await load();
      } catch (e) {
        toast.error(e.response?.data?.detail || "Silinemedi.");
      }
      return;
    }
    setHeldCarts((prev) => discardHeldCart(prev, holdId));
    toast.success("Bekleyen sepet silindi.");
  };

  const portalOrderRows = mergePortalOrderLists({
    serverOrders: data?.orders || [],
    heldLocal: heldCarts,
    products: data?.products || [],
    activeCart: cart,
    activeNote: note,
    activeCustomerOrderNo: customerOrderNo,
    priceGross: b2bGross,
  });
  const heldTabs = heldCartTabs(heldCarts, data?.orders || []);

  const cartBodyProps = {
    lines,
    sub,
    vat,
    note,
    setNote,
    setQty,
    submit,
    busy,
    customerOrderNo,
    setCustomerOrderNo,
    onHold: holdCart,
  };
  const tabCols = Math.min(4, Math.max(2, tabs.length));
  const ordersTabCount = portalOrderRows.length;

  return (
    <div className="min-h-screen bg-slate-100 pb-24 lg:pb-6" data-testid="b2b-portal">
      <B2BHeader company={data.company} contact={data.contact} token={token} onPasswordChanged={load} />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4">
        {settings.welcome_note ? (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl px-3 py-2.5 text-xs sm:text-sm" data-testid="b2b-welcome-note">
            {settings.welcome_note}
          </div>
        ) : null}

        <div
          className="grid sm:flex gap-1 bg-white rounded-xl p-1 border"
          style={{ gridTemplateColumns: `repeat(${tabCols}, minmax(0, 1fr))` }}
          data-testid="b2b-tabs"
        >
          {tabs.map(({ id: k, label: l, Icon }) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-2 rounded-lg text-[10px] sm:text-xs font-semibold leading-tight ${tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              data-testid={`b2b-tab-${k}`}
            >
              <Icon className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              <span className="text-center">
                {l}
                {k === "orders" && ordersTabCount > 0 ? ` (${ordersTabCount})` : ""}
                {k === "installments" && installments.length > 0 ? ` (${installments.length})` : ""}
              </span>
            </button>
          ))}
        </div>

        {done && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs sm:text-sm text-emerald-800 flex items-start gap-2" data-testid="b2b-order-success">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>
              Siparişiniz alındı: <b>{done.order_number}</b>
              {done.customer_order_number ? <> · sizin no <b>{done.customer_order_number}</b></> : null}
              {" — "}{fmt(done.total_amount)} ₺. Onaylandığında kargo takip numarası burada görünecek.
            </span>
          </div>
        )}

        {tab === "catalog" && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <aside className="md:col-span-3 lg:col-span-2 order-1" data-testid="b2b-categories">
              <div className="bg-white rounded-2xl border p-2 sm:p-2.5 md:sticky md:top-4">
                <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Kategoriler</div>
                <nav className="flex flex-col gap-1">
                  {cats.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCat(c)}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold border transition ${cat === c ? "bg-emerald-600 text-white border-emerald-600 shadow-sm" : "bg-slate-50 text-slate-700 border-transparent hover:bg-slate-100"}`}
                      data-testid={`b2b-cat-${c === "all" ? "all" : c}`}
                    >
                      {c === "all" ? "Tümü" : c}
                    </button>
                  ))}
                </nav>
              </div>
            </aside>

            <div className={`md:col-span-9 ${allowOrders ? "lg:col-span-7" : "lg:col-span-10"} space-y-3 order-2`}>
              {allowAiCart && (
                <B2BAiCart
                  token={token}
                  products={data.products}
                  onApply={(sel) => {
                    setCart((c) => sel.reduce((n, i) => addCartLine(n, i.product_id, i.quantity, ""), c));
                  }}
                />
              )}
              {!allowOrders && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-3 py-2 text-xs" data-testid="b2b-orders-closed">
                  Bu portalda sipariş alımı kapalı. Ürünleri inceleyebilirsiniz; sipariş için tedarikçinizle iletişime geçin.
                </div>
              )}
              <div className="flex gap-2 items-stretch">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Ürün, kod, barkod veya etiket ara…"
                    className="w-full border rounded-xl pl-9 pr-3 p-2.5 text-sm bg-white"
                    data-testid="b2b-search"
                    autoComplete="off"
                    inputMode="search"
                  />
                </div>
                <label className="shrink-0 flex flex-col justify-center">
                  <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Adet</span>
                  <input
                    value={scanQtyShown(scanQty)}
                    onChange={(e) => setScanQty(e.target.value.replace(/\D/g, ""))}
                    onFocus={() => setScanQty(scanQtyOnFocus())}
                    onBlur={() => setScanQty(scanQtyOnBlur(scanQty))}
                    inputMode="numeric"
                    className="w-14 border rounded-xl p-2 text-sm font-black text-center bg-white"
                    data-testid="b2b-scan-qty"
                    aria-label="Adet çarpan"
                  />
                </label>
                <ScanButton
                  size="sm"
                  continuous
                  qtyEnabled
                  qty={scanQty}
                  onQtyChange={setScanQty}
                  statusText={scanStatus}
                  label="Okut"
                  title="Seri barkod okut — adet çarpan"
                  className="!px-3 !rounded-xl shrink-0"
                  onScan={addFromScan}
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-3">
                {prods.map((p) => (
                  <div key={p.id} className="bg-white rounded-2xl border p-2.5 sm:p-3 flex flex-col gap-2 min-w-0" data-testid={`b2b-product-${p.sku}`}>
                    <div className="relative aspect-[3/2] bg-slate-50 rounded-xl flex items-center justify-center overflow-hidden" data-testid={`b2b-image-${p.sku}`}>
                      {p.image_url
                        ? <img src={resolveImageUrl(p.image_url)} alt="" className="absolute inset-0 h-full w-full object-contain" />
                        : <Package className="w-8 h-8 text-slate-300" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 leading-tight line-clamp-2">{p.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono truncate">{p.sku}{p.barcode ? ` · ${p.barcode}` : ""}</div>
                      {Array.isArray(p.tags) && p.tags.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-0.5">
                          {p.tags.slice(0, 3).map((t) => (
                            <span key={t} className="text-[9px] px-1 py-0 rounded bg-slate-100 text-slate-500">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-end justify-between gap-1">
                      <div className="min-w-0">
                        <div className="text-base font-black text-slate-900 whitespace-nowrap" data-testid={`b2b-price-${p.sku}`}>
                          {showPrices ? `${fmt(b2bGross(p))} ₺` : "—"}
                        </div>
                        {showPrices && b2bGross(p) < b2bGross(p, "list_price") && (
                          <div className="text-[10px] text-slate-400 line-through">{fmt(b2bGross(p, "list_price"))} ₺</div>
                        )}
                        <div className="text-[10px] text-slate-400">
                          {showPrices ? (Number(p.vat_rate) ? `KDV %${p.vat_rate} dahil` : "KDV'siz") : "Fiyat gizli"} • {p.unit}
                        </div>
                      </div>
                      {showStock && (
                        <span className={`text-[10px] font-semibold shrink-0 ${p.in_stock ? "text-emerald-600" : "text-rose-600"}`} data-testid={`b2b-stock-${p.sku}`}>
                          {p.in_stock ? "Stokta" : "Yok"}
                        </span>
                      )}
                    </div>
                    {allowOrders && (
                      <>
                        <label className="block">
                          <span className="block text-[9px] font-semibold text-slate-500 mb-0.5">Sipariş stok notu</span>
                          <textarea
                            rows={1}
                            value={draftNotes[p.id] || ""}
                            onChange={(e) => setDraftNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                            placeholder="Fişte stok açıklamasının altında basılır"
                            className="w-full min-h-[2rem] border rounded-lg px-2 py-1 text-[10px] text-slate-700 resize-none bg-slate-50"
                            data-testid={`b2b-item-note-${p.sku}`}
                          />
                        </label>
                        <div className="flex items-stretch gap-1.5 mt-auto">
                          <label className="flex flex-col items-stretch justify-center w-12 shrink-0 rounded-xl border-2 border-slate-300 bg-slate-50 px-0.5">
                            <span className="text-[8px] font-semibold text-slate-400 text-center leading-none pt-0.5">Adet</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={qtyDraftShown(draftQty, p.id)}
                              onChange={(e) => setDraftQty((dq) => ({ ...dq, [p.id]: e.target.value.replace(/\D/g, "") }))}
                              onFocus={() => setDraftQty((dq) => ({ ...dq, [p.id]: qtyDraftOnFocus() }))}
                              onBlur={() => setDraftQty((dq) => ({ ...dq, [p.id]: qtyDraftOnBlur(dq[p.id]) }))}
                              onKeyDown={(e) => { if (e.key === "Enter") addWithQty(p); }}
                              className="w-full bg-transparent text-center font-black text-sm text-slate-900 py-0.5 outline-none"
                              data-testid={`b2b-add-qty-${p.sku}`}
                              aria-label="Adet"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => addWithQty(p)}
                            disabled={showStock && !p.in_stock}
                            className="flex-1 min-w-0 flex items-center justify-center gap-0.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] sm:text-xs font-bold disabled:opacity-40"
                            data-testid={`b2b-add-${p.sku}`}
                          >
                            <ShoppingCart className="w-3.5 h-3.5 shrink-0" /> Ekle
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {prods.length === 0 && <div className="col-span-full p-8 text-center text-xs text-slate-400">Ürün bulunamadı.</div>}
              </div>
            </div>

            {allowOrders && (
              <div className="hidden lg:block lg:col-span-3 order-3 bg-white rounded-2xl border p-4 space-y-3 h-fit lg:sticky lg:top-4" data-testid="b2b-cart">
                <div className="font-bold text-slate-900 flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4" /> Sepet ({lines.length})
                </div>
                {heldTabs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" data-testid="b2b-held-tabs">
                    {heldTabs.map((h) => (
                      <div key={h.id} className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => loadHeld(h.id)}
                          className="px-2 py-1 rounded-lg text-[10px] font-bold border bg-amber-50 text-amber-900 border-amber-200"
                          data-testid={`b2b-held-tab-${h.id}`}
                        >
                          {h.label}
                        </button>
                        <button type="button" onClick={() => removeHeld(h.id)} className="text-[10px] text-rose-600 font-semibold px-1" data-testid={`b2b-held-discard-${h.id}`} title="Sil">×</button>
                      </div>
                    ))}
                  </div>
                )}
                {minOrder > 0 && <div className="text-[10px] text-slate-500">Min. sipariş: <b>{fmt(minOrder)} ₺</b></div>}
                <CartBody {...cartBodyProps} />
              </div>
            )}
          </div>
        )}

        {tab === "orders" && (
          <OrdersList orders={portalOrderRows} heldRows={[]} token={token} products={data.products} company={data.company} onChanged={load} />
        )}
        {tab === "statement" && settings.show_statement !== false && (
          <StatementList invoices={data.invoices} company={data.company} balance={data.contact.balance} />
        )}
        {tab === "installments" && settings.show_installments !== false && (
          <div className="bg-white rounded-2xl border divide-y text-xs" data-testid="b2b-installments">
            {installments.length === 0 && <div className="p-8 text-center text-slate-400">Bekleyen taksit yok.</div>}
            {installments.map((i) => {
              const remaining = Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0));
              const title = [i.invoice_number, i.label].filter(Boolean).join(" • ") || "Taksit";
              return (
                <div
                  key={i.id || `${i.invoice_number}-${i.no}-${i.due_date}`}
                  className={`p-3 flex items-center gap-3 ${i.is_overdue ? "bg-rose-50/60" : ""}`}
                  data-testid={`b2b-installment-${i.id || i.no}`}
                >
                  <CalendarClock className={`w-4 h-4 shrink-0 ${i.is_overdue ? "text-rose-600" : "text-slate-400"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{title}</div>
                    <div className="text-slate-500">{installmentDueText(i)}</div>
                  </div>
                  <b className="text-sm whitespace-nowrap">{fmt(remaining)} ₺</b>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {tab === "catalog" && allowOrders && (
        <MobileCartBar lines={lines} total={cartTotal} open={sheet} setOpen={setSheet} heldCount={heldTabs.length}>
          {heldTabs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-2" data-testid="b2b-held-tabs-mobile">
              {heldTabs.map((h) => (
                <button key={h.id} type="button" onClick={() => loadHeld(h.id)} className="px-2 py-1 rounded-lg text-[10px] font-bold border bg-amber-50 text-amber-900 border-amber-200" data-testid={`b2b-held-tab-mobile-${h.id}`}>
                  {h.label}
                </button>
              ))}
            </div>
          )}
          <CartBody {...cartBodyProps} suffix="-mobile" />
        </MobileCartBar>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  AlertCircle,
  Check,
  Minus,
  Package,
  Plus,
  Printer,
  Scale,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { API_URL, useAuth } from "../context/AuthContext";
import { CameraScanner } from "../components/CameraScanner";
import { isWeighableUnit, readScaleOnce, scaleSupported } from "../utils/scaleBridge";
import { printThermalReceipt } from "../utils/thermalReceipt";

const SECTORS = [
  { id: "market", label: "Market", hint: "Barkod + tartı + SKT odaklı hızlı satış", units: ["Adet", "Kg", "Lt"] },
  { id: "bakkal", label: "Bakkal", hint: "Küçük perakende, hızlı sepet", units: ["Adet", "Kg"] },
  { id: "giyim", label: "Giyim", hint: "Beden / barkod ile adetli satış", units: ["Adet"] },
  { id: "nalbur", label: "Nalbur", hint: "Metre / paket / adet ürünler", units: ["Adet", "Mt", "Paket"] },
];

function money(n) {
  return Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function newLineId() {
  return `ln_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function QuickSalePage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const barcodeRef = useRef(null);

  const [sectorId, setSectorId] = useState(() => localStorage.getItem("pos_sector") || "market");
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [barcode, setBarcode] = useState("");
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [customerName, setCustomerName] = useState("Perakende Müşteri");
  const [busy, setBusy] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [manualKg, setManualKg] = useState("");
  const [lotPicker, setLotPicker] = useState(null);
  const [lotOptions, setLotOptions] = useState([]);

  const sector = SECTORS.find((s) => s.id === sectorId) || SECTORS[0];

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/products`, { params: { company_id: companyId } });
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Ürünler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { localStorage.setItem("pos_sector", sectorId); }, [sectorId]);
  useEffect(() => { barcodeRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = products;
    if (sector.units?.length) {
      const allow = new Set(sector.units.map((u) => u.toLowerCase()));
      const soft = list.filter((p) => allow.has(String(p.unit || "").toLowerCase()));
      if (soft.length) list = soft;
    }
    if (!q) return list.slice(0, 80);
    return list
      .filter((p) => `${p.name || ""} ${p.sku || ""} ${p.barcode || ""}`.toLowerCase().includes(q))
      .slice(0, 80);
  }, [products, query, sector]);

  const totals = useMemo(() => {
    const subtotal = cart.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
    const vat = cart.reduce((s, l) => {
      const line = Number(l.quantity || 0) * Number(l.unit_price || 0);
      return s + (line * Number(l.vat_rate || 0)) / 100;
    }, 0);
    return { subtotal, vat, total: subtotal + vat };
  }, [cart]);

  const findByBarcode = (code) => {
    const c = String(code || "").trim();
    if (!c) return null;
    return (
      products.find((p) => String(p.barcode || "").trim() === c) ||
      products.find((p) => String(p.sku || "").trim() === c) ||
      null
    );
  };

  const makeLine = (product, qty, lot = null) => ({
    id: newLineId(),
    product_id: product.id || product._id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    unit: product.unit || "Adet",
    quantity: Number(qty) || 1,
    unit_price: Number(product.sale_price || 0),
    vat_rate: Number(product.vat_rate || 20),
    lot_id: lot?.id || null,
    lot_number: lot?.lot_number || "",
    serial_number: lot?.serial_number || "",
    production_date: lot?.production_date || null,
    expiry_date: lot?.expiry_date || null,
    weighed: isWeighableUnit(product.unit),
  });

  const openLotPicker = async (product, qty) => {
    try {
      const { data } = await axios.get(`${API_URL}/products/${product.id || product._id}/lots`);
      const lots = Array.isArray(data) ? data : [];
      if (!lots.length) {
        toast.error("Bu ürün için lot / seri kaydı yok. Stok kartından ekleyin.");
        return;
      }
      setLotOptions(lots);
      setLotPicker({ product, qty });
    } catch {
      toast.error("Lot listesi alınamadı");
    }
  };

  const addProduct = async (product, qtyOverride = null) => {
    if (!product) return;
    let qty = qtyOverride;
    if (qty == null) {
      if (isWeighableUnit(product.unit)) {
        const kg = Number(manualKg);
        if (kg > 0) {
          qty = kg;
          setManualKg("");
        } else {
          try {
            qty = await readScaleOnce({ baudRate: undefined });
            toast.success(`Tartı: ${qty} ${product.unit}`);
          } catch (err) {
            toast.error(err?.message || "Tartı okunamadı — kg girin");
            return;
          }
        }
      } else {
        qty = 1;
      }
    }

    if (product.track_lot || product.track_serial || product.track_expiry) {
      await openLotPicker(product, qty);
      return;
    }

    if (isWeighableUnit(product.unit)) {
      setCart((prev) => [...prev, makeLine(product, qty)]);
      return;
    }

    setCart((prev) => {
      const pid = product.id || product._id;
      const idx = prev.findIndex((l) => l.product_id === pid && !l.lot_id && !l.serial_number);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: Number(next[idx].quantity) + Number(qty) };
        return next;
      }
      return [...prev, makeLine(product, qty)];
    });
  };

  const confirmLot = (lot) => {
    if (!lotPicker) return;
    setCart((prev) => [...prev, makeLine(lotPicker.product, lotPicker.qty, lot)]);
    setLotPicker(null);
    setLotOptions([]);
  };

  const onBarcodeSubmit = async (e) => {
    e?.preventDefault?.();
    const code = barcode.trim();
    if (!code) return;
    const product = findByBarcode(code);
    setBarcode("");
    if (!product) {
      toast.error(`Barkod bulunamadı: ${code}`);
      return;
    }
    await addProduct(product);
    barcodeRef.current?.focus();
  };

  const bumpQty = (lineId, delta) => {
    setCart((prev) =>
      prev
        .map((l) => (l.id === lineId ? { ...l, quantity: Math.max(0, Number(l.quantity) + delta) } : l))
        .filter((l) => Number(l.quantity) > 0)
    );
  };

  const setLineQty = (lineId, qty) => {
    const n = Number(qty);
    if (!(n > 0)) {
      setCart((prev) => prev.filter((l) => l.id !== lineId));
      return;
    }
    setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, quantity: n } : l)));
  };

  const removeLine = (lineId) => setCart((prev) => prev.filter((l) => l.id !== lineId));
  const clearCart = () => setCart([]);

  const checkout = async () => {
    if (!cart.length) {
      toast.error("Sepet boş");
      return;
    }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API_URL}/pos/checkout`, {
        company_id: companyId,
        customer_name: customerName || "Perakende Müşteri",
        payment_method: paymentMethod,
        sector: sectorId,
        items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
          vat_rate: l.vat_rate,
          unit: l.unit,
          lot_id: l.lot_id,
          lot_number: l.lot_number,
          serial_number: l.serial_number,
          production_date: l.production_date,
          expiry_date: l.expiry_date,
          weighed: l.weighed,
        })),
      });
      const receipt = {
        ...(data.receipt || {}),
        company_name: data.receipt?.company_name || activeCompany?.name || "İşletme",
        payment_method: paymentMethod,
        sector: sector.label,
      };
      setLastReceipt(receipt);
      printThermalReceipt(receipt);
      toast.success(data.message || `Satış tamam: ${receipt.invoice_number}`);
      clearCart();
      await loadProducts();
      barcodeRef.current?.focus();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Satış tamamlanamadı");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="quick-sale-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShoppingCart className="w-7 h-7 text-emerald-600" />
            Hızlı Satış
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Perakende POS — barkod, tartı ve termal fiş. Sektör: {sector.label}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SECTORS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSectorId(s.id)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                sectorId === s.id
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
              data-testid={`pos-sector-${s.id}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500 -mt-2">{sector.hint}</p>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3 space-y-3">
          <form
            onSubmit={onBarcodeSubmit}
            className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap gap-2 items-center"
          >
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={barcodeRef}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Barkod okutun veya yazın + Enter"
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm"
                data-testid="pos-barcode-input"
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              className="px-3 py-2.5 rounded-lg border border-slate-200 text-sm hover:bg-slate-50"
            >
              Kamera
            </button>
            <div className="flex items-center gap-1 border border-slate-200 rounded-lg px-2 py-1.5">
              <Scale className="w-4 h-4 text-slate-500" />
              <input
                value={manualKg}
                onChange={(e) => setManualKg(e.target.value)}
                placeholder={scaleSupported() ? "kg / tartı" : "kg"}
                className="w-24 text-sm outline-none"
                data-testid="pos-manual-kg"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
            >
              Ekle
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="relative mb-3">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ürün ara (ad, SKU, barkod)"
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm"
                data-testid="pos-product-search"
              />
            </div>
            {loading ? (
              <p className="text-sm text-slate-500 py-8 text-center">Yükleniyor…</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[52vh] overflow-y-auto">
                {filtered.map((p) => (
                  <button
                    key={p.id || p._id}
                    type="button"
                    onClick={() => addProduct(p)}
                    className="text-left border border-slate-200 rounded-lg p-3 hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors"
                    data-testid={`pos-product-${p.id || p._id}`}
                  >
                    <div className="font-medium text-sm text-slate-900 line-clamp-2">{p.name}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {p.sku || "—"} · {p.unit || "Adet"}
                      {(p.track_lot || p.track_serial || p.track_expiry) && (
                        <span className="ml-1 text-amber-600">· lot/SKT</span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-emerald-700 font-semibold text-sm">₺{money(p.sale_price)}</span>
                      <span className="text-xs text-slate-500">Stok: {p.stock_quantity ?? 0}</span>
                    </div>
                  </button>
                ))}
                {!filtered.length && (
                  <p className="col-span-full text-sm text-slate-500 py-6 text-center">Ürün bulunamadı</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="xl:col-span-2">
          <div className="bg-white border border-slate-200 rounded-xl p-4 min-h-[420px] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4" /> Sepet ({cart.length})
              </h2>
              {cart.length > 0 && (
                <button type="button" onClick={clearCart} className="text-xs text-red-600 hover:underline">
                  Temizle
                </button>
              )}
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto max-h-[40vh]">
              {!cart.length && (
                <div className="text-center py-12 text-slate-400 text-sm">Barkod okutun veya ürün seçin</div>
              )}
              {cart.map((l) => (
                <div
                  key={l.id}
                  className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/60"
                  data-testid={`pos-cart-line-${l.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-slate-900 truncate">{l.name}</div>
                      <div className="text-xs text-slate-500">
                        ₺{money(l.unit_price)} / {l.unit}
                        {l.lot_number ? ` · Lot ${l.lot_number}` : ""}
                        {l.serial_number ? ` · S/N ${l.serial_number}` : ""}
                        {l.expiry_date ? ` · SKT ${l.expiry_date}` : ""}
                      </div>
                    </div>
                    <button type="button" onClick={() => removeLine(l.id)} className="text-slate-400 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => bumpQty(l.id, isWeighableUnit(l.unit) ? -0.1 : -1)}
                        className="w-7 h-7 rounded border bg-white flex items-center justify-center"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number"
                        step="any"
                        value={l.quantity}
                        onChange={(e) => setLineQty(l.id, e.target.value)}
                        className="w-16 text-center text-sm border rounded py-1"
                      />
                      <button
                        type="button"
                        onClick={() => bumpQty(l.id, isWeighableUnit(l.unit) ? 0.1 : 1)}
                        className="w-7 h-7 rounded border bg-white flex items-center justify-center"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="font-semibold text-sm">₺{money(Number(l.quantity) * Number(l.unit_price))}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 mt-3 pt-3 space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Ara toplam</span>
                <span>₺{money(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-slate-600">
                <span>KDV</span>
                <span>₺{money(totals.vat)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-slate-900">
                <span>Toplam</span>
                <span data-testid="pos-total">₺{money(totals.total)}</span>
              </div>

              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Müşteri adı"
              />
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                data-testid="pos-payment-method"
              >
                <option value="cash">Nakit</option>
                <option value="card">Kart</option>
                <option value="transfer">Havale / EFT</option>
              </select>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy || !cart.length}
                  onClick={checkout}
                  className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  data-testid="pos-checkout-btn"
                >
                  <Check className="w-5 h-5" />
                  {busy ? "İşleniyor…" : "Satışı Tamamla"}
                </button>
                {lastReceipt && (
                  <button
                    type="button"
                    onClick={() => printThermalReceipt(lastReceipt)}
                    className="px-3 py-3 rounded-xl border border-slate-200 hover:bg-slate-50"
                    title="Son fişi yazdır"
                    data-testid="pos-reprint-btn"
                  >
                    <Printer className="w-5 h-5" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-400 flex items-start gap-1">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Satış onaylı e-arşiv fişi oluşturur, stok/lot düşer ve termal fiş penceresi açılır.
              </p>
            </div>
          </div>
        </div>
      </div>

      {showScanner && (
        <CameraScanner
          onScan={async (code) => {
            setShowScanner(false);
            const product = findByBarcode(code);
            if (!product) {
              toast.error(`Barkod bulunamadı: ${code}`);
              return;
            }
            await addProduct(product);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {lotPicker && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <h3 className="font-semibold">Lot / Seri Seç</h3>
                <p className="text-xs text-slate-500">{lotPicker.product.name}</p>
              </div>
              <button type="button" onClick={() => setLotPicker(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-3 space-y-2">
              {lotOptions.map((lot) => (
                <button
                  key={lot.id}
                  type="button"
                  onClick={() => confirmLot(lot)}
                  className="w-full text-left border rounded-lg p-3 hover:border-emerald-400 hover:bg-emerald-50/50"
                >
                  <div className="font-medium text-sm">{lot.lot_number || lot.serial_number || "Kayıt"}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    Miktar: {lot.quantity} · Ürt: {lot.production_date || "—"} · SKT: {lot.expiry_date || "—"}
                    {lot.serial_number ? ` · S/N ${lot.serial_number}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

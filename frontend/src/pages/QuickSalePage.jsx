import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  AlertCircle,
  Check,
  FolderPlus,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Minus,
  Package,
  Pencil,
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
import { resolveImageUrl } from "../utils/imageUrl";

const DEFAULT_SECTIONS = [{ id: "fav", name: "Favoriler", productIds: [] }];

function money(n) {
  return Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function newLineId() {
  return `ln_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function productKey(p) {
  return String(p?.id || p?._id || "");
}

function loadSections(companyId) {
  try {
    const raw = localStorage.getItem(`pos_sections_${companyId}`);
    if (!raw) return DEFAULT_SECTIONS.map((s) => ({ ...s, productIds: [] }));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_SECTIONS.map((s) => ({ ...s, productIds: [] }));
    return parsed.map((s, i) => ({
      id: String(s.id || `sec_${i}`),
      name: String(s.name || `Bölüm ${i + 1}`),
      productIds: Array.isArray(s.productIds) ? s.productIds.map(String) : [],
    }));
  } catch {
    return DEFAULT_SECTIONS.map((s) => ({ ...s, productIds: [] }));
  }
}

function ShortcutTile({ product, onClick, tablet }) {
  const img = resolveImageUrl(product.image_url);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left border border-slate-200 rounded-xl overflow-hidden hover:border-emerald-400 hover:shadow-sm transition bg-white active:scale-[0.98] ${tablet ? "min-h-[148px]" : ""}`}
      data-testid={`pos-shortcut-${productKey(product)}`}
    >
      <div className={`bg-slate-50 flex items-center justify-center overflow-hidden ${tablet ? "aspect-[4/3]" : "aspect-square"}`}>
        {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <Package className="w-8 h-8 text-slate-300" />}
      </div>
      <div className="p-2.5">
        <div className={`font-semibold text-slate-900 line-clamp-2 ${tablet ? "text-sm" : "text-xs"}`}>{product.name}</div>
        <div className="mt-1 flex items-center justify-between gap-1">
          <span className="text-emerald-700 font-bold text-sm">₺{money(product.sale_price)}</span>
          {(product.track_lot || product.track_serial || product.track_expiry) && (
            <span className="text-[10px] text-amber-600 font-semibold">lot/SKT</span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function QuickSalePage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const barcodeRef = useRef(null);

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
  const [tabletMode, setTabletMode] = useState(() => localStorage.getItem("pos_tablet") === "1");
  const [sections, setSections] = useState(() => loadSections(companyId));
  const [activeSectionId, setActiveSectionId] = useState(() => loadSections(companyId)[0]?.id || "fav");
  const [showSectionEditor, setShowSectionEditor] = useState(false);
  const [editorSectionId, setEditorSectionId] = useState(null);
  const [editorQuery, setEditorQuery] = useState("");

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

  useEffect(() => {
    const next = loadSections(companyId);
    setSections(next);
    setActiveSectionId(next[0]?.id || "fav");
  }, [companyId]);

  useEffect(() => {
    localStorage.setItem(`pos_sections_${companyId}`, JSON.stringify(sections));
  }, [sections, companyId]);

  useEffect(() => {
    localStorage.setItem("pos_tablet", tabletMode ? "1" : "0");
  }, [tabletMode]);

  useEffect(() => { barcodeRef.current?.focus(); }, [tabletMode]);

  const productMap = useMemo(() => {
    const map = new Map();
    products.forEach((p) => map.set(productKey(p), p));
    return map;
  }, [products]);

  const activeSection = sections.find((s) => s.id === activeSectionId) || sections[0];
  const editorSection = sections.find((s) => s.id === editorSectionId) || sections[0];

  const shortcutProducts = useMemo(() => {
    if (!activeSection) return [];
    return activeSection.productIds.map((id) => productMap.get(String(id))).filter(Boolean);
  }, [activeSection, productMap]);

  const filteredSearch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => `${p.name || ""} ${p.sku || ""} ${p.barcode || ""}`.toLowerCase().includes(q))
      .slice(0, 24);
  }, [products, query]);

  const editorProducts = useMemo(() => {
    const q = editorQuery.trim().toLowerCase();
    let list = products;
    if (q) list = list.filter((p) => `${p.name || ""} ${p.sku || ""} ${p.barcode || ""}`.toLowerCase().includes(q));
    return list.slice(0, 120);
  }, [products, editorQuery]);

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
    product_id: productKey(product),
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
    image_url: product.image_url || null,
  });

  const openLotPicker = async (product, qty) => {
    try {
      const { data } = await axios.get(`${API_URL}/products/${productKey(product)}/lots`);
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
            qty = await readScaleOnce({});
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
      const id = productKey(product);
      const idx = prev.findIndex((l) => l.product_id === id && !l.lot_id && !l.serial_number);
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
        payment_method: paymentMethod || "cash",
        sector: "retail",
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
        sector: activeSection?.name || "Hızlı Satış",
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

  const openEditor = (sectionId = activeSectionId) => {
    setEditorSectionId(sectionId || sections[0]?.id);
    setEditorQuery("");
    setShowSectionEditor(true);
  };

  const addSection = () => {
    const id = `sec_${Date.now()}`;
    const next = [...sections, { id, name: `Bölüm ${sections.length + 1}`, productIds: [] }];
    setSections(next);
    setEditorSectionId(id);
    setActiveSectionId(id);
  };

  const renameSection = (id, name) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, name: name || s.name } : s)));
  };

  const deleteSection = (id) => {
    if (sections.length <= 1) {
      toast.error("En az bir bölüm kalmalı");
      return;
    }
    const next = sections.filter((s) => s.id !== id);
    setSections(next);
    if (editorSectionId === id) setEditorSectionId(next[0].id);
    if (activeSectionId === id) setActiveSectionId(next[0].id);
  };

  const toggleProductInSection = (sectionId, prodId) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s;
        const has = s.productIds.includes(prodId);
        return { ...s, productIds: has ? s.productIds.filter((x) => x !== prodId) : [...s.productIds, prodId] };
      })
    );
  };

  const btnSize = tabletMode ? "min-h-14 text-base" : "min-h-11 text-sm";
  const shell = tabletMode
    ? "fixed inset-0 z-[100] bg-slate-100 overflow-hidden flex flex-col p-3 sm:p-4"
    : "space-y-4";

  return (
    <div className={shell} data-testid="quick-sale-page">
      <div className={`flex flex-wrap items-end justify-between gap-3 ${tabletMode ? "shrink-0" : ""}`}>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShoppingCart className="w-7 h-7 text-emerald-600" />
            Hızlı Satış
          </h1>
          <p className="text-sm text-slate-500 mt-1">Barkod, tartı ve termal fiş · Sağda resimli ürün kısayolları</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openEditor()} className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50 ${btnSize}`} data-testid="pos-edit-sections">
            <Pencil className="w-4 h-4" /> Bölümleri Düzenle
          </button>
          <button type="button" onClick={() => setTabletMode((v) => !v)} className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white font-semibold ${btnSize}`} data-testid="pos-tablet-toggle">
            {tabletMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            {tabletMode ? "Çık" : "Tablet Modu"}
          </button>
        </div>
      </div>

      <form onSubmit={onBarcodeSubmit} className={`bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap gap-2 items-center ${tabletMode ? "shrink-0 mt-3" : ""}`}>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input ref={barcodeRef} value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Barkod okutun veya yazın + Enter" className={`w-full pl-9 pr-3 border border-slate-200 rounded-lg ${btnSize}`} data-testid="pos-barcode-input" autoComplete="off" />
        </div>
        <button type="button" onClick={() => setShowScanner(true)} className={`px-3 rounded-lg border border-slate-200 hover:bg-slate-50 ${btnSize}`}>Kamera</button>
        <div className={`flex items-center gap-1 border border-slate-200 rounded-lg px-2 ${btnSize}`}>
          <Scale className="w-4 h-4 text-slate-500" />
          <input value={manualKg} onChange={(e) => setManualKg(e.target.value)} placeholder={scaleSupported() ? "kg / tartı" : "kg"} className="w-24 outline-none bg-transparent" data-testid="pos-manual-kg" />
        </div>
        <button type="submit" className={`px-4 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 ${btnSize}`}>Ekle</button>
      </form>

      <div className={`grid grid-cols-1 xl:grid-cols-5 gap-4 ${tabletMode ? "flex-1 min-h-0 mt-3" : ""}`}>
        <div className={`xl:col-span-2 ${tabletMode ? "min-h-0 flex flex-col" : ""}`}>
          <div className={`bg-white border border-slate-200 rounded-xl p-4 flex flex-col ${tabletMode ? "flex-1 min-h-0" : "min-h-[420px]"}`}>
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2"><Package className="w-4 h-4" /> Sepet ({cart.length})</h2>
              {cart.length > 0 && <button type="button" onClick={clearCart} className="text-xs text-red-600 hover:underline">Temizle</button>}
            </div>

            <div className={`flex-1 space-y-2 overflow-y-auto ${tabletMode ? "min-h-0" : "max-h-[36vh]"}`}>
              {!cart.length && <div className="text-center py-10 text-slate-400 text-sm">Barkod okutun veya sağdan ürün seçin</div>}
              {cart.map((l) => (
                <div key={l.id} className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/60" data-testid={`pos-cart-line-${l.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex gap-2">
                      <div className="w-10 h-10 rounded-md bg-white border overflow-hidden shrink-0 flex items-center justify-center">
                        {l.image_url ? <img src={resolveImageUrl(l.image_url)} alt="" className="w-full h-full object-cover" /> : <Package className="w-4 h-4 text-slate-300" />}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-slate-900 truncate">{l.name}</div>
                        <div className="text-xs text-slate-500">
                          ₺{money(l.unit_price)} / {l.unit}
                          {l.lot_number ? ` · Lot ${l.lot_number}` : ""}
                          {l.serial_number ? ` · S/N ${l.serial_number}` : ""}
                          {l.expiry_date ? ` · SKT ${l.expiry_date}` : ""}
                        </div>
                      </div>
                    </div>
                    <button type="button" onClick={() => removeLine(l.id)} className="text-slate-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => bumpQty(l.id, isWeighableUnit(l.unit) ? -0.1 : -1)} className={`rounded-lg border bg-white flex items-center justify-center ${tabletMode ? "w-11 h-11" : "w-8 h-8"}`}><Minus className="w-4 h-4" /></button>
                      <input type="number" step="any" value={l.quantity} onChange={(e) => setLineQty(l.id, e.target.value)} className={`text-center border rounded-lg py-1 font-semibold ${tabletMode ? "w-20 text-base" : "w-16 text-sm"}`} />
                      <button type="button" onClick={() => bumpQty(l.id, isWeighableUnit(l.unit) ? 0.1 : 1)} className={`rounded-lg border bg-white flex items-center justify-center ${tabletMode ? "w-11 h-11" : "w-8 h-8"}`}><Plus className="w-4 h-4" /></button>
                    </div>
                    <div className="font-semibold text-sm">₺{money(Number(l.quantity) * Number(l.unit_price))}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 mt-3 pt-3 space-y-2 shrink-0">
              <div className="flex justify-between text-sm text-slate-600"><span>Ara toplam</span><span>₺{money(totals.subtotal)}</span></div>
              <div className="flex justify-between text-sm text-slate-600"><span>KDV</span><span>₺{money(totals.vat)}</span></div>
              <div className="flex justify-between text-lg font-bold text-slate-900"><span>Toplam</span><span data-testid="pos-total">₺{money(totals.total)}</span></div>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={`w-full border border-slate-200 rounded-lg px-3 ${btnSize}`} placeholder="Müşteri adı" />
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={`w-full border border-slate-200 rounded-lg px-3 ${btnSize}`} data-testid="pos-payment-method">
                <option value="cash">Nakit</option>
                <option value="card">Kart</option>
                <option value="transfer">Havale / EFT</option>
              </select>
              <div className="flex gap-2 pt-1">
                <button type="button" disabled={busy || !cart.length} onClick={checkout} className={`flex-1 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2 ${tabletMode ? "py-4 text-lg" : "py-3"}`} data-testid="pos-checkout-btn">
                  <Check className="w-5 h-5" />{busy ? "İşleniyor…" : "Satışı Tamamla"}
                </button>
                {lastReceipt && (
                  <button type="button" onClick={() => printThermalReceipt(lastReceipt)} className={`px-3 rounded-xl border border-slate-200 hover:bg-slate-50 ${tabletMode ? "py-4" : "py-3"}`} title="Son fişi yazdır" data-testid="pos-reprint-btn">
                    <Printer className="w-5 h-5" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-400 flex items-start gap-1"><AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />Satış onaylı e-arşiv fişi oluşturur, stok/lot düşer ve termal fiş penceresi açılır.</p>
            </div>
          </div>
        </div>

        <div className={`xl:col-span-3 ${tabletMode ? "min-h-0 flex flex-col" : ""}`}>
          <div className={`bg-white border border-slate-200 rounded-xl p-3 flex flex-col ${tabletMode ? "flex-1 min-h-0" : ""}`}>
            <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0">
              <LayoutGrid className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-semibold text-slate-800">Ürün Kısayolları</span>
              <div className="flex flex-wrap gap-1.5 ml-auto">
                {sections.map((s) => (
                  <button key={s.id} type="button" onClick={() => setActiveSectionId(s.id)} className={`px-3 rounded-full border font-semibold transition-colors ${btnSize} ${activeSectionId === s.id ? "bg-emerald-600 text-white border-emerald-600" : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"}`} data-testid={`pos-section-${s.id}`}>
                    {s.name}<span className="ml-1 opacity-70 text-xs">{s.productIds.length}</span>
                  </button>
                ))}
                <button type="button" onClick={addSection} className={`px-3 rounded-full border border-dashed border-slate-300 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1 ${btnSize}`} data-testid="pos-add-section" title="Yeni bölüm"><FolderPlus className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="relative mb-3 shrink-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tüm ürünlerde ara (ad, SKU, barkod)" className={`w-full pl-9 pr-3 border border-slate-200 rounded-lg ${btnSize}`} data-testid="pos-product-search" />
            </div>

            {query.trim() ? (
              <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 overflow-y-auto ${tabletMode ? "flex-1 min-h-0" : "max-h-[58vh]"}`}>
                {filteredSearch.map((p) => (
                  <ShortcutTile key={productKey(p)} product={p} tablet={tabletMode} onClick={() => addProduct(p)} />
                ))}
                {!filteredSearch.length && <p className="col-span-full text-sm text-slate-500 py-8 text-center">Aramada ürün yok</p>}
              </div>
            ) : loading ? (
              <p className="text-sm text-slate-500 py-10 text-center">Yükleniyor…</p>
            ) : (
              <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 overflow-y-auto ${tabletMode ? "flex-1 min-h-0" : "max-h-[58vh]"}`} data-testid="pos-shortcut-grid">
                {shortcutProducts.map((p) => (
                  <ShortcutTile key={productKey(p)} product={p} tablet={tabletMode} onClick={() => addProduct(p)} />
                ))}
                {!shortcutProducts.length && (
                  <div className="col-span-full text-center py-12 px-4">
                    <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm text-slate-600 font-medium">Bu bölümde ürün yok</p>
                    <p className="text-xs text-slate-400 mt-1 mb-4">Tablette hızlı seçim için bölüme resimli ürünler ekleyin.</p>
                    <button type="button" onClick={() => openEditor(activeSectionId)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold" data-testid="pos-empty-edit-section">
                      <Pencil className="w-4 h-4" /> Bölüme ürün ekle
                    </button>
                  </div>
                )}
              </div>
            )}
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
        <div className="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <h3 className="font-semibold">Lot / Seri Seç</h3>
                <p className="text-xs text-slate-500">{lotPicker.product.name}</p>
              </div>
              <button type="button" onClick={() => setLotPicker(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto p-3 space-y-2">
              {lotOptions.map((lot) => (
                <button key={lot.id} type="button" onClick={() => confirmLot(lot)} className="w-full text-left border rounded-lg p-3 hover:border-emerald-400 hover:bg-emerald-50/50 min-h-14">
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

      {showSectionEditor && editorSection && (
        <div className="fixed inset-0 z-[110] bg-black/45 flex items-center justify-center p-3 sm:p-6" data-testid="pos-section-editor">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <h3 className="font-bold text-slate-900">Kısayol Bölümleri</h3>
                <p className="text-xs text-slate-500">Sağ panelde görünecek ürünleri bölüm butonlarıyla gruplayın</p>
              </div>
              <button type="button" onClick={() => setShowSectionEditor(false)} className="p-2 rounded-lg hover:bg-slate-100" data-testid="pos-section-editor-close"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex flex-wrap gap-2 px-4 py-3 border-b bg-slate-50">
              {sections.map((s) => (
                <button key={s.id} type="button" onClick={() => setEditorSectionId(s.id)} className={`px-3 py-2 rounded-xl text-sm font-semibold border ${editorSectionId === s.id ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-slate-200"}`}>{s.name}</button>
              ))}
              <button type="button" onClick={addSection} className="px-3 py-2 rounded-xl text-sm font-semibold border border-dashed border-slate-300 inline-flex items-center gap-1"><Plus className="w-4 h-4" /> Bölüm</button>
            </div>

            <div className="px-4 py-3 flex flex-wrap gap-2 items-center border-b">
              <input value={editorSection.name} onChange={(e) => renameSection(editorSection.id, e.target.value)} className="flex-1 min-w-[160px] border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold" data-testid="pos-section-name" />
              <button type="button" onClick={() => deleteSection(editorSection.id)} className="px-3 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50">Bölümü Sil</button>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={editorQuery} onChange={(e) => setEditorQuery(e.target.value)} placeholder="Ürün ara…" className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm" data-testid="pos-section-product-search" />
              </div>
            </div>

            <div className="overflow-y-auto p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
              {editorProducts.map((p) => {
                const id = productKey(p);
                const checked = editorSection.productIds.includes(id);
                const img = resolveImageUrl(p.image_url);
                return (
                  <button key={id} type="button" onClick={() => toggleProductInSection(editorSection.id, id)} className={`flex items-center gap-3 text-left border rounded-xl p-2.5 min-h-16 ${checked ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`} data-testid={`pos-section-product-${id}`}>
                    <div className="w-14 h-14 rounded-lg bg-slate-100 border overflow-hidden shrink-0 flex items-center justify-center">
                      {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <Package className="w-5 h-5 text-slate-300" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-slate-900 truncate">{p.name}</div>
                      <div className="text-xs text-slate-500 truncate">{p.sku || p.barcode || "—"} · ₺{money(p.sale_price)}</div>
                    </div>
                    <div className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 ${checked ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-slate-300"}`}>
                      {checked && <Check className="w-4 h-4" />}
                    </div>
                  </button>
                );
              })}
              {!editorProducts.length && <p className="col-span-full text-center text-sm text-slate-500 py-8">Ürün bulunamadı</p>}
            </div>

            <div className="px-4 py-3 border-t flex justify-end">
              <button type="button" onClick={() => { setShowSectionEditor(false); setActiveSectionId(editorSection.id); }} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold" data-testid="pos-section-editor-done">Tamam</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

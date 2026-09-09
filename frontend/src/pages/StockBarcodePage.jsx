import React, { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { useSearchParams, useNavigate } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import {
  Package,
  Plus,
  QrCode,
  Printer,
  Search,
  AlertTriangle,
  Layers,
  ArrowDownUp,
  X,
  Scan,
  CheckCircle2,
  Tag,
  Images,
  Pencil,
  ClipboardList,
  Factory,
  MoreHorizontal,
  Trash2,
  Sparkles,
  ShoppingCart,
} from "lucide-react";
import { StockCountPanel } from "../components/StockCountPanel";
import { StockToolbar, applyStockFilters, STOCK_FILTER_DEFAULTS } from "../components/StockToolbar";
import { ProductionOrderModal } from "../components/ProductionOrderModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { ProductProfitPanel } from "../components/ProductProfitPanel";
import { LabelDesigner, LabelQuickPrint } from "../components/LabelDesigner";
import { BarcodeRenderer } from "../components/BarcodeRenderer";
import { ProductDetailModal } from "../components/ProductDetailModal";
import { AiStockImportModal } from "../components/AiStockImportModal";
import { resolveImageUrl } from "../utils/imageUrl";
import { ScanButton } from "../components/CameraScanner";

export default function StockBarcodePage() {
  const { activeCompany } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [pageTab, setPageTab] = useState(searchParams.get("tab") || "products");
  const [products, setProducts] = useState([]);
  const [labelQuickProduct, setLabelQuickProduct] = useState(null);
  const [filterCategory, setFilterCategory] = useState("all");
  const [searchTerm, setSearchTerm] = useState(searchParams.get("q") || "");
  const [stockF, setStockF] = useState(STOCK_FILTER_DEFAULTS);
  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const loadCategories = useCallback(() => axios.get(`${API_URL}/products/categories?company_id=${activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}`).then((r) => setCategories(r.data)).catch(() => {}), [activeCompany]);
  const [loading, setLoading] = useState(true);

  // Modals & Scanner state
  const [showAddModal, setShowAddModal] = useState(false);
  const [aiStockImport, setAiStockImport] = useState(false);
  const [printBarcodeProduct, setPrintBarcodeProduct] = useState(null);
  const [showScannerModal, setShowScannerModal] = useState(searchParams.get("scan") === "true");
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [scanResultProduct, setScanResultProduct] = useState(null);
  const [detailProduct, setDetailProduct] = useState(null);
  const [produceProduct, setProduceProduct] = useState(null);
  const [reorder, setReorder] = useState(null);
  const [detailTab, setDetailTab] = useState("images");
  const [withVariants, setWithVariants] = useState(false);

  const openDetail = (prod, tab = "images") => {
    setDetailTab(tab);
    setDetailProduct(prod);
  };

  const toggleFlag = async (prod, field) => {
    try {
      const res = await axios.put(`${API_URL}/products/${prod.id}`, { [field]: !(prod[field] !== false) });
      setProducts((prev) => prev.map((p) => (p.id === res.data.id ? res.data : p)));
      toast.success(field === "show_in_b2b" ? (res.data.show_in_b2b ? "Ürün B2B portalında gösteriliyor." : "Ürün B2B portalından gizlendi.") : (res.data.track_stock ? "Stok takibi açıldı." : "Stok takibi kapatıldı."));
    } catch { toast.error("Güncellenemedi."); }
  };

  const handleProductUpdated = (updated) => {
    setDetailProduct(updated);
    setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleDeleteProduct = async (prod) => {
    if (!window.confirm(`${prod.name} stok kartı çöp kutusuna taşınsın mı? İşlem görmüş kartlar cari bakiyesini etkilememek için silinemez.`)) return;
    try {
      const r = await axios.delete(`${API_URL}/products/${prod.id || prod._id}`);
      toast.success(r.data.message || "Stok kartı silindi.");
      setProducts((prev) => prev.filter((p) => (p.id || p._id) !== (prod.id || prod._id)));
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Stok kartı silinemedi.");
    }
  };

  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const openReorder = async (productIds) => {
    try {
      const qs = productIds?.length ? `&product_ids=${productIds.join(",")}` : "";
      const [prev, cnt] = await Promise.all([
        axios.get(`${API_URL}/products/reorder-preview?company_id=${companyId}${qs}`),
        axios.get(`${API_URL}/contacts?company_id=${companyId}`),
      ]);
      const suppliers = (cnt.data || []).filter((c) => c.type !== "customer");
      const all = cnt.data || [];
      setReorder({ lines: prev.data.lines || [], contacts: suppliers.length ? suppliers : all, fallback: "", busy: false });
      if (!(prev.data.lines || []).length) toast.error("Alınacak ürün yok (kritik stok bulunamadı).");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Satın alma önerisi yüklenemedi.");
    }
  };
  const submitReorder = async () => {
    if (!reorder?.lines?.length) return;
    setReorder((s) => ({ ...s, busy: true }));
    try {
      const r = await axios.post(`${API_URL}/products/reorder-purchases`, {
        company_id: companyId,
        contact_id: reorder.fallback || undefined,
        lines: reorder.lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) || 1, unit_price: l.unit_price, contact_id: l.contact_id || reorder.fallback, vat_rate: l.vat_rate })),
      });
      toast.success(r.data.message);
      const first = (r.data.invoices || [])[0];
      setReorder(null);
      if (first?.id) navigate(`/invoices?type=purchase`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Alış faturası oluşturulamadı.");
      setReorder((s) => ({ ...s, busy: false }));
    }
  };

  // New Product Form
  const [newProduct, setNewProduct] = useState({
    name: "",
    sku: "",
    barcode: "",
    type: "product",
    category: "Elektronik",
    unit: "Adet",
    vat_rate: 20,
    purchase_price: 0,
    sale_price: 0,
    stock_quantity: 0,
    min_stock_alert: 10,
    warehouse_id: "wh_main",
    show_in_b2b: true,
    track_stock: true,
    gtip: "",
    origin_country: ""
  });

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/products?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}&category=${encodeURIComponent(filterCategory)}`);
      loadCategories();
      axios.get(`${API_URL}/products/units?company_id=${activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}`).then((r) => setUnits(r.data)).catch(() => {});
      setProducts(res.data);
    } catch (err) {
      toast.error("Ürünler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [activeCompany, filterCategory, loadCategories]);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    if (!newProduct.name || !newProduct.sku) {
      toast.error("Lütfen ürün adı ve SKU kodunu girin.");
      return;
    }
    try {
      const res = await axios.post(`${API_URL}/products`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        ...newProduct,
        purchase_price: Number(newProduct.purchase_price || 0),
        sale_price: Number(newProduct.sale_price || 0),
        stock_quantity: Number(newProduct.stock_quantity || 0),
        min_stock_alert: Number(newProduct.min_stock_alert || 5),
        has_variants: withVariants
      });
      toast.success("Ürün ve barkodu başarıyla oluşturuldu.");
      setShowAddModal(false);
      loadProducts();
      openDetail(res.data, withVariants ? "variants" : "images");
    } catch (err) {
      toast.error("Ürün kaydedilemedi.");
    }
  };

  const handleScanBarcode = async (barcode) => {
    if (!barcode) return;
    try {
      const res = await axios.get(`${API_URL}/products/barcode/${barcode}?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`);
      setScanResultProduct(res.data);
      toast.success(`Ürün Bulundu: ${res.data.name}`);
    } catch (err) {
      toast.error("Barkod ile eşleşen ürün bulunamadı.");
      setScanResultProduct(null);
    }
  };

  const handleStockAdjustment = async (productId, change, variantId = null) => {
    try {
      const res = await axios.post(`${API_URL}/products/quick-stock-adjust`, {
        product_id: productId,
        variant_id: variantId,
        quantity_change: change,
        reason: "Hızlı Barkod Terminali Giriş/Çıkış"
      });
      toast.success(variantId ? `Varyant stoğu: ${res.data.new_variant_stock} • Toplam: ${res.data.new_stock}` : `Stok güncellendi. Yeni stok: ${res.data.new_stock}`);
      if (scanResultProduct && (scanResultProduct.id === productId || scanResultProduct._id === productId)) {
        const mv = scanResultProduct.matched_variant;
        setScanResultProduct({
          ...scanResultProduct,
          stock_quantity: res.data.new_stock,
          matched_variant: mv && variantId ? { ...mv, stock: res.data.new_variant_stock } : mv
        });
      }
      loadProducts();
    } catch (err) {
      toast.error("Stok güncellenemedi.");
    }
  };

  const filtered = useMemo(() => applyStockFilters(products.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.barcode || "").includes(searchTerm)
  ), stockF), [products, searchTerm, stockF]);
  const stockValue = useMemo(() => filtered.reduce((t, p) => t + (p.track_stock === false ? 0 : (p.stock_quantity || 0) * (p.purchase_price || 0)), 0), [filtered]);
  const criticalCount = useMemo(() => products.filter((p) => p.track_stock !== false && p.stock_quantity <= (p.min_stock_alert ?? 0)).length, [products]);

  return (
    <div className="space-y-6" data-testid="stock-page">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Stoklar & Ürünler</h1>
          <p className="text-xs sm:text-sm text-slate-500">Ürünler, Varyantlar, Barkod Yazdırma ve Hızlı Terminal Modu</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setShowScannerModal(true)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-indigo-600/20 transition"
            data-testid="open-scanner-modal-btn"
          >
            <Scan className="w-4 h-4" />
            <span>Barkod Okuyucu</span>
          </button>
          <button
            onClick={() => setPageTab("count")}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-violet-600/20 transition"
            data-testid="go-stock-count-btn"
          >
            <ClipboardList className="w-4 h-4" />
            <span>Stok Sayımı</span>
          </button>
          <button
            onClick={() => setAiStockImport(true)}
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-purple-600/20 transition"
            data-testid="ai-stock-import-btn"
          >
            <Sparkles className="w-4 h-4" />
            <span>AI ile Yükle (Excel/PDF)</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-600/20 transition"
            data-testid="add-product-btn"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Ürün / Stok</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {[["products", "Ürünler & Stoklar", Package], ["count", "Barkodlu Stok Sayımı", ClipboardList], ["labels", "Etiket Tasarımı", ClipboardList]].map(([k, l, Icon]) => (
          <button key={k} onClick={() => setPageTab(k)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px ${pageTab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`} data-testid={`stock-tab-${k}`}><Icon className="w-3.5 h-3.5" /> {l}</button>
        ))}
      </div>
      <datalist id="product-units-list">{units.map((u) => <option key={u.name} value={u.name} />)}</datalist>
      <datalist id="product-categories-list">{categories.map((c) => <option key={c.name} value={c.name} />)}</datalist>
      {aiStockImport && <AiStockImportModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setAiStockImport(false)} onSaved={loadProducts} />}
      {produceProduct && <ProductionOrderModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} product={produceProduct} onClose={() => setProduceProduct(null)} onCreated={loadProducts} />}
      {labelQuickProduct && <LabelQuickPrint companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} product={labelQuickProduct} company={activeCompany} onClose={() => setLabelQuickProduct(null)} onOpenDesigner={() => { setLabelQuickProduct(null); setPageTab("labels"); }} />}
      {reorder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" data-testid="stock-reorder-modal">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-5 space-y-3 shadow-2xl max-h-[90vh] overflow-y-auto text-xs">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-amber-700" /><h3 className="text-base font-bold text-slate-900">Tedarikçi satın alma</h3></div>
              <button type="button" onClick={() => setReorder(null)} className="text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-slate-500">Min. stok eksiği kadar taslak alış faturası. Son alış tedarikçisi ve fiyatı doldurulur; yoksa aşağıdan tedarikçi seçin.</p>
            <div className="flex items-center gap-2">
              <label className="font-semibold text-slate-600 whitespace-nowrap">Varsayılan tedarikçi</label>
              <select value={reorder.fallback} onChange={(e) => setReorder((s) => ({ ...s, fallback: e.target.value }))} className="flex-1 bg-slate-50 border rounded-lg p-1.5" data-testid="stock-reorder-fallback">
                <option value="">— satırdaki / son alış —</option>
                {reorder.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="border rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-2 py-1.5">Ürün</th><th className="px-2 py-1.5 text-right">Stok / Min</th><th className="px-2 py-1.5 text-right">Sipariş</th><th className="px-2 py-1.5 text-right">Birim ₺</th><th className="px-2 py-1.5">Tedarikçi</th></tr></thead>
                <tbody>
                  {reorder.lines.map((l, i) => (
                    <tr key={l.product_id} className="border-t" data-testid={`stock-reorder-row-${l.sku}`}>
                      <td className="px-2 py-1.5"><div className="font-semibold text-slate-900">{l.name}</div><div className="font-mono text-[10px] text-slate-400">{l.sku}</div></td>
                      <td className="px-2 py-1.5 text-right">{l.stock_quantity} / {l.min_stock_alert}</td>
                      <td className="px-2 py-1.5"><input type="number" min="1" value={l.quantity} onChange={(e) => setReorder((s) => ({ ...s, lines: s.lines.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x) }))} className="w-20 bg-slate-50 border rounded p-1 text-right" data-testid={`stock-reorder-qty-${l.sku}`} /></td>
                      <td className="px-2 py-1.5 text-right">{Number(l.unit_price || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</td>
                      <td className="px-2 py-1.5">
                        <select value={l.contact_id || reorder.fallback} onChange={(e) => setReorder((s) => ({ ...s, lines: s.lines.map((x, idx) => idx === i ? { ...x, contact_id: e.target.value, contact_name: (s.contacts.find((c) => c.id === e.target.value) || {}).name || "" } : x) }))} className="w-full bg-slate-50 border rounded p-1" data-testid={`stock-reorder-supplier-${l.sku}`}>
                          <option value="">Seçin</option>
                          {reorder.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setReorder(null)} className="px-3 py-1.5 border rounded-lg">İptal</button>
              <button type="button" disabled={reorder.busy || !reorder.lines.length} onClick={submitReorder} className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="stock-reorder-submit">{reorder.busy ? "Oluşturuluyor…" : "Taslak alış oluştur"}</button>
            </div>
          </div>
        </div>
      )}
      {labelQuickProduct && <LabelQuickPrint companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} product={labelQuickProduct} products={products} company={activeCompany} onClose={() => setLabelQuickProduct(null)} onOpenDesigner={() => { setLabelQuickProduct(null); setPageTab("labels"); }} />}
      {labelQuickProduct && <LabelQuickPrint companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} product={labelQuickProduct} products={products} company={activeCompany} onClose={() => setLabelQuickProduct(null)} />}
      {pageTab === "labels" && <LabelDesigner companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} products={products} company={activeCompany} />}
      {pageTab === "count" && <StockCountPanel companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} warehouses={[]} />}
      {pageTab === "products" && (<>
      <ProductProfitPanel companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
      <StockToolbar categories={categories} filterCategory={filterCategory} setFilterCategory={setFilterCategory} f={stockF} setF={setStockF} search={searchTerm} setSearch={setSearchTerm} count={filtered.length} stockValue={stockValue} criticalCount={criticalCount} rows={filtered} onReorderCritical={() => openReorder()} />

      {/* Products Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-4 py-3">Ürün & SKU</th>
                <th className="px-4 py-3">Barkod (EAN-13)</th>
                <th className="px-4 py-3">Kategori / Tür</th>
                <th className="px-4 py-3 text-right">Alış Fiyatı</th>
                <th className="px-4 py-3 text-right">Satış Fiyatı</th>
                <th className="px-4 py-3 text-center">Mevcut Stok</th>
                <th className="px-4 py-3 text-center whitespace-nowrap">B2B / Takip</th>
                <th className="px-4 py-3 text-center w-[168px]">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((prod) => {
                const isCritical = prod.stock_quantity <= prod.min_stock_alert;
                return (
                  <tr key={prod.id || prod._id} className="hover:bg-slate-50/70 transition" data-testid={`prod-row-${prod.sku}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => openDetail(prod, "images")}
                          className="w-11 h-11 shrink-0 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center text-slate-400 hover:ring-2 hover:ring-emerald-500 transition"
                          title="Görselleri Yönet"
                          data-testid={`product-thumb-${prod.sku}`}
                        >
                          {prod.image_url ? <img src={resolveImageUrl(prod.image_url)} alt={prod.name} className="w-full h-full object-cover" /> : <Package className="w-4 h-4" />}
                        </button>
                        <div>
                          <div className="font-bold text-slate-900">{prod.name}</div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-indigo-600 font-semibold">SKU: {prod.sku}</span>
                            {(prod.tags || []).map((t) => <span key={t} className="bg-indigo-50 text-indigo-700 border border-indigo-100 rounded px-1 py-0.5 text-[9px] font-semibold">{t}</span>)}
                            {prod.variants?.length > 0 && (
                              <button onClick={() => openDetail(prod, "variants")} className="inline-flex items-center gap-1 bg-violet-50 text-violet-700 border border-violet-200 rounded-md px-1.5 py-0.5 text-[10px] font-bold hover:bg-violet-100" data-testid={`variant-badge-${prod.sku}`}>
                                <Layers className="w-3 h-3" /> {prod.variants.length} Varyant
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-slate-700">
                      <div className="flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-slate-400" />
                        <span>{prod.barcode}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium text-[11px]">
                        {prod.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 font-medium" data-testid={`stock-purchase-${prod.sku}`}>
                      <div>{prod.purchase_price?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</div>
                      {prod.last_purchase_price != null && (
                        <div className="text-[10px] text-amber-800 font-semibold" data-testid={`stock-last-buy-${prod.sku}`}>
                          son {Number(prod.last_purchase_price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                          {prod.last_purchase_date ? ` · ${String(prod.last_purchase_date).slice(8, 10)}.${String(prod.last_purchase_date).slice(5, 7)}` : ""}
                        </div>
                      )}
                      {(prod.purchase_costs || []).length > 1 && (
                        <div className="text-[10px] text-slate-400 truncate max-w-[140px] ml-auto" title={(prod.purchase_costs || []).map((c) => `${c.date || ""} ${Number(c.unit_price).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`).join(" · ")}>
                          {(prod.purchase_costs || []).slice(0, 3).map((c) => Number(c.unit_price).toLocaleString("tr-TR", { minimumFractionDigits: 2 })).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {prod.sale_price?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                        isCritical ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {isCritical && <AlertTriangle className="w-3 h-3 text-rose-600" />}
                        {prod.track_stock === false ? "Takip yok" : `${prod.stock_quantity} ${prod.unit}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                        <button onClick={() => toggleFlag(prod, "show_in_b2b")} className={`px-2 py-0.5 rounded-md text-[10px] font-bold border whitespace-nowrap ${prod.show_in_b2b !== false ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-100 text-slate-400 border-slate-200"}`} title="B2B portalında göster/gizle" data-testid={`b2b-toggle-${prod.sku}`}>B2B {prod.show_in_b2b !== false ? "Açık" : "Kapalı"}</button>
                        <button onClick={() => toggleFlag(prod, "track_stock")} className={`px-2 py-0.5 rounded-md text-[10px] font-bold border whitespace-nowrap ${prod.track_stock !== false ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-400 border-slate-200"}`} title="Stok takibi aç/kapat" data-testid={`track-toggle-${prod.sku}`}>Takip {prod.track_stock !== false ? "Açık" : "Kapalı"}</button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center w-[168px] min-w-[168px]">
                      <div className="inline-flex items-center justify-center gap-1">
                        {prod.type !== "service" && prod.type !== "raw_material" ? (
                          <button onClick={() => setProduceProduct(prod)} className={`p-1.5 rounded-lg transition ${prod.track_stock !== false && (prod.stock_quantity || 0) <= 0 ? "text-rose-600 bg-rose-50 hover:bg-rose-100 animate-pulse" : "text-slate-600 hover:text-amber-600 hover:bg-amber-50"}`} title={(prod.stock_quantity || 0) <= 0 ? "Stokta yok — Üretim Emri Ver" : "Üretim Emri Ver"} data-testid={`produce-btn-${prod.sku}`}>
                            <Factory className="w-4 h-4" />
                          </button>
                        ) : <span className="w-7 h-7 inline-block" aria-hidden="true" />}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
                              title="Diğer işlemler"
                              data-testid={`product-more-btn-${prod.sku}`}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onSelect={() => openDetail(prod, "images")} data-testid={`images-btn-${prod.sku}`}>
                              <Images className="w-4 h-4" /> Görseller
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openDetail(prod, "variants")} data-testid={`variants-btn-${prod.sku}`}>
                              <Layers className="w-4 h-4" /> Varyantlar
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setLabelQuickProduct(prod)} data-testid={`label-quick-btn-${prod.sku}`}>
                              <Tag className="w-4 h-4" /> Etiket yazdır
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setPrintBarcodeProduct(prod)} data-testid={`print-barcode-btn-${prod.sku}`}>
                              <Printer className="w-4 h-4" /> Hızlı barkod
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openReorder([prod.id || prod._id])} data-testid={`reorder-btn-${prod.sku}`}>
                              <ShoppingCart className="w-4 h-4" /> Tedarikçiden al
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => handleDeleteProduct(prod)}
                              className="text-rose-600 focus:text-rose-700 focus:bg-rose-50"
                              data-testid={`delete-product-btn-${prod.sku}`}
                            >
                              <Trash2 className="w-4 h-4" /> Stok kartını sil
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <button
                          onClick={() => openDetail(prod, "general")}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 text-white hover:bg-slate-800 rounded-lg text-[11px] font-semibold whitespace-nowrap"
                          title="Stok Kartını Düzenle"
                          data-testid={`edit-product-btn-${prod.sku}`}
                        >
                          <Pencil className="w-3 h-3" /> Düzenle
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* BARCODE SCANNER / TERMINAL MODAL */}
      {showScannerModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid="scanner-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <Scan className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">Hızlı Barkod Okuyucu Terminali</h3>
              </div>
              <button onClick={() => setShowScannerModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <p className="text-slate-500">
                El terminali veya barkod okuyucu cihazınızla barkodu okutabilir ya da aşağıdaki test barkodlarından birine tıklayabilirsiniz:
              </p>

              {/* Fast Test Barcode Buttons */}
              <div className="flex flex-wrap gap-1.5">
                {products.slice(0, 4).map(p => (
                  <button
                    key={p.barcode}
                    onClick={() => {
                      setScannedBarcode(p.barcode);
                      handleScanBarcode(p.barcode);
                    }}
                    className="px-2 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded text-[11px] font-mono border border-slate-200"
                  >
                    {p.name.slice(0, 18)}... ({p.barcode})
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Barkod numarası girin veya okutun..."
                  value={scannedBarcode}
                  onChange={(e) => setScannedBarcode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleScanBarcode(scannedBarcode)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono text-slate-900 text-sm font-bold"
                  data-testid="scanner-input"
                  autoFocus
                />
                <button
                  onClick={() => handleScanBarcode(scannedBarcode)}
                  className="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700"
                  data-testid="scanner-search-btn"
                >
                  Sorgula
                </button>
                <ScanButton onScan={(code) => { setScannedBarcode(code); handleScanBarcode(code); }} title="Kamera ile Barkod Okut" label="Kamera" />
              </div>

              {/* Scanned Result */}
              {scanResultProduct && (
                <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-4 space-y-3" data-testid="scanned-product-result">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{scanResultProduct.name}</h4>
                      <p className="text-indigo-700 font-mono text-xs">SKU: {scanResultProduct.sku} • {scanResultProduct.category}</p>
                    </div>
                    <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border">
                      {scanResultProduct.sale_price?.toLocaleString('tr-TR')} ₺
                    </span>
                  </div>

                  {scanResultProduct.matched_variant && (
                    <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5" data-testid="scanned-variant-info">
                      <Layers className="w-3.5 h-3.5 text-violet-600" />
                      <span className="font-semibold text-violet-800">Varyant: {scanResultProduct.matched_variant.name}</span>
                      <span className="text-violet-600 font-mono">({scanResultProduct.matched_variant.sku})</span>
                      <span className="ml-auto font-bold text-violet-900">Stok: {scanResultProduct.matched_variant.stock}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-indigo-200/60">
                    <span className="font-semibold text-slate-700">Toplam Stok: <strong className="text-emerald-700 font-bold">{scanResultProduct.stock_quantity} {scanResultProduct.unit}</strong></span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleStockAdjustment(scanResultProduct.id || scanResultProduct._id, 1, scanResultProduct.matched_variant?.variant_id)}
                        className="px-3 py-1 bg-emerald-600 text-white rounded font-bold hover:bg-emerald-700"
                        data-testid="scan-adjust-plus-btn"
                      >
                        +1 Ekle
                      </button>
                      <button
                        onClick={() => handleStockAdjustment(scanResultProduct.id || scanResultProduct._id, -1, scanResultProduct.matched_variant?.variant_id)}
                        className="px-3 py-1 bg-rose-600 text-white rounded font-bold hover:bg-rose-700"
                        data-testid="scan-adjust-minus-btn"
                      >
                        -1 Satış Yap
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      </>)}

      {/* PRINT BARCODE MODAL */}
      {printBarcodeProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl border border-slate-200 text-center" data-testid="print-barcode-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-sm font-bold text-slate-900">Barkod Etiketi Önizleme</h3>
              <button onClick={() => setPrintBarcodeProduct(null)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-2 border-dashed border-slate-300 rounded-xl bg-white space-y-2">
              <div className="font-bold text-xs text-slate-900 truncate">{printBarcodeProduct.name}</div>
              <div className="text-[10px] text-slate-500 font-mono">SKU: {printBarcodeProduct.sku}</div>
              <BarcodeRenderer code={printBarcodeProduct.barcode} width={180} height={45} />
              <div className="text-sm font-bold text-slate-900 pt-1">
                Fiyat: {printBarcodeProduct.sale_price?.toLocaleString('tr-TR')} ₺ <span className="text-[10px] text-slate-500 font-normal">(KDV Dahil)</span>
              </div>
            </div>

            <div className="flex justify-center gap-2 pt-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800"
              >
                <Printer className="w-3.5 h-3.5" /> Yazdır (Termal / A4)
              </button>
            </div>
          </div>
        </div>
      )}

      {detailProduct && (
        <ProductDetailModal
          key={`${detailProduct.id}-${detailTab}`}
          product={detailProduct}
          initialTab={detailTab}
          onClose={() => { setDetailProduct(null); loadProducts(); }}
          onUpdated={handleProductUpdated}
        />
      )}

      {/* ADD PRODUCT MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid="add-product-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Yeni Ürün / Stok Kartı Ekle</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveProduct} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ürün Adı</label>
                <input
                  type="text"
                  placeholder="Örn: Kablosuz Hızlı Şarj Standı"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="product-name-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">SKU / Stok Kodu</label>
                  <input
                    type="text"
                    placeholder="Örn: NX-CHG-01"
                    value={newProduct.sku}
                    onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                    data-testid="product-sku-input"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Barkod (Boşsa otomatik üretilir)</label>
                  <input
                    type="text"
                    placeholder="868..."
                    value={newProduct.barcode}
                    onChange={(e) => setNewProduct({ ...newProduct, barcode: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kategori</label>
                  <input
                    type="text"
                    list="product-categories-list"
                    value={newProduct.category}
                    onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Birim</label>
                  <input list="product-units-list" value={newProduct.unit} onChange={(e) => setNewProduct({ ...newProduct, unit: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium" placeholder="Adet" data-testid="new-product-unit" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Alış Fiyatı (₺)</label>
                  <input
                    type="number"
                    value={newProduct.purchase_price}
                    onChange={(e) => setNewProduct({ ...newProduct, purchase_price: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Satış Fiyatı (₺)</label>
                  <input
                    type="number"
                    value={newProduct.sale_price}
                    onChange={(e) => setNewProduct({ ...newProduct, sale_price: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900"
                    data-testid="product-price-input"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">KDV Oranı</label>
                  <select
                    value={newProduct.vat_rate}
                    onChange={(e) => setNewProduct({ ...newProduct, vat_rate: Number(e.target.value) })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  >
                    <option value="20">%20</option>
                    <option value="10">%10</option>
                    <option value="1">%1</option>
                    <option value="0">%0</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">GTIP (Gümrük)</label>
                  <input
                    value={newProduct.gtip}
                    onChange={(e) => setNewProduct({ ...newProduct, gtip: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                    placeholder="8471.30.00.00.00"
                    data-testid="product-gtip-input"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Menşe ülke</label>
                  <input
                    value={newProduct.origin_country}
                    onChange={(e) => setNewProduct({ ...newProduct, origin_country: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                    placeholder="TR, CN, DE…"
                    data-testid="product-origin-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Başlangıç Stoğu</label>
                  <input
                    type="number"
                    value={newProduct.stock_quantity}
                    onChange={(e) => setNewProduct({ ...newProduct, stock_quantity: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold"
                    data-testid="product-stock-input"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kritik Stok Uyarısı</label>
                  <input
                    type="number"
                    value={newProduct.min_stock_alert}
                    onChange={(e) => setNewProduct({ ...newProduct, min_stock_alert: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 cursor-pointer"><input type="checkbox" checked={newProduct.show_in_b2b} onChange={(e) => setNewProduct({ ...newProduct, show_in_b2b: e.target.checked })} className="accent-blue-600" data-testid="show-in-b2b-checkbox" /><span className="font-semibold text-blue-800">B2B portalında göster</span></label>
                <label className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 cursor-pointer"><input type="checkbox" checked={newProduct.track_stock} onChange={(e) => setNewProduct({ ...newProduct, track_stock: e.target.checked })} className="accent-emerald-600" data-testid="track-stock-checkbox" /><span className="font-semibold text-emerald-800">Stok takibi yap</span></label>
              </div>
              <label className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={withVariants} onChange={(e) => setWithVariants(e.target.checked)} className="accent-violet-600" data-testid="with-variants-checkbox" />
                <span className="font-semibold text-violet-800">Bu ürün varyantlı (Renk, Beden vb.) — kayıttan sonra varyant ekranı açılsın</span>
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="save-product-btn"
                >
                  Ürünü Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

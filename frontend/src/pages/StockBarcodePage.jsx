import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import { useSearchParams, useNavigate } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { StockCountPanel } from "../components/StockCountPanel";
import { StockToolbar, applyStockFilters, STOCK_FILTER_DEFAULTS } from "../components/StockToolbar";
import { ProductionOrderModal } from "../components/ProductionOrderModal";
import { ProductProfitPanel } from "../components/ProductProfitPanel";
import { LabelDesigner, LabelQuickPrint } from "../components/LabelDesigner";
import { BarcodeRenderer } from "../components/BarcodeRenderer";
import { ProductDetailModal } from "../components/ProductDetailModal";
import { cachedList, productFilter, patchCached } from "../utils/dataSync";
import { useInfiniteRows } from "../hooks/useInfiniteRows";
import { AiStockImportModal } from "../components/AiStockImportModal";
import { resolveImageUrl } from "../utils/imageUrl";
import { ScanButton } from "../components/CameraScanner";
import { SearchSelect } from "../components/SearchSelect";
import { barcodeSaleLine, barcodeSalePayload, findRetailContact, pickCashAccount, RETAIL_CONTACT_NAME, RETAIL_CONTACT_TAX } from "../utils/barcodeSale";
import { fmtMoney } from "../utils/documentLines";

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
  Store,
  Users,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

export default function StockBarcodePage() {
  const { activeCompany, addonOn } = useAuth();
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
  const [scanSaleMode, setScanSaleMode] = useState("retail"); // retail | account
  const [scanContacts, setScanContacts] = useState([]);
  const [scanContactId, setScanContactId] = useState("");
  const [scanQty, setScanQty] = useState(1);
  const [scanSelling, setScanSelling] = useState(false);
  const [detailProduct, setDetailProduct] = useState(null);
  const [produceProduct, setProduceProduct] = useState(null);
  const [reorder, setReorder] = useState(null);
  const [detailTab, setDetailTab] = useState("images");
  const [withVariants, setWithVariants] = useState(false);
  const [selected, setSelected] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const loadGenRef = useRef(0);

  const openDetail = (prod, tab = "images") => {
    setDetailTab(tab);
    setDetailProduct(prod);
  };

  const productId = (p) => p?.id || p?._id;
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";

  const toggleFlag = async (prod, field) => {
    const id = productId(prod);
    if (!id) {
      toast.error("Ürün kimliği bulunamadı.");
      return;
    }
    const next = !(prod[field] !== false);
    const prevVal = prod[field];
    setProducts((prev) => prev.map((p) => (productId(p) === id ? { ...p, [field]: next } : p)));
    // Opening under "B2B'de Gizli" (or closing under "Görünür") would hide the row — keep it visible.
    if (field === "show_in_b2b") {
      setStockF((f) => {
        if (next && f.b2b === "no") return { ...f, b2b: "all" };
        if (!next && f.b2b === "yes") return { ...f, b2b: "all" };
        return f;
      });
    }
    try {
      const res = await axios.put(`${API_URL}/products/${id}`, { [field]: next });
      const updated = res.data;
      if (!updated || !(updated.id || updated._id)) throw new Error("empty");
      const flagVal = updated[field] ?? next;
      setProducts((prev) => prev.map((p) => (productId(p) === id ? { ...p, ...updated, [field]: flagVal } : p)));
      await patchCached("products", companyId, { [id]: { ...updated, [field]: flagVal } });
      toast.success(
        field === "show_in_b2b"
          ? (flagVal !== false ? "Ürün B2B portalında gösteriliyor." : "Ürün B2B portalından gizlendi.")
          : (flagVal !== false ? "Stok takibi açıldı." : "Stok takibi kapatıldı.")
      );
    } catch {
      setProducts((prev) => prev.map((p) => (productId(p) === id ? { ...p, [field]: prevVal } : p)));
      toast.error("Güncellenemedi.");
    }
  };

  const toggleSelect = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const bulkSetFlags = async ({ show_in_b2b, track_stock } = {}) => {
    const hasB2b = typeof show_in_b2b === "boolean";
    const hasTrack = typeof track_stock === "boolean";
    if (!selected.length || (!hasB2b && !hasTrack)) return;
    const labels = [
      hasB2b && (show_in_b2b ? "B2B aç" : "B2B kapat"),
      hasTrack && (track_stock ? "Takip aç" : "Takip kapat"),
    ].filter(Boolean).join(" + ");
    if (!window.confirm(`${selected.length} üründe ${labels} uygulansın mı?`)) return;
    setBulkBusy(true);
    try {
      const body = { ids: selected, company_id: companyId };
      if (hasB2b) body.show_in_b2b = show_in_b2b;
      if (hasTrack) body.track_stock = track_stock;
      const r = await axios.post(`${API_URL}/products/bulk-flags`, body);
      const matched = Number(r.data?.matched ?? 0);
      const modified = Number(r.data?.modified ?? 0);
      if (matched < 1) {
        toast.error("Seçilen ürünler güncellenemedi (şirket/ürün eşleşmedi).");
        return;
      }
      const patch = {
        ...(hasB2b ? { show_in_b2b } : {}),
        ...(hasTrack ? { track_stock } : {}),
      };
      setProducts((prev) => prev.map((p) => (selected.includes(productId(p)) ? { ...p, ...patch } : p)));
      await patchCached(
        "products",
        companyId,
        Object.fromEntries(selected.map((id) => [id, patch])),
      );
      if (hasB2b) setStockF((f) => (f.b2b !== "all" ? { ...f, b2b: "all" } : f));
      toast.success(`${modified || matched} ürün güncellendi (${labels}).`);
      setSelected([]);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Toplu güncelleme başarısız.");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleProductUpdated = (updated) => {
    setDetailProduct(updated);
    const id = productId(updated);
    setProducts((prev) => prev.map((p) => (productId(p) === id ? { ...p, ...updated } : p)));
    if (id) patchCached("products", companyId, { [id]: updated });
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
    const gen = ++loadGenRef.current;
    try {
      setLoading(true);
      const cid = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
      loadCategories();
      axios.get(`${API_URL}/products/units?company_id=${cid}`).then((r) => { if (gen === loadGenRef.current) setUnits(r.data); }).catch(() => {});
      const rows = await cachedList("products", cid, {
        filter: productFilter({ category: filterCategory }),
        onCached: (cachedRows) => { if (gen === loadGenRef.current) setProducts(cachedRows); },
      });
      if (gen !== loadGenRef.current) return;
      setProducts(rows);
    } catch (err) {
      if (gen === loadGenRef.current) toast.error("Ürünler yüklenemedi.");
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
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

  const loadScanContacts = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/contacts?company_id=${companyId}`);
      const rows = (r.data || []).filter((c) => c.type !== "supplier");
      setScanContacts(rows);
      return rows;
    } catch {
      setScanContacts([]);
      return [];
    }
  }, [companyId]);

  useEffect(() => {
    if (showScannerModal) loadScanContacts();
  }, [showScannerModal, loadScanContacts]);

  const handleScanBarcode = async (barcode) => {
    if (!barcode) return;
    try {
      const res = await axios.get(`${API_URL}/products/barcode/${encodeURIComponent(barcode)}?company_id=${companyId}`);
      const data = {
        ...res.data,
        matched_variant: res.data.matched_variant || res.data.matched_variant || null,
      };
      setScanResultProduct(data);
      setScanQty(1);
      toast.success(`Ürün Bulundu: ${data.name}`);
    } catch (err) {
      toast.error("Barkod ile eşleşen ürün bulunamadı.");
      setScanResultProduct(null);
    }
  };

  const ensureRetailContact = async (contacts) => {
    const existing = findRetailContact(contacts);
    if (existing) return existing;
    const r = await axios.post(`${API_URL}/contacts`, {
      company_id: companyId,
      type: "customer",
      name: RETAIL_CONTACT_NAME,
      tax_number_or_id: RETAIL_CONTACT_TAX,
      tax_office: "Perakende",
      category: "Perakende",
      kvkk_accepted: true,
      city: "İstanbul",
    });
    const created = r.data;
    setScanContacts((prev) => [created, ...prev]);
    return created;
  };

  const handleBarcodeSale = async () => {
    if (!scanResultProduct) return;
    if (scanSaleMode === "account" && !scanContactId) {
      toast.error("Cari satış için müşteri seçin.");
      return;
    }
    const qty = Number(scanQty) || 0;
    if (qty <= 0) {
      toast.error("Miktar 0'dan büyük olmalı.");
      return;
    }
    setScanSelling(true);
    try {
      let contact;
      if (scanSaleMode === "retail") {
        const rows = scanContacts.length ? scanContacts : await loadScanContacts();
        contact = await ensureRetailContact(rows);
      } else {
        contact = scanContacts.find((c) => c.id === scanContactId || c._id === scanContactId);
        if (!contact) throw new Error("Cari bulunamadı.");
      }
      const payload = barcodeSalePayload({
        companyId,
        contact,
        product: scanResultProduct,
        quantity: qty,
        mode: scanSaleMode,
      });
      const invRes = await axios.post(`${API_URL}/invoices`, payload);
      const inv = invRes.data;
      if (scanSaleMode === "retail") {
        try {
          const accRes = await axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`);
          const cash = pickCashAccount(accRes.data || []);
          if (cash && Number(inv.grand_total || payload.paid_amount || 0) > 0) {
            await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/record-payment`, {
              amount: Number(inv.grand_total || payload.paid_amount),
              account_id: cash.id || cash._id,
            });
          }
        } catch {
          /* fatura oluştu; kasa tahsilatı opsiyonel */
        }
      }
      const line = barcodeSaleLine(scanResultProduct, qty);
      toast.success(
        scanSaleMode === "retail"
          ? `Perakende satış: ${inv.invoice_number || ""} · ${fmtMoney(line.total_incl)} ₺`
          : `Cari satış: ${inv.invoice_number || ""} · ${contact.name} · ${fmtMoney(line.total_incl)} ₺`
      );
      setScanResultProduct(null);
      setScannedBarcode("");
      setScanQty(1);
      loadProducts();
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : err.message || "Satış kaydedilemedi.");
    } finally {
      setScanSelling(false);
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
  const allFilteredIds = useMemo(() => filtered.map(productId).filter(Boolean), [filtered]);
  const allFilteredSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.includes(id));
  const toggleSelectAllFiltered = () => setSelected(allFilteredSelected ? [] : allFilteredIds);
  const stockListResetKey = useMemo(() => `${filterCategory}|${searchTerm}|${JSON.stringify(stockF)}`, [filterCategory, searchTerm, stockF]);
  const { visible: pagedProducts, hasMore: productsHasMore, sentinelRef: productsSentinelRef } = useInfiniteRows(filtered, { resetKey: stockListResetKey });
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
          {addonOn("ai.stock") && (
          <button
            onClick={() => setAiStockImport(true)}
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-purple-600/20 transition"
            data-testid="ai-stock-import-btn"
          >
            <Sparkles className="w-4 h-4" />
            <span>AI ile Yükle (Excel/PDF)</span>
          </button>
          )}
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

      {selected.length > 0 && (
        <div className="sticky top-16 z-20 bg-slate-900 text-white rounded-2xl px-4 py-2.5 flex flex-wrap items-center gap-2 text-xs shadow-xl" data-testid="stock-bulk-bar">
          <span className="font-bold">{selected.length} ürün seçildi</span>
          <button type="button" disabled={bulkBusy} onClick={() => bulkSetFlags({ show_in_b2b: true })} className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 rounded-lg font-semibold disabled:opacity-50" data-testid="bulk-open-b2b-btn">B2B aç</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulkSetFlags({ show_in_b2b: false })} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold disabled:opacity-50" data-testid="bulk-close-b2b-btn">B2B kapat</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulkSetFlags({ track_stock: true })} className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 rounded-lg font-semibold disabled:opacity-50" data-testid="bulk-open-track-btn">Takip aç</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulkSetFlags({ track_stock: false })} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold disabled:opacity-50" data-testid="bulk-close-track-btn">Takip kapat</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulkSetFlags({ show_in_b2b: true, track_stock: true })} className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-900 rounded-lg font-semibold disabled:opacity-50" data-testid="bulk-open-both-btn">B2B + Takip aç</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulkSetFlags({ show_in_b2b: false, track_stock: false })} className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg font-semibold disabled:opacity-50" data-testid="bulk-close-both-btn">B2B + Takip kapat</button>
          <button type="button" onClick={() => setSelected([])} className="ml-auto px-2 py-1 border border-slate-600 rounded-lg" data-testid="stock-bulk-clear-btn">Seçimi kaldır</button>
        </div>
      )}
      {/* Products Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-3 py-3 w-12">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] font-bold normal-case tracking-normal text-slate-400">Seç</span>
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAllFiltered}
                      className="rounded border-slate-300"
                      title="Filtrelenen tüm ürünleri seç"
                      aria-label="Filtrelenen tüm ürünleri seç"
                      data-testid="stock-select-all"
                    />
                  </div>
                </th>
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
              {pagedProducts.map((prod) => {
                const isCritical = prod.stock_quantity <= prod.min_stock_alert;
                return (
                  <tr key={prod.id || prod._id} className={`hover:bg-slate-50/70 transition ${selected.includes(productId(prod)) ? "bg-indigo-50/40" : ""}`} data-testid={`prod-row-${prod.sku}`}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.includes(productId(prod))}
                        onChange={() => toggleSelect(productId(prod))}
                        className="rounded border-slate-300"
                        data-testid={`stock-select-${prod.sku}`}
                      />
                    </td>
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
                        <button type="button" onClick={() => toggleFlag(prod, "show_in_b2b")} className={`px-2 py-0.5 rounded-md text-[10px] font-bold border whitespace-nowrap ${prod.show_in_b2b !== false ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-100 text-slate-400 border-slate-200"}`} title="B2B portalında göster/gizle" data-testid={`b2b-toggle-${prod.sku}`}>B2B {prod.show_in_b2b !== false ? "Açık" : "Kapalı"}</button>
                        <button type="button" onClick={() => toggleFlag(prod, "track_stock")} className={`px-2 py-0.5 rounded-md text-[10px] font-bold border whitespace-nowrap ${prod.track_stock !== false ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-400 border-slate-200"}`} title="Stok takibi aç/kapat" data-testid={`track-toggle-${prod.sku}`}>Takip {prod.track_stock !== false ? "Açık" : "Kapalı"}</button>
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
        {productsHasMore && (
          <div ref={productsSentinelRef} className="px-4 py-3 text-center text-[11px] text-slate-400 border-t border-slate-100" data-testid="stock-load-more">
            Daha fazla stok kartı yükleniyor…
          </div>
        )}
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
              <button onClick={() => setShowScannerModal(false)} className="text-slate-400" data-testid="scanner-close-btn">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2" data-testid="scanner-sale-mode">
                <button
                  type="button"
                  onClick={() => setScanSaleMode("retail")}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-semibold border transition ${scanSaleMode === "retail" ? "bg-emerald-600 text-white border-emerald-600 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
                  data-testid="scanner-mode-retail"
                >
                  <Store className="w-3.5 h-3.5" /> Perakende Satış
                </button>
                <button
                  type="button"
                  onClick={() => setScanSaleMode("account")}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-semibold border transition ${scanSaleMode === "account" ? "bg-indigo-600 text-white border-indigo-600 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
                  data-testid="scanner-mode-account"
                >
                  <Users className="w-3.5 h-3.5" /> Cari Satış
                </button>
              </div>

              {scanSaleMode === "account" && (
                <div className="space-y-1" data-testid="scanner-contact-picker">
                  <label className="font-semibold text-slate-600">Müşteri (cari)</label>
                  <SearchSelect
                    value={scanContactId}
                    onChange={(id) => setScanContactId(id)}
                    options={scanContacts}
                    placeholder="Cari seçin..."
                    getLabel={(c) => c.name}
                    getSub={(c) => c.tax_number_or_id || c.phone || ""}
                    testId="scanner-contact-select"
                  />
                </div>
              )}

              <p className="text-slate-500">
                {scanSaleMode === "retail"
                  ? "Barkodu okutun; peşin perakende satış faturası oluşturulur (stok düşer)."
                  : "Barkodu okutun; seçilen cariye satış faturası işlenir (stok + bakiye)."}
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Barkod numarası girin veya okutun..."
                  value={scannedBarcode}
                  onChange={(e) => setScannedBarcode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScanBarcode(scannedBarcode)}
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

              {scanResultProduct && (
                <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-4 space-y-3" data-testid="scanned-product-result">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-900 text-sm truncate">{scanResultProduct.name}</h4>
                      <p className="text-indigo-700 font-mono text-xs">SKU: {scanResultProduct.sku} • {scanResultProduct.category}</p>
                    </div>
                    <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border shrink-0">
                      {scanResultProduct.sale_price?.toLocaleString("tr-TR")} ₺
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

                  <div className="flex items-center gap-2">
                    <label className="font-semibold text-slate-600">Miktar</label>
                    <input
                      type="number"
                      min="0.001"
                      step="1"
                      value={scanQty}
                      onChange={(e) => setScanQty(e.target.value)}
                      className="w-24 bg-white border border-slate-200 rounded-lg px-2 py-1.5 font-bold text-slate-900"
                      data-testid="scanner-qty-input"
                    />
                    <span className="text-slate-500">{scanResultProduct.unit || "Adet"}</span>
                    <span className="ml-auto text-slate-600">Stok: <strong className="text-emerald-700">{scanResultProduct.stock_quantity}</strong></span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-indigo-200/60">
                    <button
                      type="button"
                      disabled={scanSelling}
                      onClick={handleBarcodeSale}
                      className={`flex-1 min-w-[9rem] px-3 py-2 rounded-lg font-bold text-white disabled:opacity-60 ${scanSaleMode === "retail" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700"}`}
                      data-testid="scanner-sale-btn"
                    >
                      {scanSelling ? "Kaydediliyor…" : (scanSaleMode === "retail" ? "Perakende Satış Yap" : "Cariye Satış Yap")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStockAdjustment(scanResultProduct.id || scanResultProduct._id, 1, scanResultProduct.matched_variant?.variant_id)}
                      className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg font-semibold hover:bg-slate-50"
                      data-testid="scan-adjust-plus-btn"
                      title="Stok girişi (+1)"
                    >
                      +1 Stok
                    </button>
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

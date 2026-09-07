import React, { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import {
  Boxes,
  ShoppingCart,
  FileText,
  Truck,
  CheckCircle2,
  Clock,
  Send,
  Plus,
  Search,
  Filter,
  Layers,
  Sparkles,
  ShoppingBag,
  X,
  MessageSquare
} from "lucide-react";
import { QuickMessageModal, TEMPLATES } from "../components/QuickMessageModal";
import { PrintDocument, PrintTemplateEditor } from "../components/PrintDocument";
import { useSearchParams } from "react-router-dom";
import { resolveImageUrl } from "../utils/imageUrl";
import { Printer, Tag, CheckCircle, RotateCcw, FileText as FileIcon, Trash2, UserPlus, Package as PackageIcon, MoreVertical, Ban, ScanLine } from "lucide-react";
import { printThermalLabels } from "../utils/thermalLabels";
import { ClaimsPanel, CancelledPanel, QuestionsPanel } from "../components/MarketplacePanels";
import { ProfitabilityPanel } from "../components/ProfitabilityPanel";
import { CargoLabel } from "../components/CargoLabel";
import { ApproveOrderModal } from "../components/ApproveOrderModal";
import { channelTr, statusTr } from "../utils/labels";
import { MarketplaceProductsPanel } from "../components/MarketplaceProductsPanel";
import { NewOrderModal, AiOrderImportModal } from "../components/OrderCreateModals";
import { AutoShipModal } from "../components/AutoShipModal";
import { PricingCenter } from "../components/PricingCenter";
import { OrdersToolbar, applyOrderFilters, ORDER_FILTER_DEFAULTS } from "../components/OrdersToolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

export default function OrdersB2BPage() {
  const { activeCompany } = useAuth();
  const navigate = useNavigate();
  const goContact = (ord) => navigate(ord.contact_id ? `/contacts?contact_id=${ord.contact_id}` : `/contacts?search=${encodeURIComponent(ord.customer_name || "")}`);
  const [activeTab, setActiveTab] = useState("orders"); // orders | b2b_portal
  const [orders, setOrders] = useState([]);
  const [notifyOrder, setNotifyOrder] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);
  const [labelOrder, setLabelOrder] = useState(null);
  const [dispatchDoc, setDispatchDoc] = useState(null);
  const [returnOrder, setReturnOrder] = useState(null);
  const [approveOrder, setApproveOrder] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkLabels, setBulkLabels] = useState(null);
  const toggleSel = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const bulk = async (action) => {
    const list = orders.filter((o) => selected.includes(o.id));
    if (!list.length) { toast.error("Sipariş seçin."); return; }
    if (action === "labels") { setBulkLabels(list); return; }
    if (action === "thermal") { if (printThermalLabels(list, activeCompany)) { axios.post(`${API_URL}/orders/mark-labels-printed`, { ids: list.map((o) => o.id) }).catch(() => {}); toast.success(`${list.length} termal etiket yazdırmaya gönderildi.`); } return; }
    if (action === "delete") {
      const deletable = list.filter((o) => !o.is_invoiced && !o.invoice_id);
      if (!deletable.length) { toast.error("Faturalanmış siparişler silinemez."); return; }
      if (!window.confirm(`${deletable.length} sipariş silinsin mi? (Çöp Kutusu'ndan 30 gün içinde geri getirebilirsiniz.)`)) return;
      try { const r = await axios.post(`${API_URL}/orders/bulk-delete`, { ids: deletable.map((o) => o.id) }); toast.success(r.data.message); setSelected([]); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
      return;
    }
    let ok = 0, fail = 0;
    for (const o of list) {
      try {
        if (action === "invoice") { if (o.is_invoiced || o.invoice_id) continue; await axios.post(`${API_URL}/orders/${o.id}/convert-to-invoice`); }
        else if (action === "approve") { if (o.order_status !== "pending") continue; await axios.post(`${API_URL}/orders/${o.id}/approve`, { cargo_carrier: o.cargo_carrier || "yurtici" }); }
        ok++;
      } catch { fail++; }
    }
    if (!ok && !fail) toast.info(action === "invoice" ? "Seçili siparişlerin tümü zaten faturalanmış." : "Seçili siparişlerde onaylanacak (beklemede) sipariş yok.");
    else toast[fail ? "error" : "success"](`${ok} sipariş işlendi${fail ? `, ${fail} hata` : ""}.${action === "approve" ? " Onay pazaryeri entegrasyonuna iletildi (SİMÜLE)." : ""}`);
    setSelected([]); loadData();
  };
  const [returnReason, setReturnReason] = useState("");
  const [autoBusy, setAutoBusy] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  const [aiImport, setAiImport] = useState(false);
  const [autoShip, setAutoShip] = useState(false);
  const autoContacts = async () => {
    setAutoBusy(true);
    try { const r = await axios.post(`${API_URL}/orders/auto-contacts`, { company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01" }); toast.success(r.data.message); loadData(); }
    catch (err) { toast.error(err.response?.data?.detail || "Cariler eşlenemedi."); } finally { setAutoBusy(false); }
  };
  const approve = async (ord) => {
    try {
      await axios.post(`${API_URL}/orders/${ord.id}/approve`, {});
      toast.success(`${ord.order_number} onaylandı.`);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Onaylanamadı.");
    }
  };
  const doReturn = async () => { try { const r = await axios.post(`${API_URL}/orders/${returnOrder.id}/return`, { reason: returnReason, restock: true }); toast.success(r.data.message); setReturnOrder(null); setReturnReason(""); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "İade kaydedilemedi."); } };
  const makeDispatch = async (ord) => { try { const r = await axios.post(`${API_URL}/orders/${ord.id}/create-dispatch`); toast.success(r.data.message); setDispatchDoc(r.data.dispatch); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "İrsaliye oluşturulamadı."); } };
  const resolveCancel = async (ord, action) => {
    const ok = window.confirm(action === "accept" ? `${ord.order_number} iptal edilsin mi?` : `${ord.order_number} iptal talebi reddedilsin mi?`);
    if (!ok) return;
    try {
      const r = await axios.post(`${API_URL}/orders/${ord.id}/resolve-cancel-request`, { action });
      toast.success(r.data.message);
      loadData();
    } catch (err) { toast.error(err.response?.data?.detail || "İşlem yapılamadı."); }
  };
  const [editTpl, setEditTpl] = useState(false);
  const [searchParams] = useSearchParams();
  useEffect(() => { if (searchParams.get("new") === "1") setNewOrder(true); }, [searchParams]);
  const customerFilter = searchParams.get("customer") || "";
  const [ordF, setOrdF] = useState(ORDER_FILTER_DEFAULTS);
  const [sort, setSort] = useState({ key: "order_date", dir: "desc" });
  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  const visibleOrders = useMemo(() => {
    const list = applyOrderFilters(orders.filter((o) => !customerFilter || o.customer_name === customerFilter), ordF);
    const val = (o) => ({ order_number: o.order_number || "", channel: o.channel || "", customer_name: (o.customer_name || "").toLowerCase(), total_amount: Number(o.total_amount) || 0, order_status: o.order_status || "", order_date: o.order_date || o.created_at || "", items: (o.items || []).length })[sort.key];
    return [...list].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === "asc" ? 1 : -1); });
  }, [orders, customerFilter, ordF, sort]);
  const SortTh = ({ k, children, className = "" }) => <th className={`px-4 py-3 cursor-pointer select-none hover:text-slate-800 ${className}`} onClick={() => toggleSort(k)} data-testid={`ord-sort-${k}`}>{children} <span className={`text-[9px] ${sort.key === k ? "text-indigo-600" : "text-slate-300"}`}>{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}</span></th>;
  const visibleTotal = useMemo(() => visibleOrders.reduce((t, o) => t + (Number(o.total_amount) || 0), 0), [visibleOrders]);
  const [products, setProducts] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  // B2B Cart State
  const [cart, setCart] = useState({});
  const [b2bCustomer, setB2bCustomer] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [ordRes, prodRes, cntRes] = await Promise.all([
        axios.get(`${API_URL}/orders?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`),
        axios.get(`${API_URL}/products?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}&b2b_only=true`),
        axios.get(`${API_URL}/contacts?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}&type=customer`)
      ]);
      setOrders(ordRes.data);
      setProducts(prodRes.data);
      setContacts(cntRes.data);
      axios.get(`${API_URL}/products?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`).then((r) => setAllProducts(r.data)).catch(() => {});
      if (cntRes.data.length > 0) setB2bCustomer(cntRes.data[0].id || cntRes.data[0]._id);
    } catch (err) {
      toast.error("Sipariş verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);
  useEffect(() => { loadData(); }, [loadData]);

  const [expandedItems, setExpandedItems] = useState(null);
  const handleConvertToInvoice = async (orderId, eType) => {
    try {
      const res = await axios.post(`${API_URL}/orders/${orderId}/convert-to-invoice`, eType ? { e_type: eType } : {});
      toast.success(res.data.message);
      loadData();
    } catch (err) {
      toast.error("Faturaya dönüştürme başarısız.");
    }
  };

  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    try {
      await axios.put(`${API_URL}/orders/${orderId}/status`, { status: newStatus });
      toast.success("Sipariş durumu güncellendi.");
      loadData();
    } catch (err) {
      toast.error("Durum güncellenemedi.");
    }
  };

  const handleCreateCargoForOrder = async (order) => {
    try {
      const res = await axios.post(`${API_URL}/cargo/create-shipment`, {
        carrier_code: "yurtici",
        order_id: order.id || order._id,
        customer_name: order.customer_name,
        address: order.shipping_address,
        city: order.city,
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"
      });
      toast.success(`Kargo fişi oluşturuldu! Takip No: ${res.data.tracking_number}`);
      loadData();
    } catch (err) {
      toast.error("Kargo kaydı oluşturulamadı.");
    }
  };

  // B2B Cart logic
  const handleAddToCart = (product, qty = 1) => {
    const current = cart[product.id || product._id] || 0;
    setCart({ ...cart, [product.id || product._id]: current + qty });
    toast.success(`${product.name} sepete eklendi.`);
  };

  const handlePlaceB2BOrder = async () => {
    const items = [];
    let total = 0;
    const selectedContact = contacts.find(c => (c.id === b2bCustomer || c._id === b2bCustomer));

    Object.keys(cart).forEach(prodId => {
      const p = products.find(prod => (prod.id === prodId || prod._id === prodId));
      const qty = cart[prodId];
      if (p && qty > 0) {
        // Apply B2B wholesale discount 15%
        const b2bPrice = p.sale_price * 0.85;
        const itmTotal = b2bPrice * qty;
        total += itmTotal;
        items.push({
          product_id: p.id || p._id,
          product_name: p.name,
          sku: p.sku,
          quantity: qty,
          unit_price: b2bPrice,
          total: itmTotal
        });
      }
    });

    if (items.length === 0) {
      toast.error("Sepetiniz boş.");
      return;
    }

    try {
      await axios.post(`${API_URL}/orders`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        channel: "b2b",
        customer_name: selectedContact?.name || "B2B Bayi",
        customer_email: selectedContact?.email || "bayi@nexus.com",
        customer_phone: selectedContact?.phone || "0555 111 22 33",
        shipping_address: selectedContact?.address || "Bayi Deposu",
        city: selectedContact?.city || "İstanbul",
        items: items,
        total_amount: total,
        currency: "TRY",
        order_status: "approved"
      });
      toast.success("B2B Toptan Sipariş başarıyla oluşturuldu!");
      setCart({});
      setActiveTab("orders");
      loadData();
    } catch (err) {
      toast.error("Sipariş oluşturulamadı.");
    }
  };

  const cartItemsCount = Object.values(cart).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6" data-testid="orders-b2b-page">
      {dispatchDoc && <PrintDocument docType="dispatch" doc={dispatchDoc} company={activeCompany} onClose={() => setDispatchDoc(null)} />}
      {approveOrder && <ApproveOrderModal order={approveOrder} companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setApproveOrder(null)} onDone={loadData} />}
      {returnOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"><div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 text-xs" data-testid="return-modal">
          <h3 className="text-sm font-bold">İade — {returnOrder.order_number}</h3><p className="text-slate-500">Tüm kalemler iade alınır, stok geri eklenir ve iade kaydı oluşturulur.</p>
          <textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} rows={3} placeholder="İade nedeni" className="w-full bg-slate-50 border rounded-lg p-2" data-testid="return-reason-input" />
          <div className="flex justify-end gap-2"><button onClick={() => setReturnOrder(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={doReturn} className="px-4 py-1.5 bg-rose-600 text-white rounded-lg font-semibold" data-testid="return-confirm-btn">İadeyi Kaydet</button></div>
        </div></div>
      )}
      {labelOrder && <CargoLabel order={labelOrder} company={activeCompany} onClose={() => setLabelOrder(null)} />}
      {printOrder && <PrintDocument docType="order" doc={printOrder} company={activeCompany} onClose={() => setPrintOrder(null)} onEditTemplate={() => setEditTpl(true)} />}
      {editTpl && <PrintTemplateEditor companyId={activeCompany?.id || "comp_nexus_main_01"} docType="order" onClose={() => setEditTpl(false)} />}
      {notifyOrder && (
        <QuickMessageModal
          companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}
          recipient={{ name: notifyOrder.customer_name, phone: notifyOrder.customer_phone, email: notifyOrder.customer_email }}
          defaultSubject={`Siparişiniz Yola Çıktı - ${notifyOrder.order_number}`}
          defaultMessage={TEMPLATES.order(notifyOrder)}
          context="order"
          refId={notifyOrder.id}
          onClose={() => setNotifyOrder(null)}
        />
      )}
      {selected.length > 0 && (
        <div className="sticky top-16 z-20 bg-slate-900 text-white rounded-2xl px-4 py-2.5 flex flex-wrap items-center gap-2 text-xs shadow-xl" data-testid="orders-bulk-bar">
          <span className="font-bold">{selected.length} sipariş seçildi</span>
          <button onClick={() => bulk("approve")} className="px-3 py-1.5 bg-emerald-600 rounded-lg font-semibold" data-testid="bulk-approve-btn">Toplu Onayla (entegrasyona yansır)</button>
          <button onClick={() => bulk("invoice")} className="px-3 py-1.5 bg-blue-600 rounded-lg font-semibold" data-testid="bulk-invoice-btn">Toplu Fatura Kes</button>
          <button onClick={() => bulk("thermal")} className="px-3 py-1.5 bg-amber-500 rounded-lg font-semibold flex items-center gap-1" data-testid="bulk-thermal-btn"><Printer className="w-3.5 h-3.5" /> Termal Etiket (100×150)</button>
          <button onClick={() => bulk("labels")} className="px-3 py-1.5 border border-amber-400 text-amber-200 rounded-lg font-semibold" data-testid="bulk-labels-btn">A4 Etiket</button>
          <button onClick={() => bulk("delete")} className="px-3 py-1.5 bg-rose-600 rounded-lg font-semibold flex items-center gap-1" data-testid="bulk-delete-btn"><Trash2 className="w-3.5 h-3.5" /> Sil</button>
          <button onClick={() => setSelected([])} className="ml-auto px-2 py-1 border border-slate-600 rounded-lg" data-testid="bulk-clear-btn">Seçimi Kaldır</button>
        </div>
      )}
      {bulkLabels && (
        <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-start justify-center p-4 overflow-y-auto print:static print:bg-white print:p-0" onClick={() => setBulkLabels(null)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl p-4 space-y-3 print:shadow-none" onClick={(e) => e.stopPropagation()} data-testid="bulk-labels-modal">
            <div className="flex justify-between items-center no-print"><b className="text-sm">{bulkLabels.length} kargo etiketi</b><div className="flex gap-2"><button onClick={() => window.print()} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="bulk-labels-print">Yazdır</button><button onClick={() => setBulkLabels(null)} className="px-3 py-1.5 border rounded-lg text-xs">Kapat</button></div></div>
            <div id="print-area" className="grid grid-cols-2 gap-3">{bulkLabels.map((o) => <div key={o.id} className="border-2 border-dashed rounded-xl p-3 text-xs space-y-1 break-inside-avoid"><div className="flex justify-between"><b className="text-sm">{activeCompany?.name}</b><span className="font-mono">{o.order_number}</span></div><div className="text-[10px] text-slate-500">GÖNDERİCİ: {activeCompany?.address} {activeCompany?.city} • {activeCompany?.phone}</div><div className="border-t pt-1"><div className="text-[10px] text-slate-500">ALICI</div><div className="font-bold text-sm">{o.customer_name}</div><div>{o.shipping_address}</div><div className="font-bold">{o.city}</div><div>{o.customer_phone}</div></div><div className="flex justify-between border-t pt-1"><span>{(o.items || []).reduce((s, i) => s + i.quantity, 0)} parça • {o.cargo_carrier || "Kargo seçilmedi"}</span><span className="font-mono font-bold">{o.cargo_tracking_number || "—"}</span></div></div>)}</div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Sipariş Modülü</h1>
          <p className="text-xs sm:text-sm text-slate-500">Pazaryeri & B2B siparişleri, iade/iptal/soru yönetimi, termal kargo etiketi ve tek tıkla faturalama</p>
          {orders.some((o) => !o.contact_id) && (
            <button onClick={autoContacts} disabled={autoBusy} className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold disabled:opacity-50" data-testid="orders-auto-contacts-btn">
              <UserPlus className="w-3.5 h-3.5" /> Carileri Eşle ({orders.filter((o) => !o.contact_id).length} carisiz sipariş)
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button onClick={() => navigate("/sevk")} className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-semibold flex items-center gap-1.5" data-testid="open-pick-kiosk-btn"><ScanLine className="w-4 h-4" /> Depo Sevkiyatı</button>
          <button onClick={() => setNewOrder(true)} className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5" data-testid="new-order-btn"><Plus className="w-4 h-4" /> Yeni Sipariş</button>
          <button onClick={() => setAutoShip(true)} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5" data-testid="auto-ship-btn"><Truck className="w-4 h-4" /> Toplu Kargola</button>
          <button onClick={() => setAiImport(true)} className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5" data-testid="ai-order-btn"><Sparkles className="w-4 h-4" /> AI ile Yükle (PDF/Excel)</button>
        {/* Tab Switcher */}
        <div className="flex flex-wrap items-center gap-1 bg-slate-200/80 p-1 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setActiveTab("orders")}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === "orders" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
            data-testid="tab-orders"
          >
            Gelen Siparişler ({orders.length})
          </button>
          {[["claims", "İadeler", RotateCcw], ["cancelled", `İptaller (${orders.filter((o) => ["cancelled", "returned"].includes(o.order_status)).length})`, Trash2], ["questions", "Müşteri Soruları", FileIcon], ["mp_products", "Ürünler & Fiyat", PackageIcon], ["pricing", "Fiyat Merkezi", Tag], ["profit", "Komisyon & Kârlılık", Tag]].map(([k, l, Icon]) => (
            <button key={k} onClick={() => setActiveTab(k)} className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${activeTab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`} data-testid={`tab-${k}`}><Icon className="w-3.5 h-3.5" /><span>{l}</span></button>
          ))}
        </div>
        </div>
      </div>
      {activeTab === "claims" && <ClaimsPanel companyId={activeCompany?.id || "comp_nexus_main_01"} />}
      {activeTab === "cancelled" && <CancelledPanel orders={orders} />}
      {activeTab === "profit" && <ProfitabilityPanel companyId={activeCompany?.id || "comp_nexus_main_01"} />}
      {activeTab === "questions" && <QuestionsPanel companyId={activeCompany?.id || "comp_nexus_main_01"} />}
      {activeTab === "pricing" && <PricingCenter companyId={activeCompany?.id || "comp_nexus_main_01"} />}
      {activeTab === "mp_products" && <MarketplaceProductsPanel companyId={activeCompany?.id || "comp_nexus_main_01"} />}
      {newOrder && <NewOrderModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} contacts={contacts} products={allProducts} onClose={() => setNewOrder(false)} onSaved={loadData} />}
      {autoShip && <AutoShipModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setAutoShip(false)} onDone={loadData} />}
      {aiImport && <AiOrderImportModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setAiImport(false)} onSaved={loadData} />}

      {activeTab === "orders" ? (<>
        <OrdersToolbar f={ordF} setF={setOrdF} orders={orders} count={visibleOrders.length} total={visibleTotal} rows={visibleOrders} />
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="overflow-x-auto overflow-y-hidden pr-3 [scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent]">
            <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                <tr>
                  <th className="px-3 py-3 w-8"><input type="checkbox" checked={selected.length > 0 && selected.length === orders.length} onChange={(e) => setSelected(e.target.checked ? orders.map((o) => o.id) : [])} className="rounded" data-testid="orders-select-all" /></th>
                  <SortTh k="order_number">Sipariş No & Kanal</SortTh>
                  <SortTh k="customer_name">Müşteri / Alıcı</SortTh>
                  <SortTh k="items">Ürünler</SortTh>
                  <SortTh k="total_amount" className="text-right">Tutar</SortTh>
                  <SortTh k="order_status">Sipariş Durumu</SortTh>
                  <th className="px-4 py-3 pr-8 text-center w-[400px] min-w-[400px]">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleOrders.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400" data-testid="ord-empty">Filtreye uyan sipariş yok.</td></tr>}
                {visibleOrders.map((ord) => (
                  <tr key={ord.id || ord._id || ord.order_number} className={`hover:bg-slate-50/70 transition ${selected.includes(ord.id) ? "bg-emerald-50/60" : ""}`} data-testid={`order-row-${ord.order_number}`}>
                    <td className="px-3 py-3"><input type="checkbox" checked={selected.includes(ord.id)} onChange={() => toggleSel(ord.id)} className="rounded" data-testid={`order-select-${ord.order_number}`} /></td>
                    <td className="px-4 py-3 font-medium">
                      <div className="font-bold text-slate-900 font-mono">{ord.order_number}</div>
                      {ord.customer_order_number ? <div className="text-[10px] text-slate-500 font-mono" data-testid={`order-customer-no-${ord.order_number}`}>Müşteri no: {ord.customer_order_number}</div> : null}
                      <span className="text-[10px] uppercase font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded">
                        {channelTr(ord.channel)}
                      </span>
                    </td>
                    <td className="px-4 py-3 cursor-pointer group" onClick={() => goContact(ord)} title="Cariye git" data-testid={`order-customer-${ord.order_number}`}>
                      <div className="font-semibold text-slate-900 group-hover:text-indigo-700 group-hover:underline decoration-dotted">{ord.customer_name}</div>
                      <div className="text-[11px] text-slate-400">{ord.city}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {(() => { const items = ord.items || []; const open = expandedItems === ord.id; const shown = open ? items : items.slice(0, 2); const img = (it) => { const p = products.find((x) => (it.product_id && (x.id === it.product_id || x._id === it.product_id)) || (it.sku && x.sku === it.sku)); return resolveImageUrl(it.image_url || p?.image_url); }; return (
                        <div data-testid={`order-items-${ord.order_number}`}>
                          <div className={open ? "grid grid-cols-1 2xl:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1 mb-1.5" : "space-y-1"}>
                          {shown.map((it, idx) => (
                            <div key={idx} className={`flex items-center gap-2 ${open ? "bg-slate-50 rounded-lg p-1.5" : ""}`}>
                              {img(it) ? <img src={img(it)} alt="" className={`${open ? "w-10 h-10" : "w-8 h-8"} rounded-md object-cover border bg-white shrink-0`} /> : <div className={`${open ? "w-10 h-10" : "w-8 h-8"} rounded-md border bg-white flex items-center justify-center text-slate-300 shrink-0`}><PackageIcon className="w-4 h-4" /></div>}
                              <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/stock?q=${encodeURIComponent(it.sku || it.product_name || it.name || "")}`); }} className="text-left min-w-0 text-slate-700 hover:text-indigo-700 hover:underline decoration-dotted" title="Stok kartını aç" data-testid={`order-item-link-${ord.order_number}-${idx}`}>
                                <div className={`${open ? "font-semibold" : ""} truncate max-w-[260px]`}>{it.quantity}x {it.product_name || it.name}</div>
                                {open && <div className="text-[10px] text-slate-400">{it.sku ? `SKU ${it.sku} · ` : ""}{it.unit_price != null ? `${Number(it.unit_price).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺` : ""}{it.variant ? ` · ${it.variant}` : ""}</div>}
                              </button>
                            </div>))}
                          </div>
                          {items.length > 2 && <button type="button" onClick={() => setExpandedItems(open ? null : ord.id)} className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100" data-testid={`order-items-toggle-${ord.order_number}`}>{open ? "Daralt" : `+${items.length - 2} ürün daha · büyüt`}</button>}
                        </div>); })()}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {ord.total_amount?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                    </td>
                    <td className="px-4 py-3">
                      {ord.channel && !["b2b", "manual"].includes(ord.channel) ? (
                        <div data-testid={`order-status-badge-${ord.order_number}`} title="Durum pazaryerinden otomatik güncellenir">
                          <span className={`inline-block px-2 py-1 rounded-lg text-[11px] font-semibold ${["shipped", "completed"].includes(ord.order_status) ? "bg-emerald-50 text-emerald-700" : ["cancelled", "returned", "partially_returned"].includes(ord.order_status) ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{statusTr(ord.order_status)}</span>
                          {ord.marketplace_status && <div className="text-[10px] text-slate-400 mt-0.5">{channelTr(ord.channel)}: {ord.marketplace_status}</div>}
                          {ord.channel === "shopphp" && <button onClick={async () => { try { const r = await axios.post(`${API_URL}/orders/${ord.id || ord._id}/push-shopphp`); toast.success(r.data.message); loadData(); } catch (e) { toast.error(e.response?.data?.detail || "Bildirilemedi."); } }} className={`mt-1 text-[10px] font-semibold underline ${ord.shopphp_push?.ok ? "text-emerald-700" : ord.shopphp_push?.ok === false ? "text-rose-600" : "text-indigo-600"}`} title={ord.shopphp_push ? `Son bildirim: ${new Date(ord.shopphp_push.at).toLocaleString("tr-TR")}${ord.shopphp_push.error ? " — " + ord.shopphp_push.error : ""}` : "Onay/kargo/fatura bilgisini ShopPHP mağazasına yaz"} data-testid={`shopphp-push-${ord.order_number}`}>{ord.shopphp_push?.ok ? "Mağazaya bildirildi ✓" : ord.shopphp_push?.ok === false ? "Bildirim hatası — tekrar dene" : "Mağazaya Bildir"}</button>}
                        </div>
                      ) : (
                      <select
                        value={ord.order_status}
                        onChange={(e) => handleUpdateOrderStatus(ord.id || ord._id, e.target.value)}
                        className="bg-slate-100 border border-slate-200 rounded p-1 text-[11px] font-semibold"
                        data-testid={`order-status-select-${ord.order_number}`}
                      >
                        <option value="pending">Beklemede</option>
                        <option value="approved">Onaylandı</option>
                        <option value="preparing">Hazırlanıyor</option>
                        <option value="shipped">Kargolandı</option>
                        <option value="completed">Tamamlandı</option>
                        <option value="cancelled">İptal</option>
                        <option value="returned">İade Edildi</option>
                        <option value="partially_returned">Kısmi İade</option>
                      </select>)}
                      {ord.cancel_request?.status === "pending" && (
                        <div className="mt-1 space-y-1">
                          <div className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 inline-block" data-testid={`cancel-request-badge-${ord.order_number}`}>İptal talebi{ord.cancel_request?.reason ? ` · ${ord.cancel_request.reason}` : ""}</div>
                          <div className="flex flex-wrap gap-1">
                            <button type="button" onClick={() => resolveCancel(ord, "accept")} className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white hover:bg-emerald-700" data-testid={`accept-cancel-btn-${ord.order_number}`}>Onayla</button>
                            <button type="button" onClick={() => resolveCancel(ord, "reject")} className="px-2 py-0.5 rounded-md text-[10px] font-bold border border-rose-200 text-rose-700 hover:bg-rose-50" data-testid={`reject-cancel-btn-${ord.order_number}`}>Reddet</button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 pr-8 text-center w-[400px] min-w-[400px]">
                      <div className="grid grid-cols-[28px_112px_128px_28px_32px] items-center justify-center gap-1.5" data-testid={`order-actions-${ord.order_number}`}>
                        {!ord.is_invoiced && !ord.invoice_id ? <button onClick={async () => { if (!window.confirm(`${ord.order_number} silinsin mi?`)) return; try { await axios.delete(`${API_URL}/orders/${ord.id}`); toast.success("Sipariş silindi."); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="Siparişi sil" data-testid={`order-delete-${ord.order_number}`}><Trash2 className="w-3.5 h-3.5" /></button> : <span className="inline-block w-7 h-7" aria-hidden="true" />}
                        {!ord.is_invoiced ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm"
                                title="Tek Tıkla E-Faturaya Dönüştür"
                                data-testid={`convert-inv-btn-${ord.order_number}`}
                              >
                                <FileText className="w-3.5 h-3.5" />
                                <span>Faturala ▾</span>
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={8} collisionPadding={24} className="z-[80] w-52 rounded-xl p-1.5 shadow-lg" data-testid={`inv-type-chooser-${ord.order_number}`}>
                              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase">Nasıl kesilsin?</div>
                              {[["e_invoice", "E-Fatura", "Mükellef alıcı"], ["e_archive", "E-Arşiv", "Nihai tüketici / pazaryeri"], ["paper", "Kağıt Fatura", "Matbu"]].map(([k, l, sub]) => (
                                <DropdownMenuItem key={k} onSelect={() => handleConvertToInvoice(ord.id || ord._id, k)} className="flex-col items-start gap-0 py-1.5" data-testid={`inv-type-${k}-${ord.order_number}`}>
                                  <span className="text-xs font-semibold text-slate-800">{l}</span>
                                  <span className="text-[10px] text-slate-400">{sub}</span>
                                </DropdownMenuItem>
                              ))}
                              {ord.order_status === "pending" && (
                                <DropdownMenuItem onSelect={() => setApproveOrder(ord)} className="border-t mt-1 rounded-lg font-semibold text-emerald-700" data-testid={`inv-chooser-approve-${ord.order_number}`}>
                                  Önce Onayla + Kargo
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-1 rounded text-center">
                            Faturalandı
                          </span>
                        )}

                        {!ord.cargo_tracking_number ? (
                          <button
                            onClick={() => setApproveOrder(ord)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center gap-1"
                            title="Kargo Fişi Oluştur"
                            data-testid={`create-cargo-btn-${ord.order_number}`}
                          >
                            <Truck className="w-3.5 h-3.5" />
                            <span>Kargola</span>
                          </button>
                        ) : (
                          <button onClick={() => { if (printThermalLabels([ord], activeCompany)) axios.post(`${API_URL}/orders/mark-labels-printed`, { ids: [ord.id] }).catch(() => {}); }} className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-slate-700 hover:text-indigo-700 hover:bg-indigo-50 border border-dashed border-slate-300 rounded-lg px-2 py-1" title="Termal kargo etiketi yazdır (100×150)" data-testid={`print-label-${ord.order_number}`}>
                            <Printer className="w-3 h-3" /> {ord.cargo_tracking_number}{ord.label_printed_at ? " ✓" : ""}
                          </button>
                        )}
                        {["pending", "new"].includes(ord.order_status) ? <button onClick={() => approve(ord)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition" title="Onayla" data-testid={`approve-order-btn-${ord.order_number}`}><CheckCircle className="w-4 h-4" /></button> : <span className="inline-block w-7 h-7" aria-hidden="true" />}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 data-[state=open]:bg-slate-100 data-[state=open]:text-slate-900 data-[state=open]:ring-1 data-[state=open]:ring-slate-200" title="Diğer işlemler" data-testid={`order-more-btn-${ord.order_number}`}><MoreVertical className="w-4 h-4" /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="center" side="left" sideOffset={10} collisionPadding={24} className="z-[80] w-56 rounded-xl p-1.5 shadow-lg" data-testid={`order-more-menu-${ord.order_number}`}>
                            {[
                              [ScanLine, "Depoda topla / sevk", () => navigate(`/sevk?order=${ord.id || ord._id}`), `pick-order-btn-${ord.order_number}`, !["shipped", "completed", "cancelled", "returned"].includes(ord.order_status)],
                              [FileIcon, ord.dispatch_number ? `İrsaliye: ${ord.dispatch_number}` : "E-İrsaliye Oluştur & Yazdır", () => makeDispatch(ord), `dispatch-btn-${ord.order_number}`, true],
                              [Ban, "İptal talebini onayla", () => resolveCancel(ord, "accept"), `accept-cancel-menu-${ord.order_number}`, ord.cancel_request?.status === "pending"],
                              [X, "İptal talebini reddet", () => resolveCancel(ord, "reject"), `reject-cancel-menu-${ord.order_number}`, ord.cancel_request?.status === "pending"],
                              [RotateCcw, "İade Al", () => setReturnOrder(ord), `return-order-btn-${ord.order_number}`, !["returned"].includes(ord.order_status)],
                              [Tag, "Kargo Etiketi Yazdır", () => setLabelOrder(ord), `cargo-label-btn-${ord.order_number}`, true],
                              [Printer, "Sipariş Formu Yazdır", () => setPrintOrder(ord), `print-order-btn-${ord.order_number}`, true],
                              [MessageSquare, "Müşteriye Bildirim Gönder", () => setNotifyOrder(ord), `notify-order-btn-${ord.order_number}`, true],
                            ].filter((it) => it[4]).map(([Ico, label, fn, tid]) => (
                              <DropdownMenuItem key={tid} onSelect={fn} className="gap-2 text-xs font-medium" data-testid={tid}><Ico className="w-4 h-4 shrink-0 text-slate-500" /><span className="truncate">{label}</span></DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>) : null}
    </div>
  );
}

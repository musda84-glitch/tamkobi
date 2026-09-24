import React, { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { usePersistedColumnWidths } from "../hooks/usePersistedColumnWidths";
import { resolveImageUrl } from "../utils/imageUrl";
import { Printer, Tag, CheckCircle, RotateCcw, FileText as FileIcon, Trash2, UserPlus, Package as PackageIcon, MoreVertical } from "lucide-react";
import { printThermalLabels } from "../utils/thermalLabels";
import { printMiniInvoices } from "../utils/miniInvoicePrint";
import { ClaimsPanel, CancelledPanel, QuestionsPanel } from "../components/MarketplacePanels";
import { ProfitabilityPanel } from "../components/ProfitabilityPanel";
import { CargoLabel } from "../components/CargoLabel";
import { ApproveOrderModal } from "../components/ApproveOrderModal";
import { CreateShipmentModal } from "../components/CreateShipmentModal";
import { channelTr, statusTr, orderStatusBadgeClass } from "../utils/labels";
import { MarketplaceProductsPanel } from "../components/MarketplaceProductsPanel";
import { NewOrderModal, AiOrderImportModal, OrderEditModal } from "../components/OrderCreateModals";
import { AutoShipModal } from "../components/AutoShipModal";
import { PricingCenter } from "../components/PricingCenter";
import { OrdersToolbar, applyOrderFilters, orderFiltersFromSearch } from "../components/OrdersToolbar";
import { exportExcel, exportPdf } from "../components/ExportButtons";
import { formatTrAmount } from "../utils/money";
import { orderEditBlockedReason } from "../utils/orderEdit";
import { cargoActionButtonClass, cargoActionTitle, printOrderButtonClass, printOrderTitle, orderIsShipped } from "../utils/orderActionBadges";
import { eBelgeMenuItems, orderCanIssueEFatura, orderEBelgeType } from "../utils/orderEBelge";
import { orderMoreMenuItems, orderMoreMenuKind } from "../utils/orderMoreMenu";
import { ORDER_COL_DEFAULTS, ORDER_COL_LIMITS, ORDER_SELECT_COL, ORDER_ACTIONS_COL, orderTableMinWidth } from "../utils/orderTableLayout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

const ORDER_EXPORT_LINE_COLS = [
  { label: "Sipariş No", value: (r) => r.order_number },
  { label: "Müşteri", value: (r) => r.customer_name },
  { label: "SKU", value: (r) => r.sku || "" },
  { label: "Ürün", value: (r) => r.product_name || r.name || "" },
  { label: "Miktar", num: true, value: (r) => r.quantity },
  { label: "Birim Fiyat", num: true, value: (r) => Number(r.unit_price || 0) },
  { label: "Tutar", num: true, value: (r) => Number(r.line_total ?? r.total ?? (Number(r.quantity || 0) * Number(r.unit_price || 0))) },
];

function orderExportRows(ord) {
  const items = Array.isArray(ord?.items) ? ord.items : [];
  if (!items.length) {
    return [{
      order_number: ord.order_number,
      customer_name: ord.customer_name,
      sku: "",
      product_name: "(kalem yok)",
      quantity: "",
      unit_price: "",
      line_total: ord.grand_total ?? ord.total_amount ?? 0,
    }];
  }
  return items.map((it) => ({
    ...it,
    order_number: ord.order_number,
    customer_name: ord.customer_name,
    product_name: it.product_name || it.name,
    line_total: it.line_total ?? it.total ?? (Number(it.quantity || 0) * Number(it.unit_price || 0)),
  }));
}

/** Masaüstü / mobil ortak «Diğer işlemler» menüsü. */
function OrderMoreMenuButton({ ord, contacts, onAction, align = "center", side = "left", testSuffix = "" }) {
  const { kind, items } = orderMoreMenuItems(ord, {
    eBelgeItems: eBelgeMenuItems(ord, contacts),
  });
  let lastSection = null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 data-[state=open]:bg-slate-100 data-[state=open]:text-slate-900 data-[state=open]:ring-1 data-[state=open]:ring-slate-200"
          title="Diğer işlemler"
          data-testid={`order-more-btn${testSuffix}-${ord.order_number}`}
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={10}
        collisionPadding={24}
        className="z-[80] w-72 max-w-[min(18rem,calc(100vw-1.5rem))] rounded-xl p-1.5 shadow-lg"
        data-testid={`order-more-menu${testSuffix}-${ord.order_number}`}
        data-menu-kind={kind}
      >
        {items.map((it) => {
          const Ico = it.icon;
          const section = it.section && it.section !== lastSection ? it.section : null;
          if (it.section) lastSection = it.section;
          return (
            <div key={it.id}>
              {section && <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase">{section}</div>}
              <DropdownMenuItem
                onSelect={() => onAction(it.id, ord, { eType: it.eType })}
                className="gap-2 text-xs font-medium"
                data-testid={`order-more-${it.testId}${testSuffix}-${ord.order_number}`}
              >
                <Ico className={`w-4 h-4 shrink-0 ${it.color || "text-slate-500"}`} />
                <span className="truncate">{it.label}</span>
              </DropdownMenuItem>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mobil kartta tek birincil kısayol (menünün ilk eylemi). */
function mobilePrimaryAction(ord) {
  const kind = orderMoreMenuKind(ord);
  if (kind === "panel_draft") return { id: "faturalastir", label: "Faturalaştır", className: "bg-emerald-600 text-white" };
  if (kind === "panel_invoiced") return { id: "efatura_olustur", label: "E-Fatura", className: "bg-rose-500 text-white" };
  if (kind === "panel_einvoice") return { id: "mini_10x15", label: "E-Arşiv", className: "bg-sky-600 text-white" };
  if (kind === "integration_einvoice") return { id: "cargo_mini", label: "Etiket", className: "bg-sky-600 text-white" };
  return null;
}

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
  const [shipOrder, setShipOrder] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkLabels, setBulkLabels] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const toggleSel = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const selectedOrders = () => orders.filter((o) => selected.includes(o.id));
  const openInvoicePdfs = (list) => {
    const ids = [...new Set(list.map((o) => o.invoice_id).filter(Boolean))];
    if (!ids.length) { toast.error("Seçili siparişlerde fatura yok."); return; }
    ids.slice(0, 12).forEach((id) => window.open(`${API_URL}/invoices/${id}/pdf`, "_blank", "noopener"));
    toast.success(ids.length > 12 ? `İlk 12 fatura açıldı (${ids.length} faturalı sipariş).` : `${ids.length} fatura yazdırmaya açıldı.`);
  };
  const downloadInvoiceXml = async (list) => {
    const ids = [...new Set(list.map((o) => o.invoice_id).filter(Boolean))];
    if (!ids.length) { toast.error("Seçili siparişlerde e-fatura yok."); return; }
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        const r = await axios.get(`${API_URL}/e-invoice/${id}/xml`, { responseType: "blob" });
        const url = URL.createObjectURL(r.data);
        const a = document.createElement("a");
        a.href = url;
        a.download = `efatura-${id}.xml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        ok++;
      } catch { fail++; }
    }
    toast[fail ? "error" : "success"](`${ok} XML indirildi${fail ? `, ${fail} hata` : ""}.`);
  };
  const carrierLabels = (list, needle, title) => {
    const hit = list.filter((o) => String(o.cargo_carrier || "").toLowerCase().includes(needle));
    if (!hit.length) { toast.error(`Seçili siparişlerde ${title} gönderisi yok.`); return; }
    if (printThermalLabels(hit, activeCompany)) toast.success(`${hit.length} ${title} etiketi yazdırmaya gönderildi.`);
  };
  const bulk = async (action) => {
    if (action === "refresh") {
      setBulkBusy(true);
      try {
        const r = await axios.get(`${API_URL}/integrations/ecommerce?company_id=${companyId}`);
        const channels = Array.isArray(r.data) ? r.data : [];
        let synced = 0;
        for (const c of channels) {
          try { await axios.post(`${API_URL}/integrations/ecommerce/${c.id || c._id}/sync-now`); synced++; }
          catch { /* kanal kapalıysa liste yine yenilenir */ }
        }
        await loadData();
        toast.success(synced ? `${synced} kanal senkronlandı, siparişler güncellendi.` : "Sipariş listesi yenilendi.");
      } catch {
        await loadData();
        toast.success("Sipariş listesi yenilendi.");
      } finally { setBulkBusy(false); }
      return;
    }
    const list = selectedOrders();
    if (!list.length) { toast.error("Sipariş seçin."); return; }
    if (action === "labels" || action === "cargo_label") { setBulkLabels(list); return; }
    if (action === "thermal" || action === "cargo_mini") {
      if (printThermalLabels(list, activeCompany, { size: "100x150" })) {
        axios.post(`${API_URL}/orders/mark-labels-printed`, { ids: list.map((o) => o.id) }).catch(() => {});
        toast.success(`${list.length} ${action === "cargo_mini" ? "mini kargo etiketi" : "termal etiket"} yazdırmaya gönderildi.`);
      }
      return;
    }
    if (action === "cargo_10x10") {
      if (printThermalLabels(list, activeCompany, { size: "100x100" })) toast.success(`${list.length} etiket (10×10) yazdırmaya gönderildi.`);
      return;
    }
    if (action === "hepsijet") { carrierLabels(list, "hepsijet", "HepsiJet"); return; }
    if (action === "navlungo") { carrierLabels(list, "navlungo", "Navlungo"); return; }
    if (action === "einvoice_print" || action === "invoice_print") { openInvoicePdfs(list); return; }
    if (action === "mini_10x15" || action === "mini_8x20") {
      const size = action === "mini_8x20" ? "8x20" : "10x15";
      if (!printMiniInvoices(list, activeCompany, size)) toast.error("Seçili siparişlerde yazdırılacak fatura yok veya açılır pencere engellendi.");
      else toast.success("Mini fatura fişi yazdırmaya gönderildi.");
      return;
    }
    if (action === "xml") { await downloadInvoiceXml(list); return; }
    if (action === "delete") {
      const deletable = list.filter((o) => !o.is_invoiced && !o.invoice_id);
      if (!deletable.length) { toast.error("Faturalanmış siparişler silinemez."); return; }
      if (!window.confirm(`${deletable.length} sipariş silinsin mi? (Çöp Kutusu'ndan 30 gün içinde geri getirebilirsiniz.)`)) return;
      try { const r = await axios.post(`${API_URL}/orders/bulk-delete`, { ids: deletable.map((o) => o.id) }); toast.success(r.data.message); setSelected([]); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
      return;
    }
    if (action === "invoice_date") {
      const date = window.prompt("Yeni fatura tarihi (YYYY-AA-GG)", new Date().toISOString().slice(0, 10));
      if (!date) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error("Tarih YYYY-AA-GG olmalı."); return; }
      const withInv = list.filter((o) => o.invoice_id);
      if (!withInv.length) { toast.error("Seçili siparişlerde fatura yok."); return; }
      let ok = 0, fail = 0;
      for (const o of withInv) {
        try { await axios.put(`${API_URL}/invoices/${o.invoice_id}`, { issue_date: date }); ok++; }
        catch { fail++; }
      }
      toast[fail ? "error" : "success"](`${ok} faturanın tarihi güncellendi${fail ? `, ${fail} kesilmiş fatura değiştirilemedi` : ""}.`);
      loadData();
      return;
    }
    if (action === "invoice_link") {
      const ready = list.filter((o) => o.invoice_id && o.customer_email);
      if (!ready.length) { toast.error("Faturalı ve e-posta adresi olan sipariş seçin."); return; }
      let ok = 0, fail = 0;
      for (const o of ready) {
        try {
          const fd = new FormData();
          const link = `${window.location.origin}/api/invoices/${o.invoice_id}/pdf`;
          fd.append("company_id", companyId);
          fd.append("to", o.customer_email);
          fd.append("subject", `Faturanız ${o.invoice_number || o.order_number}`);
          fd.append("body", `Sayın ${o.customer_name || ""},\n\n${o.invoice_number || o.order_number} numaralı faturanız: ${link}`);
          fd.append("context", "invoice");
          fd.append("ref_id", o.invoice_id);
          fd.append("contact_id", o.contact_id || "");
          fd.append("contact_name", o.customer_name || "");
          await axios.post(`${API_URL}/comm/mail/send`, fd);
          ok++;
        } catch { fail++; }
      }
      toast[fail ? "error" : "success"](`${ok} fatura linki gönderildi${fail ? `, ${fail} hata` : ""}.`);
      return;
    }
    if (action === "cancel") {
      const open = list.filter((o) => o.order_status !== "cancelled");
      if (!open.length) { toast.info("Seçili siparişler zaten iptal."); return; }
      if (!window.confirm(`${open.length} sipariş iptal edilsin mi?`)) return;
    }
    setBulkBusy(true);
    let ok = 0, fail = 0, skipped = 0;
    for (const o of list) {
      try {
        if (action === "invoice" || action === "invoice_create") {
          if (o.is_invoiced || o.invoice_id) { skipped++; continue; }
          await axios.post(`${API_URL}/orders/${o.id || o._id}/convert-to-invoice`, { e_type: "e_archive", as_draft: true });
        } else if (action === "einvoice_create") {
          if (o.is_invoiced || o.invoice_id) { skipped++; continue; }
          const eType = orderEBelgeType(o, contacts);
          await axios.post(`${API_URL}/e-invoice/create`, {
            order_id: o.id || o._id,
            e_type: eType,
            scenario: eType === "e_invoice" ? "TICARI" : undefined,
          });
        } else if (action === "einvoice_send") {
          if (!o.invoice_id) { skipped++; continue; }
          const eType = o.e_type || orderEBelgeType(o, contacts);
          await axios.post(`${API_URL}/invoices/${o.invoice_id}/send-to-gib`, { e_type: eType });
        } else if (action === "approve") {
          if (o.order_status !== "pending") { skipped++; continue; }
          await axios.post(`${API_URL}/orders/${o.id}/approve`, { cargo_carrier: o.cargo_carrier || "geliver" });
        } else if (action === "cargo_create") {
          if (o.cargo_tracking_number) { skipped++; continue; }
          await axios.post(`${API_URL}/cargo/create-shipment`, {
            carrier_code: o.cargo_carrier || "geliver",
            order_id: o.id || o._id,
            customer_name: o.customer_name,
            address: o.shipping_address || o.address,
            city: o.city,
            customer_phone: o.customer_phone,
            company_id: companyId,
          });
        } else if (action === "cancel") {
          if (o.order_status === "cancelled") { skipped++; continue; }
          await axios.put(`${API_URL}/orders/${o.id}/status`, { status: "cancelled" });
        }
        ok++;
      } catch { fail++; }
    }
    setBulkBusy(false);
    if (!ok && !fail) toast.info(skipped ? "Seçili siparişlerde bu işlem için uygun kayıt yok." : "İşlenecek sipariş yok.");
    else toast[fail ? "error" : "success"](`${ok} sipariş işlendi${fail ? `, ${fail} hata` : ""}${skipped ? `, ${skipped} atlandı` : ""}.`);
    setSelected([]);
    loadData();
  };
  const [returnReason, setReturnReason] = useState("");
  const [autoBusy, setAutoBusy] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  const [editOrder, setEditOrder] = useState(null);
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
  const [editTpl, setEditTpl] = useState(false);
  const [searchParams] = useSearchParams();
  useEffect(() => { if (searchParams.get("new") === "1") setNewOrder(true); }, [searchParams]);
  const customerFilter = searchParams.get("customer") || "";
  const [ordF, setOrdF] = useState(() => orderFiltersFromSearch(searchParams));
  useEffect(() => {
    const next = orderFiltersFromSearch(searchParams);
    setOrdF((prev) => {
      if (prev.status === next.status && (!next.q || prev.q === next.q)) return prev;
      return { ...prev, status: next.status, ...(next.q ? { q: next.q } : {}) };
    });
  }, [searchParams]);
  const [sort, setSort] = useState({ key: "order_date", dir: "desc" });
  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  const visibleOrders = useMemo(() => {
    const list = applyOrderFilters(orders.filter((o) => !customerFilter || o.customer_name === customerFilter), ordF);
    const val = (o) => ({ order_number: o.order_number || "", channel: o.channel || "", customer_name: (o.customer_name || "").toLowerCase(), total_amount: Number(o.total_amount) || 0, order_status: o.order_status || "", order_date: o.order_date || o.created_at || "", items: (o.items || []).length })[sort.key];
    return [...list].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === "asc" ? 1 : -1); });
  }, [orders, customerFilter, ordF, sort]);
  const { widths: colW, onResizeStart } = usePersistedColumnWidths("orders-fit", ORDER_COL_DEFAULTS, ORDER_COL_LIMITS);
  const tableWidth = orderTableMinWidth(colW);
  const ColResize = ({ k }) => (
    <span
      role="separator"
      aria-orientation="vertical"
      title="Sütun genişliğini ayarla"
      data-testid={`ord-col-resize-${k}`}
      className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none opacity-0 hover:opacity-100 hover:bg-indigo-400 group-hover/th:opacity-60"
      onPointerDown={(e) => onResizeStart(k, e)}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
    />
  );
  const SortTh = ({ k, children, className = "" }) => (
    <th className={`group/th relative px-4 py-3 cursor-pointer select-none hover:text-slate-800 ${className}`} style={{ width: colW[k] }} onClick={() => toggleSort(k)} data-testid={`ord-sort-${k}`}>
      {children} <span className={`text-[9px] ${sort.key === k ? "text-indigo-600" : "text-slate-300"}`}>{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}</span>
      <ColResize k={k} />
    </th>
  );
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
      const res = await axios.post(`${API_URL}/orders/${orderId}/convert-to-invoice`, {
        e_type: eType || "e_archive",
        as_draft: true,
      });
      toast.success(res.data.message || "Taslak fatura kaydedildi.");
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Taslak fatura oluşturulamadı.");
    }
  };

  /** Taslak faturayı onayla → cari bakiyesi + stok işlenir (yeşil badge). */
  const handlePostDraftInvoice = async (ord) => {
    const invoiceId = ord.invoice_id;
    if (!invoiceId) {
      toast.error("Bu siparişte taslak fatura yok.");
      return;
    }
    if (!window.confirm(`${ord.order_number} taslak faturası onaylansın mı?\nCari bakiyesi ve stok işlenecek.`)) return;
    try {
      const res = await axios.post(`${API_URL}/invoices/${invoiceId}/approve`);
      toast.success(res.data.message || "Fatura onaylandı; cari bakiyesi işlendi.");
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Fatura onaylanamadı.");
    }
  };

  /** Diğer işlemler: e-belge (GİB). Mükellef değilse zorla e-arşiv. */
  const handleEBelgeInvoice = async (ord, eType) => {
    const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
    const resolved = eType === "e_invoice" && orderEBelgeType(ord, contacts) !== "e_invoice"
      ? "e_archive"
      : (eType || orderEBelgeType(ord, contacts));
    const label = resolved === "e_invoice" ? "E-Fatura" : "E-Arşiv";
    if (resolved !== eType && eType === "e_invoice") {
      toast.message("Cari e-fatura mükellefi değil; E-Arşiv kesilecek.");
    }
    if (!window.confirm(`${ord.order_number} için ${label} GİB'e iletilsin mi?`)) return;
    try {
      let invoiceId = ord.invoice_id;
      if (!invoiceId) {
        const draft = await axios.post(`${API_URL}/orders/${ord.id || ord._id}/convert-to-invoice`, {
          e_type: resolved,
          as_draft: true,
        });
        invoiceId = draft.data?.invoice_id;
      }
      const res = await axios.post(`${API_URL}/e-invoice/create`, {
        invoice_id: invoiceId || undefined,
        order_id: ord.id || ord._id,
        company_id: companyId,
        e_type: resolved,
        scenario: resolved === "e_invoice" ? "TICARI" : undefined,
      });
      toast.success(res.data.message || `${label} GİB'e iletildi.`);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || `${label} kesilemedi.`);
    }
  };

  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    try {
      const r = await axios.put(`${API_URL}/orders/${orderId}/status`, { status: newStatus });
      toast.success(r.data.message || "Sipariş durumu güncellendi.");
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Durum güncellenemedi.");
    }
  };

  /** Tek sipariş «Diğer işlemler». */
  const handleOrderMoreAction = async (actionId, ord, extra = {}) => {
    if (actionId.startsWith("ebelge_") || extra.eType) {
      await handleEBelgeInvoice(ord, extra.eType || actionId.replace(/^ebelge_/, ""));
      return;
    }
    if (["mini_10x15", "mini_8x20", "cargo_mini", "cargo_10x10", "xml", "invoice_link", "refresh_status"].includes(actionId)) {
      await runBulkForOrder(actionId, ord);
      return;
    }
    switch (actionId) {
      case "faturalastir":
        if (ord.invoice_id && !ord.is_invoiced) {
          await handlePostDraftInvoice(ord);
        } else if (!ord.is_invoiced) {
          await handleConvertToInvoice(ord.id || ord._id, orderEBelgeType(ord, contacts));
        } else {
          toast.info("Sipariş zaten faturalanmış.");
        }
        return;
      case "efatura_olustur":
        await handleEBelgeInvoice(ord, orderEBelgeType(ord, contacts));
        return;
      case "invoice_date": {
        if (!ord.invoice_id) {
          toast.error("Önce fatura oluşturun.");
          return;
        }
        const date = window.prompt("Yeni fatura tarihi (YYYY-AA-GG)", new Date().toISOString().slice(0, 10));
        if (!date) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          toast.error("Tarih YYYY-AA-GG olmalı.");
          return;
        }
        try {
          await axios.put(`${API_URL}/invoices/${ord.invoice_id}`, { issue_date: date });
          toast.success("Fatura tarihi güncellendi.");
          loadData();
        } catch (err) {
          toast.error(err.response?.data?.detail || "Fatura tarihi değiştirilemedi.");
        }
        return;
      }
      case "kargola":
        setShipOrder(ord);
        return;
      case "navlungo_create": {
        const has = String(ord.cargo_carrier || "").toLowerCase().includes("navlungo");
        if (has) {
          carrierLabels([ord], "navlungo", "Navlungo");
          return;
        }
        try {
          await axios.post(`${API_URL}/cargo/create-shipment`, {
            carrier_code: "navlungo",
            order_id: ord.id || ord._id,
            customer_name: ord.customer_name,
            address: ord.shipping_address || ord.address,
            city: ord.city,
            customer_phone: ord.customer_phone,
            company_id: companyId,
          });
          toast.success("Navlungo siparişi oluşturuldu.");
          loadData();
        } catch (err) {
          toast.error(err.response?.data?.detail || "Navlungo oluşturulamadı.");
        }
        return;
      }
      case "earsiv_send":
        openInvoicePdfs([ord]);
        if (ord.invoice_id) {
          try {
            await axios.post(`${API_URL}/invoices/${ord.invoice_id}/send-to-gib`, {
              e_type: ord.e_type || orderEBelgeType(ord, contacts),
            });
            toast.success("E-Arşiv yazdırma açıldı; GİB gönderimi tetiklendi.");
            loadData();
          } catch (err) {
            toast.message(err.response?.data?.detail || "Yazdırma açıldı; GİB gönderimi atlandı.");
          }
        }
        return;
      case "cargo_track_notify":
        if (!ord.cargo_tracking_number) {
          toast.error("Bu siparişte kargo takip kodu yok.");
          return;
        }
        setNotifyOrder(ord);
        return;
      case "digital_code_notify":
        toast.message("Dijital kod bildirimi bu kanalda henüz bağlanmadı.");
        return;
      case "cargo_change":
        setShipOrder(ord);
        return;
      case "edit": {
        const reason = orderEditBlockedReason(ord);
        if (reason) toast.error(reason);
        else setEditOrder(ord);
        return;
      }
      case "dispatch":
        await makeDispatch(ord);
        return;
      case "return":
        setReturnOrder(ord);
        return;
      case "cargo_label":
        setLabelOrder(ord);
        return;
      case "print_form":
        setPrintOrder(ord);
        return;
      case "notify":
        setNotifyOrder(ord);
        return;
      case "download_xlsx": {
        const rows = orderExportRows(ord);
        exportExcel(rows, ORDER_EXPORT_LINE_COLS, `siparis-${ord.order_number || "order"}`);
        return;
      }
      case "download_pdf": {
        const rows = orderExportRows(ord);
        exportPdf(
          rows,
          ORDER_EXPORT_LINE_COLS,
          `siparis-${ord.order_number || "order"}`,
          `Sipariş ${ord.order_number || ""}`,
          activeCompany?.name || activeCompany?.title || "",
        );
        return;
      }
      default:
        toast.message("Bu işlem henüz bağlanmadı.");
    }
  };

  /** Tek sipariş için yazdır / XML / link aksiyonları. */
  const runBulkForOrder = async (actionId, ord) => {
    if (actionId === "mini_10x15" || actionId === "mini_8x20") {
      const size = actionId === "mini_8x20" ? "8x20" : "10x15";
      if (!printMiniInvoices([ord], activeCompany, size)) toast.error("Yazdırılacak fatura yok veya pencere engellendi.");
      else toast.success("Mini fatura fişi yazdırmaya gönderildi.");
      return;
    }
    if (actionId === "cargo_mini") {
      if (printThermalLabels([ord], activeCompany, { size: "100x150" })) {
        axios.post(`${API_URL}/orders/mark-labels-printed`, { ids: [ord.id || ord._id] }).catch(() => {});
        toast.success("Mini kargo etiketi yazdırmaya gönderildi.");
      }
      return;
    }
    if (actionId === "cargo_10x10") {
      if (printThermalLabels([ord], activeCompany, { size: "100x100" })) toast.success("Etiket (10×10) yazdırmaya gönderildi.");
      return;
    }
    if (actionId === "xml") {
      await downloadInvoiceXml([ord]);
      return;
    }
    if (actionId === "invoice_link") {
      if (!ord.invoice_id || !ord.customer_email) {
        toast.error("Fatura ve müşteri e-postası gerekli.");
        return;
      }
      try {
        const fd = new FormData();
        const link = `${window.location.origin}/api/invoices/${ord.invoice_id}/pdf`;
        fd.append("company_id", companyId);
        fd.append("to", ord.customer_email);
        fd.append("subject", `Faturanız ${ord.invoice_number || ord.order_number}`);
        fd.append("body", `Sayın ${ord.customer_name || ""},\n\n${ord.invoice_number || ord.order_number} numaralı faturanız: ${link}`);
        fd.append("context", "invoice");
        fd.append("ref_id", ord.invoice_id);
        fd.append("contact_id", ord.contact_id || "");
        fd.append("contact_name", ord.customer_name || "");
        await axios.post(`${API_URL}/comm/mail/send`, fd);
        toast.success("Fatura linki gönderildi.");
      } catch {
        toast.error("Fatura linki gönderilemedi.");
      }
      return;
    }
    if (actionId === "refresh_status") {
      await bulk("refresh");
    }
  };

  const handleCreateCargoForOrder = async (order) => {
    try {
      const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
      let carrier = order.cargo_carrier || "geliver";
      try {
        const cfg = await axios.get(`${API_URL}/integrations/cargo`, { params: { company_id: companyId } });
        const list = Array.isArray(cfg.data) ? cfg.data : [];
        const live = list.find((c) => c.carrier_code === "geliver" && (c.status === "connected" || c.is_live || c.live) && c.is_active !== false);
        const connected = list.find((c) => c.status === "connected" && c.is_active !== false);
        carrier = (live || connected || list[0])?.carrier_code || carrier;
      } catch { /* geliver tercih; liste gelmezse devam */ }
      const res = await axios.post(`${API_URL}/cargo/create-shipment`, {
        carrier_code: carrier,
        order_id: order.id || order._id,
        customer_name: order.customer_name,
        address: order.shipping_address,
        city: order.city,
        customer_phone: order.customer_phone,
        company_id: companyId,
      });
      toast.success(res.data.message || `Kargo fişi oluşturuldu! Takip No: ${res.data.tracking_number}`);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kargo kaydı oluşturulamadı.");
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
        customer_email: selectedContact?.email || "bayi@tamkobi.com",
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
      {shipOrder && <CreateShipmentModal order={shipOrder} companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setShipOrder(null)} onDone={loadData} />}
      {approveOrder && <ApproveOrderModal order={approveOrder} companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setApproveOrder(null)} onDone={loadData} />}
      {returnOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"><div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 text-xs" data-testid="return-modal">
          <h3 className="text-sm font-bold">İade — {returnOrder.order_number}</h3><p className="text-slate-500">Tüm kalemler iade alınır, stok geri eklenir ve iade kaydı oluşturulur.</p>
          <textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} rows={3} placeholder="İade nedeni" className="w-full bg-slate-50 border rounded-lg p-2" data-testid="return-reason-input" />
          <div className="flex justify-end gap-2"><button onClick={() => setReturnOrder(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={doReturn} className="px-4 py-1.5 bg-rose-600 text-white rounded-lg font-semibold" data-testid="return-confirm-btn">İadeyi Kaydet</button></div>
        </div></div>
      )}
      {labelOrder && <CargoLabel order={labelOrder} company={activeCompany} onClose={() => setLabelOrder(null)} />}
      {printOrder && (
        <PrintDocument
          docType="order"
          doc={printOrder}
          company={activeCompany}
          onClose={() => setPrintOrder(null)}
          onEditTemplate={() => setEditTpl(true)}
          onPrinted={(doc) => {
            const id = doc?.id || doc?._id;
            if (!id) return;
            axios.post(`${API_URL}/orders/mark-form-printed`, { ids: [id] })
              .then(() => loadData())
              .catch(() => {});
          }}
        />
      )}
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
          <button onClick={() => bulk("invoice")} className="px-3 py-1.5 bg-blue-600 rounded-lg font-semibold" data-testid="bulk-invoice-btn">Toplu Taslak Fatura</button>
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
          <button onClick={() => setNewOrder(true)} className="p-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl" title="Yeni Sipariş" aria-label="Yeni Sipariş" data-testid="new-order-btn"><Plus className="w-4 h-4" /></button>
          <button onClick={() => setAutoShip(true)} className="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl" title="Toplu Kargola" aria-label="Toplu Kargola" data-testid="auto-ship-btn"><Truck className="w-4 h-4" /></button>
          <button onClick={() => setAiImport(true)} className="p-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl" title="AI ile Yükle (PDF/Excel)" aria-label="AI ile Yükle" data-testid="ai-order-btn"><Sparkles className="w-4 h-4" /></button>
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
      {editOrder && <OrderEditModal order={editOrder} products={allProducts} onClose={() => setEditOrder(null)} onSaved={loadData} />}
      {autoShip && <AutoShipModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setAutoShip(false)} onDone={loadData} />}
      {aiImport && <AiOrderImportModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setAiImport(false)} onSaved={loadData} />}

      {activeTab === "orders" ? (<>
        <OrdersToolbar f={ordF} setF={setOrdF} orders={orders} count={visibleOrders.length} total={visibleTotal} rows={visibleOrders} selectedCount={selected.length} bulkBusy={bulkBusy} onBulkAction={bulk} />

        {/* Mobil: sade kart + aynı Diğer işlemler menüsü */}
        <div className="md:hidden space-y-2" data-testid="orders-mobile-list">
          {visibleOrders.length === 0 && (
            <div className="bg-white border border-dashed rounded-2xl px-4 py-8 text-center text-xs text-slate-400" data-testid="ord-empty-mobile">
              Filtreye uyan sipariş yok.
            </div>
          )}
          {visibleOrders.map((ord) => {
            const primary = mobilePrimaryAction(ord);
            return (
              <div
                key={ord.id || ord._id || ord.order_number}
                className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2 text-xs"
                data-testid={`order-card-mobile-${ord.order_number}`}
              >
                <div className="flex justify-between gap-2 items-start">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-slate-900 truncate">{ord.order_number}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span className="text-[10px] uppercase font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{channelTr(ord.channel)}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${orderStatusBadgeClass(ord.order_status)}`}>{statusTr(ord.order_status)}</span>
                    </div>
                    <button type="button" onClick={() => goContact(ord)} className="mt-1 font-semibold text-slate-800 hover:text-indigo-700 truncate text-left block max-w-full">
                      {ord.customer_name || "—"}
                    </button>
                  </div>
                  <div className="text-right shrink-0 font-bold text-slate-900">
                    {formatTrAmount(ord.grand_total ?? ord.total_amount)} ₺
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-100" data-testid={`order-actions-mobile-${ord.order_number}`}>
                  {primary && (
                    <button
                      type="button"
                      onClick={() => handleOrderMoreAction(primary.id, ord)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold ${primary.className}`}
                      data-testid={`order-primary-mobile-${ord.order_number}`}
                    >
                      {primary.label}
                    </button>
                  )}
                  {!ord.cargo_tracking_number ? (
                    <button
                      type="button"
                      onClick={() => setShipOrder(ord)}
                      className={cargoActionButtonClass(ord)}
                      title={cargoActionTitle(ord)}
                      data-testid={`create-cargo-mobile-${ord.order_number}`}
                    >
                      <Truck className="w-4 h-4" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setPrintOrder(ord)}
                    className={printOrderButtonClass(ord)}
                    title={printOrderTitle(ord)}
                    data-testid={`print-order-mobile-${ord.order_number}`}
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <OrderMoreMenuButton
                    ord={ord}
                    contacts={contacts}
                    onAction={handleOrderMoreAction}
                    align="end"
                    side="top"
                    testSuffix="-mobile"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden md:block bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-fixed w-full text-left text-xs text-slate-600" style={{ minWidth: tableWidth }}>
                  <colgroup>
                    <col style={{ width: ORDER_SELECT_COL }} />
                    <col style={{ width: colW.order_number }} />
                    <col style={{ width: colW.customer_name }} />
                    <col style={{ width: colW.items }} />
                    <col style={{ width: colW.total_amount }} />
                    <col style={{ width: colW.order_status }} />
                    <col style={{ width: ORDER_ACTIONS_COL }} />
                  </colgroup>
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                <tr>
                  <th className="px-3 py-3 w-8"><input type="checkbox" checked={selected.length > 0 && selected.length === orders.length} onChange={(e) => setSelected(e.target.checked ? orders.map((o) => o.id) : [])} className="rounded" data-testid="orders-select-all" /></th>
                  <SortTh k="order_number">Sipariş No & Kanal</SortTh>
                  <SortTh k="customer_name">Müşteri / Alıcı</SortTh>
                  <SortTh k="items">Ürünler</SortTh>
                  <SortTh k="total_amount" className="text-right">Tutar</SortTh>
                  <SortTh k="order_status">Sipariş Durumu</SortTh>
                  <th className="relative px-3 py-3 text-center bg-slate-50 sticky right-0 z-[1]" style={{ width: ORDER_ACTIONS_COL }} data-testid="ord-actions-header">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleOrders.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400" data-testid="ord-empty">Filtreye uyan sipariş yok.</td></tr>}
                {visibleOrders.map((ord) => (
                  <tr key={ord.id || ord._id || ord.order_number} className={`group/row hover:bg-slate-50/70 transition ${selected.includes(ord.id) ? "bg-emerald-50/60" : ""}`} data-testid={`order-row-${ord.order_number}`}>
                    <td className="px-3 py-3"><input type="checkbox" checked={selected.includes(ord.id)} onChange={() => toggleSel(ord.id)} className="rounded" data-testid={`order-select-${ord.order_number}`} /></td>
                    <td className="px-4 py-3 font-medium overflow-hidden" data-testid={`order-no-cell-${ord.order_number}`}>
                      <div className="font-bold text-slate-900 font-mono">{ord.order_number}</div>
                      {ord.customer_order_number ? <div className="text-[10px] text-slate-500 font-mono" data-testid={`order-customer-no-${ord.order_number}`}>Müşteri no: {ord.customer_order_number}</div> : null}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] uppercase font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                          {channelTr(ord.channel)}
                        </span>
                        <span
                          className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${orderStatusBadgeClass(ord.order_status)}`}
                          data-testid={`order-status-chip-${ord.order_number}`}
                          title={`Durum: ${statusTr(ord.order_status)}`}
                        >
                          {statusTr(ord.order_status)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 cursor-pointer group overflow-hidden" onClick={() => goContact(ord)} title="Cariye git" data-testid={`order-customer-${ord.order_number}`}>
                      <div className="font-semibold text-slate-900 group-hover:text-indigo-700 group-hover:underline decoration-dotted truncate">{ord.customer_name}</div>
                      <div className="text-[11px] text-slate-400">{ord.city}</div>
                    </td>
                    <td className="px-4 py-3 align-top overflow-hidden">
                      {(() => { const items = ord.items || []; const open = expandedItems === ord.id; const shown = open ? items : items.slice(0, 2); const img = (it) => { const p = products.find((x) => (it.product_id && (x.id === it.product_id || x._id === it.product_id)) || (it.sku && x.sku === it.sku)); return resolveImageUrl(it.image_url || p?.image_url); }; return (
                        <div data-testid={`order-items-${ord.order_number}`}>
                          <div className={open ? "flex flex-col gap-1 max-h-64 overflow-y-auto pr-1 mb-1.5" : "space-y-1"}>
                          {shown.map((it, idx) => (
                            <div key={idx} className={`flex items-center gap-2 ${open ? `rounded-lg p-1.5 ${idx % 2 === 0 ? "bg-slate-50" : "bg-emerald-50/80"}` : ""}`}>
                              {img(it) ? <img src={img(it)} alt="" className={`${open ? "w-10 h-10" : "w-8 h-8"} rounded-md object-cover border bg-white shrink-0`} /> : <div className={`${open ? "w-10 h-10" : "w-8 h-8"} rounded-md border bg-white flex items-center justify-center text-slate-300 shrink-0`}><PackageIcon className="w-4 h-4" /></div>}
                              <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/stock?q=${encodeURIComponent(it.sku || it.product_name || it.name || "")}`); }} className="text-left min-w-0 flex-1 text-slate-700 hover:text-indigo-700 hover:underline decoration-dotted" title="Stok kartını aç" data-testid={`order-item-link-${ord.order_number}-${idx}`}>
                                <div className={`${open ? "font-semibold" : ""} truncate`}>{it.quantity}x {it.product_name || it.name}</div>
                                {open && <div className="text-[10px] text-slate-400">{it.sku ? `SKU ${it.sku} · ` : ""}{it.unit_price != null ? `${formatTrAmount(Number(it.unit_price))} ₺` : ""}{it.variant ? ` · ${it.variant}` : ""}</div>}
                              </button>
                            </div>))}
                          </div>
                          {items.length > 2 && <button type="button" onClick={() => setExpandedItems(open ? null : ord.id)} className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100" data-testid={`order-items-toggle-${ord.order_number}`}>{open ? "Daralt" : `+${items.length - 2} ürün daha · büyüt`}</button>}
                        </div>); })()}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {formatTrAmount((ord.grand_total ?? ord.total_amount))} ₺
                      {Number(ord.vat_total) > 0 && <div className="text-[10px] font-semibold text-slate-400">KDV dahil</div>}
                    </td>
                    <td className="px-4 py-3">
                      {ord.channel && !["b2b", "manual"].includes(ord.channel) ? (
                        <div data-testid={`order-status-badge-${ord.order_number}`} title="Durum pazaryerinden otomatik güncellenir">
                          <span className={`inline-block px-2 py-1 rounded-lg text-[11px] font-semibold border ${orderStatusBadgeClass(ord.order_status)}`}>{statusTr(ord.order_status)}</span>
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
                        <option value="returned">İade Edildi</option>
                        <option value="partially_returned">Kısmi İade</option>
                      </select>)}
                    </td>
                    <td className={`px-3 py-3 text-center overflow-hidden sticky right-0 z-[1] ${selected.includes(ord.id) ? "bg-emerald-50" : "bg-white group-hover/row:bg-slate-50"}`} style={{ width: ORDER_ACTIONS_COL }}>
                      <div className="inline-flex items-center justify-center gap-1" data-testid={`order-actions-${ord.order_number}`}>
                        {!ord.is_invoiced && !ord.invoice_id ? <button onClick={async () => { if (!window.confirm(`${ord.order_number} silinsin mi?`)) return; try { await axios.delete(`${API_URL}/orders/${ord.id}`); toast.success("Sipariş silindi."); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="Siparişi sil" data-testid={`order-delete-${ord.order_number}`}><Trash2 className="w-4 h-4" /></button> : <span className="inline-block w-8 h-8" aria-hidden="true" />}
                        {!ord.is_invoiced ? (
                          ord.invoice_id ? (
                            <button
                              type="button"
                              onClick={() => handlePostDraftInvoice(ord)}
                              className="p-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg shadow-sm border border-amber-600"
                              title={`Taslağı onayla (cari bakiyeye işle)${ord.invoice_number ? `: ${ord.invoice_number}` : ""}`}
                              aria-label="Faturala"
                              data-testid={`convert-inv-btn-${ord.order_number}`}
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                          ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm"
                                title="Taslak fatura oluştur"
                                aria-label="Faturala"
                                data-testid={`convert-inv-btn-${ord.order_number}`}
                              >
                                <FileText className="w-4 h-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={8} collisionPadding={24} className="z-[80] w-52 rounded-xl p-1.5 shadow-lg" data-testid={`inv-type-chooser-${ord.order_number}`}>
                              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase">Taslak fatura türü</div>
                              {[["e_invoice", "E-Fatura", "Mükellef alıcı"], ["e_archive", "E-Arşiv", "Nihai tüketici / pazaryeri"], ["paper", "Kağıt Fatura", "Matbu"]]
                                .filter(([k]) => k !== "e_invoice" || orderCanIssueEFatura(ord, contacts))
                                .map(([k, l, sub]) => (
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
                          )
                        ) : (
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700" title="Faturalandı" aria-label="Faturalandı" data-testid={`invoiced-badge-${ord.order_number}`}>
                            <CheckCircle2 className="w-4 h-4" />
                          </span>
                        )}

                        {!ord.cargo_tracking_number ? (
                          <button
                            type="button"
                            onClick={() => setShipOrder(ord)}
                            className={cargoActionButtonClass(ord)}
                            title={cargoActionTitle(ord)}
                            aria-label={cargoActionTitle(ord)}
                            data-testid={`create-cargo-btn-${ord.order_number}`}
                            data-shipped={orderIsShipped(ord) ? "1" : "0"}
                          >
                            <Truck className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { if (printThermalLabels([ord], activeCompany)) axios.post(`${API_URL}/orders/mark-labels-printed`, { ids: [ord.id] }).then(() => loadData()).catch(() => {}); }}
                            className={ord.label_printed_at
                              ? "p-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm ring-1 ring-sky-700/30"
                              : "p-1.5 text-indigo-700 hover:bg-indigo-50 border border-dashed border-indigo-200 rounded-lg"}
                            title={cargoActionTitle(ord)}
                            aria-label={cargoActionTitle(ord)}
                            data-testid={`print-label-${ord.order_number}`}
                            data-shipped="1"
                          >
                            <Truck className="w-4 h-4" />
                          </button>
                        )}
                        {["pending", "new"].includes(ord.order_status) ? <button type="button" onClick={() => approve(ord)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition" title="Onayla" data-testid={`approve-order-btn-${ord.order_number}`}><CheckCircle className="w-4 h-4" /></button> : <span className="inline-block w-8 h-8" aria-hidden="true" />}
                        <button
                          type="button"
                          onClick={() => setPrintOrder(ord)}
                          className={printOrderButtonClass(ord)}
                          title={printOrderTitle(ord)}
                          aria-label={printOrderTitle(ord)}
                          data-testid={`print-order-btn-${ord.order_number}`}
                          data-printed={ord.form_printed_at ? "1" : "0"}
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <OrderMoreMenuButton
                          ord={ord}
                          contacts={contacts}
                          onAction={handleOrderMoreAction}
                        />
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

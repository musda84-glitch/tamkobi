import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { InvoicePrintShareModal } from "../components/InvoicePrintShareModal";
import { usePersistedColumnWidths } from "../hooks/usePersistedColumnWidths";
import { listImageUrl } from "../utils/imageUrl";
import { orderLineListImageUrl } from "../utils/productImages";
import { Printer, Tag, RotateCcw, FileText as FileIcon, Trash2, UserPlus, Package as PackageIcon, MoreVertical, Factory } from "lucide-react";
import { printThermalLabels } from "../utils/thermalLabels";
import { printCargoLabelsPreferIntegrator } from "../utils/cargoLabelPrint";
import { printMiniInvoices, printMiniInvoicesFromIntegrator } from "../utils/miniInvoicePrint";
import { ClaimsPanel, CancelledPanel, QuestionsPanel } from "../components/MarketplacePanels";
import { ProfitabilityPanel } from "../components/ProfitabilityPanel";
import { CargoLabel } from "../components/CargoLabel";
import { ApproveOrderModal } from "../components/ApproveOrderModal";
import { ElektronikFaturaOnayModal } from "../components/ElektronikFaturaOnayModal";
import { nowIssueDateTime } from "../utils/invoiceIssueNow";
import { CreateShipmentModal } from "../components/CreateShipmentModal";
import { ChangeMarketplaceCargoModal } from "../components/ChangeMarketplaceCargoModal";
import { channelTr, statusTr, orderStatusBadgeClass, marketplaceStatusTr } from "../utils/labels";
import { orderStatusLabel, orderStatusSelectOptions } from "../utils/warehouseShip";
import { MarketplaceProductsPanel } from "../components/MarketplaceProductsPanel";
import { NewOrderModal, AiOrderImportModal, OrderEditModal } from "../components/OrderCreateModals";
import { AutoShipModal } from "../components/AutoShipModal";
import { PricingCenter } from "../components/PricingCenter";
import { OrdersToolbar, ORDER_PAGE_SIZES, applyOrderFilters, orderFiltersFromSearch } from "../components/OrdersToolbar";
import { exportExcel, exportPdf } from "../components/ExportButtons";
import { formatTrAmount } from "../utils/money";
import { formatOrderDateTime, orderTerminRemaining } from "../utils/orderTermin";
import { orderEditBlockedReason } from "../utils/orderEdit";
import { stripNewOrderParam } from "../utils/ordersNewQuery";
import { cargoActionButtonClass, cargoActionTitle, printOrderButtonClass, printOrderTitle, orderIsShipped } from "../utils/orderActionBadges";
import { hydratePrintItemImages, mergeInvoiceItemsIntoOrder } from "../utils/printOrderDoc";
import { eBelgeMenuItems, orderEBelgeType } from "../utils/orderEBelge";
import { orderMoreMenuItems, orderMoreMenuKind, orderInvoiceBadge, orderHasEInvoiceIssued, orderGibInvoiceNumber } from "../utils/orderMoreMenu";
import { ORDER_COL_DEFAULTS, ORDER_COL_LIMITS, ORDER_SELECT_COL, ORDER_ACTIONS_COL, orderTableMinWidth } from "../utils/orderTableLayout";
import { orderBulkEInvoiceEligible, bulkApiErrorDetail, orderRowId, todayYmd } from "../utils/orderBulkActions";
import { BulkEInvoiceConfirmModal } from "../components/BulkEInvoiceConfirmModal";
import { buildProduceFromOrderPayload, orderHasProductionOrder, orderLineCanProduce, orderProduceButtonClass, orderProduceButtonTitle, producibleLinesForOrder, resolveOrderLineProduct } from "../utils/orderProduce";
import { ProductionOrderModal } from "../components/ProductionOrderModal";
import { OrderProduceRecipeModal } from "../components/OrderProduceRecipeModal";
import { OrderLineStockModal } from "../components/OrderLineStockModal";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { useInfiniteRows } from "../hooks/useInfiniteRows";
import { cachedList, contactTypeFilter, dropCached } from "../utils/dataSync";
import { orderPanelFilter, prepareOrdersForPanel } from "../utils/orderFilters";
import { useDataRefresh } from "../utils/dataRefresh";
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
function OrderMoreMenuButton({ ord, contacts, onAction, align = "center", side = "left", testSuffix = "", canDelete = true }) {
  const { kind, items } = orderMoreMenuItems(ord, {
    eBelgeItems: eBelgeMenuItems(ord, contacts),
    canDelete,
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
                title={it.title || it.hint || it.label}
                data-testid={`order-more-${it.testId}${testSuffix}-${ord.order_number}`}
              >
                <Ico className={`w-4 h-4 shrink-0 ${it.color || "text-slate-500"}`} />
                <span className="min-w-0 flex-1">
                  <span className="truncate block">{it.label}</span>
                  {it.hint ? <span className="block text-[10px] font-normal text-slate-400 truncate">{it.hint}</span> : null}
                </span>
              </DropdownMenuItem>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Sipariş satırı → üretim emri (tek ürün doğrudan, çoklu seçici). */
function OrderProduceButton({ ord, catalog, onProduce, testSuffix = "", busy = false }) {
  const lines = producibleLinesForOrder(ord, catalog);
  if (!lines.length) return null;
  return (
    <button
      type="button"
      onClick={() => onProduce(ord)}
      disabled={busy}
      className={orderProduceButtonClass(ord)}
      title={orderProduceButtonTitle(ord)}
      aria-label="Üretim"
      data-testid={`order-produce-btn${testSuffix}-${ord.order_number}`}
      data-produced={orderHasProductionOrder(ord) ? "1" : "0"}
    >
      <Factory className="w-4 h-4" />
    </button>
  );
}

/** Mobil kartta tek birincil kısayol (menünün ilk eylemi). */
function isB2BCartOrder(ord) {
  return !!(ord?.is_held_cart || ord?.is_active_cart || ord?.order_status === "held_cart" || ord?.order_status === "active_cart");
}

function mobilePrimaryAction(ord) {
  const kind = orderMoreMenuKind(ord);
  if (kind === "held_cart") return null;
  if (kind === "panel_draft") return { id: "faturalastir", label: "Faturalaştır", className: "bg-emerald-600 text-white" };
  if (kind === "integration_draft") return { id: "faturalastir", label: "Faturalaştır", className: "bg-emerald-600 text-white" };
  if (kind === "panel_invoiced") return { id: "efatura_olustur", label: "E-Fatura Oluştur", className: "bg-rose-500 text-white" };
  if (kind === "panel_einvoice") return { id: "mini_10x15", label: "E-Arşiv", className: "bg-sky-600 text-white" };
  if (kind === "integration_einvoice") return { id: "cargo_mini", label: "Etiket", className: "bg-sky-600 text-white" };
  return null;
}

export default function OrdersB2BPage() {
  const { activeCompany, can, feature } = useAuth();
  const canDeleteOrder = can("/orders", "delete");
  const showCargoLabel = feature("order_cargo_label");
  const showMoreActions = feature("order_more_actions");
  const showPrices = feature("view_prices");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const goContact = (ord) => navigate(ord.contact_id ? `/contacts?contact_id=${ord.contact_id}` : `/contacts?search=${encodeURIComponent(ord.customer_name || "")}`);
  const ORDER_TABS = useMemo(() => new Set(["orders", "b2b_portal", "claims", "cancelled", "questions", "mp_products", "pricing", "profit"]), []);
  const tabFromUrl = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState(() => (ORDER_TABS.has(tabFromUrl) ? tabFromUrl : "orders"));
  useEffect(() => {
    if (ORDER_TABS.has(tabFromUrl) && tabFromUrl !== activeTab) setActiveTabState(tabFromUrl);
  }, [tabFromUrl, ORDER_TABS]); // eslint-disable-line react-hooks/exhaustive-deps -- sync URL → tab only
  const setActiveTab = useCallback((tab) => {
    setActiveTabState(tab);
    const next = new URLSearchParams(searchParams);
    if (tab && tab !== "orders") next.set("tab", tab);
    else next.delete("tab");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [orders, setOrders] = useState([]);
  const [notifyOrder, setNotifyOrder] = useState(null);
  const [printShareOrder, setPrintShareOrder] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);
  const [labelOrder, setLabelOrder] = useState(null);
  const [dispatchDoc, setDispatchDoc] = useState(null);
  const [returnOrder, setReturnOrder] = useState(null);
  const [approveOrder, setApproveOrder] = useState(null);
  const [eFaturaOrder, setEFaturaOrder] = useState(null);
  const [eFaturaOrders, setEFaturaOrders] = useState(null);
  const [bulkEInvoiceConfirm, setBulkEInvoiceConfirm] = useState(null);
  const [shipOrder, setShipOrder] = useState(null);
  const [cargoChangeOrder, setCargoChangeOrder] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkLabels, setBulkLabels] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** Yalnızca Yenile / menü yenile — sayfa açılışı veya F5 bunu true yapmaz. */
  const [mpSyncing, setMpSyncing] = useState(false);
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const syncMarketplaceOrdersRef = useRef(async () => {});
  const toggleSel = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const selectedOrders = () => orders.filter((o) => {
    const id = orderRowId(o);
    return id && selected.includes(id);
  });
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
    const failMsgs = [];
    const blobErrorDetail = async (err) => {
      const blob = err?.response?.data;
      if (blob instanceof Blob) {
        try {
          const j = JSON.parse(await blob.text());
          if (j?.detail) return typeof j.detail === "string" ? j.detail : "XML indirilemedi.";
        } catch { /* ignore */ }
      }
      const d = err?.response?.data?.detail || err?.message;
      return typeof d === "string" ? d : "XML indirilemedi.";
    };
    for (const id of ids) {
      try {
        let r;
        try {
          r = await axios.get(`${API_URL}/e-invoice/${id}/xml`, { responseType: "blob" });
        } catch (firstErr) {
          try {
            r = await axios.get(`${API_URL}/invoices/${id}/xml`, { responseType: "blob" });
          } catch (secondErr) {
            throw secondErr?.response ? secondErr : firstErr;
          }
        }
        const ct = String(r.headers?.["content-type"] || "");
        if (ct.includes("json")) {
          const text = typeof r.data?.text === "function" ? await r.data.text() : await new Response(r.data).text();
          let detail = "XML indirilemedi.";
          try { detail = JSON.parse(text)?.detail || detail; } catch { /* ignore */ }
          failMsgs.push(typeof detail === "string" ? detail : "XML indirilemedi.");
          fail++;
          continue;
        }
        const url = URL.createObjectURL(r.data);
        const a = document.createElement("a");
        a.href = url;
        a.download = `efatura-${id}.xml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        ok++;
      } catch (err) {
        fail++;
        failMsgs.push(await blobErrorDetail(err));
      }
    }
    if (fail && !ok) {
      toast.error(failMsgs[0] || "XML indirilemedi.");
    } else {
      toast[fail ? "error" : "success"](`${ok} XML indirildi${fail ? `, ${fail} hata` : ""}.`);
    }
  };
  /** E-Fatura/e-Arşiv PDF — önce entegratör (İşNet), yoksa yerel. */
  const downloadInvoicePdf = async (list) => {
    const ids = [...new Set(list.map((o) => o.invoice_id).filter(Boolean))];
    if (!ids.length) { toast.error("Seçili siparişlerde e-fatura yok."); return; }
    let ok = 0, fail = 0;
    const failMsgs = [];
    const blobErrorDetail = async (err) => {
      const blob = err?.response?.data;
      if (blob instanceof Blob) {
        try {
          const j = JSON.parse(await blob.text());
          if (j?.detail) return typeof j.detail === "string" ? j.detail : "PDF indirilemedi.";
        } catch { /* ignore */ }
      }
      const d = err?.response?.data?.detail || err?.message;
      return typeof d === "string" ? d : "PDF indirilemedi.";
    };
    for (const id of ids) {
      try {
        let r;
        try {
          r = await axios.get(`${API_URL}/e-invoice/${id}/pdf`, { params: { download: 1 }, responseType: "blob" });
        } catch (firstErr) {
          try {
            r = await axios.get(`${API_URL}/invoices/${id}/pdf`, { params: { download: 1 }, responseType: "blob" });
          } catch (secondErr) {
            throw secondErr?.response ? secondErr : firstErr;
          }
        }
        const ct = String(r.headers?.["content-type"] || "");
        if (ct.includes("json")) {
          const text = typeof r.data?.text === "function" ? await r.data.text() : await new Response(r.data).text();
          let detail = "PDF indirilemedi.";
          try { detail = JSON.parse(text)?.detail || detail; } catch { /* ignore */ }
          failMsgs.push(typeof detail === "string" ? detail : "PDF indirilemedi.");
          fail++;
          continue;
        }
        const url = URL.createObjectURL(r.data);
        const a = document.createElement("a");
        a.href = url;
        a.download = `efatura-${id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        ok++;
      } catch (err) {
        fail++;
        failMsgs.push(await blobErrorDetail(err));
      }
    }
    if (fail && !ok) {
      toast.error(failMsgs[0] || "PDF indirilemedi.");
    } else {
      toast[fail ? "error" : "success"](`${ok} PDF indirildi${fail ? `, ${fail} hata` : ""}.`);
    }
  };
  const carrierLabels = (list, needle, title) => {
    const hit = list.filter((o) => String(o.cargo_carrier || "").toLowerCase().includes(needle));
    if (!hit.length) { toast.error(`Seçili siparişlerde ${title} gönderisi yok.`); return; }
    if (printThermalLabels(hit, activeCompany)) toast.success(`${hit.length} ${title} etiketi yazdırmaya gönderildi.`);
  };
  /** Kamyon ikonu / mini etiket: entegrasyon etiketi tercih. */
  const printOrderCargoLabel = async (ord, size = "100x150") => {
    const r = await printCargoLabelsPreferIntegrator([ord], activeCompany, {
      apiUrl: API_URL,
      axiosClient: axios,
      size,
    });
    if (r.ok || r.thermal) {
      axios.post(`${API_URL}/orders/mark-labels-printed`, { ids: [ord.id || ord._id].filter(Boolean) })
        .then(() => loadData())
        .catch(() => {});
      toast.success(r.message || "Kargo etiketi yazdırmaya gönderildi.");
    } else {
      toast.error(r.message || "Etiket yazdırılamadı.");
    }
  };
  const bulk = async (action) => {
    if (action === "refresh") {
      // Menü «Yenile» = pazaryeri sync (nav / F5 / mount tetiklemez)
      await syncMarketplaceOrdersRef.current();
      return;
    }
    const list = selectedOrders();
    if (!list.length) { toast.error("Sipariş seçin."); return; }
    if (action === "einvoice_create") {
      const eligible = list.filter(orderBulkEInvoiceEligible);
      if (!eligible.length) {
        toast.info("E-Fatura yalnızca faturalaşmış siparişlerden kesilir. Önce Faturalaştırın.");
        return;
      }
      setBulkEInvoiceConfirm({ orders: eligible });
      return;
    }
    if (action === "labels" || action === "cargo_label" || action === "cargo_label_alt") { setBulkLabels(list); return; }
    if (action === "thermal" || action === "cargo_mini" || action === "cargo_10x10") {
      const size = action === "cargo_10x10" ? "100x100" : "100x150";
      // Entegrasyon siparişleri → pazaryeri/kargo sağlayıcı etiketi; yoksa yerel termal
      const r = await printCargoLabelsPreferIntegrator(list, activeCompany, {
        apiUrl: API_URL,
        axiosClient: axios,
        size,
      });
      if (r.ok || r.thermal) {
        axios.post(`${API_URL}/orders/mark-labels-printed`, { ids: list.map((o) => orderRowId(o)).filter(Boolean) }).catch(() => {});
        toast.success(r.message || `${list.length} etiket yazdırmaya gönderildi.`);
      } else {
        toast.error(r.message || "Etiket yazdırılamadı (açılır pencere engellenmiş olabilir).");
      }
      return;
    }
    if (action === "hepsijet") { carrierLabels(list, "hepsijet", "HepsiJet"); return; }
    if (action === "navlungo") { carrierLabels(list, "navlungo", "Navlungo"); return; }
    if (action === "einvoice_print" || action === "invoice_print") { openInvoicePdfs(list); return; }
    if (action === "mini_10x15" || action === "mini_8x20") {
      const size = action === "mini_8x20" ? "8x20" : "10x15";
      // GİB e-belgesi kesilmiş siparişler → entegratör PDF; aksi halde yerel mini fiş
      const issued = list.filter((o) => o.invoice_id && (o.einvoice_state === "sent" || o.einvoice_state === "queued" || o.gib_uuid || o.is_invoiced));
      if (issued.length) {
        const r = await printMiniInvoicesFromIntegrator(issued, { apiUrl: API_URL, axiosClient: axios });
        if (r.ok) toast.success(r.message || `${r.ok} entegratör PDF yazdırmaya açıldı.`);
        if (r.fail) toast.error(r.message || "Entegratör PDF yazdırılamadı.");
        if (!r.ok && !r.fail) toast.error(r.message || "Yazdırılacak e-fatura yok.");
        return;
      }
      if (!printMiniInvoices(list, activeCompany, size)) toast.error("Seçili siparişlerde yazdırılacak fatura yok veya açılır pencere engellendi.");
      else toast.success("Mini fatura fişi yazdırmaya gönderildi.");
      return;
    }
    if (action === "xml") { await downloadInvoiceXml(list); return; }
    if (action === "efatura_pdf") { await downloadInvoicePdf(list); return; }
    if (action === "delete") {
      const deletable = list.filter((o) => !o.is_invoiced && !o.invoice_id);
      if (!deletable.length) { toast.error("Faturalanmış siparişler silinemez."); return; }
      if (!window.confirm(`${deletable.length} sipariş silinsin mi? (Çöp Kutusu'ndan 30 gün içinde geri getirebilirsiniz.)`)) return;
      try {
        const r = await axios.post(`${API_URL}/orders/bulk-delete`, { ids: deletable.map((o) => orderRowId(o)).filter(Boolean) });
        toast.success(r.data.message);
        setSelected([]);
        loadData();
      } catch (err) {
        toast.error(bulkApiErrorDetail(err) || "Silinemedi.");
      }
      return;
    }
    if (action === "invoice_date") {
      const date = window.prompt("Yeni fatura tarihi (YYYY-AA-GG)", new Date().toISOString().slice(0, 10));
      if (!date) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error("Tarih YYYY-AA-GG olmalı."); return; }
      const withInv = list.filter((o) => o.invoice_id);
      if (!withInv.length) { toast.error("Seçili siparişlerde fatura yok."); return; }
      let ok = 0, fail = 0, firstErr = "";
      for (const o of withInv) {
        try { await axios.put(`${API_URL}/invoices/${o.invoice_id}`, { issue_date: date }); ok++; }
        catch (err) { fail++; if (!firstErr) firstErr = bulkApiErrorDetail(err); }
      }
      toast[fail ? "error" : "success"](`${ok} faturanın tarihi güncellendi${fail ? `, ${fail} kesilmiş fatura değiştirilemedi${firstErr ? `: ${firstErr}` : ""}` : ""}.`);
      loadData();
      return;
    }
    if (action === "invoice_link") {
      const ready = list.filter((o) => o.invoice_id && o.customer_email);
      if (!ready.length) { toast.error("Faturalı ve e-posta adresi olan sipariş seçin."); return; }
      let ok = 0, fail = 0, firstErr = "";
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
        } catch (err) { fail++; if (!firstErr) firstErr = bulkApiErrorDetail(err); }
      }
      toast[fail ? "error" : "success"](`${ok} fatura linki gönderildi${fail ? `, ${fail} hata${firstErr ? `: ${firstErr}` : ""}` : ""}.`);
      return;
    }
    if (action === "cancel") {
      const open = list.filter((o) => o.order_status !== "cancelled");
      if (!open.length) { toast.info("Seçili siparişler zaten iptal."); return; }
      if (!window.confirm(`${open.length} sipariş iptal edilsin mi?`)) return;
    }

    setBulkBusy(true);
    let ok = 0, fail = 0, skipped = 0, firstErr = "";
    for (const o of list) {
      const oid = orderRowId(o);
      try {
        if (action === "invoice" || action === "invoice_create") {
          if (o.is_invoiced || o.invoice_id) { skipped++; continue; }
          await axios.post(`${API_URL}/orders/${oid}/convert-to-invoice`, { e_type: "e_archive", as_draft: true });
        } else if (action === "einvoice_send") {
          if (!orderBulkEInvoiceEligible(o) || !o.invoice_id) { skipped++; continue; }
          const eType = o.e_type || orderEBelgeType(o, contacts);
          await axios.post(`${API_URL}/invoices/${o.invoice_id}/send-to-gib`, { e_type: eType });
        } else if (action === "approve") {
          if (o.order_status !== "pending") { skipped++; continue; }
          await axios.post(`${API_URL}/orders/${oid}/approve`, { cargo_carrier: o.cargo_carrier || "geliver" });
        } else if (action === "cargo_create") {
          if (o.cargo_tracking_number) { skipped++; continue; }
          await axios.post(`${API_URL}/cargo/create-shipment`, {
            carrier_code: o.cargo_carrier || "geliver",
            order_id: oid,
            customer_name: o.customer_name,
            address: o.shipping_address || o.address,
            city: o.city,
            customer_phone: o.customer_phone,
            company_id: companyId,
          });
        } else if (action === "cancel") {
          if (o.order_status === "cancelled") { skipped++; continue; }
          await axios.put(`${API_URL}/orders/${oid}/status`, { status: "cancelled" });
        } else {
          skipped++;
          continue;
        }
        ok++;
      } catch (err) {
        fail++;
        if (!firstErr) firstErr = bulkApiErrorDetail(err);
      }
    }
    setBulkBusy(false);
    if (!ok && !fail) toast.info(skipped ? "Seçili siparişlerde bu işlem için uygun kayıt yok." : "İşlenecek sipariş yok.");
    else toast[fail ? "error" : "success"](`${ok} sipariş işlendi${fail ? `, ${fail} hata${firstErr ? `: ${firstErr}` : ""}` : ""}${skipped ? `, ${skipped} atlandı` : ""}.`);
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
  const doReturn = async () => { try { const r = await axios.post(`${API_URL}/orders/${returnOrder.id}/return`, { reason: returnReason, restock: true }); toast.success(r.data.message); setReturnOrder(null); setReturnReason(""); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "İade kaydedilemedi."); } };
  /** İrsaliye olarak kaydet → e-İrsaliye taslağı (cari fatura değil). */
  const makeDispatch = async (ord, { confirm = true } = {}) => {
    if (ord.dispatch_id || ord.dispatch_number) {
      toast.info(ord.dispatch_number ? `İrsaliye zaten var: ${ord.dispatch_number}` : "Bu sipariş için irsaliye zaten mevcut.");
      return;
    }
    if (confirm && !window.confirm(`${ord.order_number} irsaliye olarak kaydedilsin mi?\nSevk irsaliyesi (e-İrsaliye taslağı) oluşturulur; cari fatura kesilmez.`)) {
      return;
    }
    try {
      const r = await axios.post(`${API_URL}/orders/${ord.id || ord._id}/create-dispatch`);
      toast.success(r.data.message || "İrsaliye kaydedildi.");
      if (r.data?.dispatch) setDispatchDoc(r.data.dispatch);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İrsaliye oluşturulamadı.");
    }
  };
  const [editTpl, setEditTpl] = useState(false);
  useEffect(() => { if (searchParams.get("new") === "1") setNewOrder(true); }, [searchParams]);
  const closeNewOrder = useCallback(() => {
    setNewOrder(false);
    const next = stripNewOrderParam(searchParams);
    if (next) setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
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
  const [pageSize, setPageSize] = useState(() => {
    try {
      const n = Number(localStorage.getItem("orders-page-size") || 50);
      return ORDER_PAGE_SIZES.includes(n) ? n : 50;
    } catch {
      return 50;
    }
  });
  const setPageSizePersist = useCallback((n) => {
    const v = ORDER_PAGE_SIZES.includes(n) ? n : 50;
    setPageSize(v);
    try { localStorage.setItem("orders-page-size", String(v)); } catch { /* ignore */ }
  }, []);
  const ordersListResetKey = useMemo(
    () => `${customerFilter || ""}|${JSON.stringify(ordF)}|${sort.key}|${sort.dir}|${pageSize}`,
    [customerFilter, ordF, sort.key, sort.dir, pageSize],
  );
  const { visible: pagedOrders, hasMore: ordersHasMore, sentinelRef: ordersSentinelRef } = useInfiniteRows(visibleOrders, {
    initial: pageSize,
    step: pageSize,
    resetKey: ordersListResetKey,
  });
  const [products, setProducts] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  // B2B Cart State
  const [cart, setCart] = useState({});
  const [b2bCustomer, setB2bCustomer] = useState("");

  // IndexedDB + artımlı /api/sync — pazaryeri sync-now YOK (nav tık / F5 / mount).
  // Önce önbellekten boya; ürün/cari kataloğu tabloyu bloklamasın.
  const paintOrders = useCallback((rows) => {
    setOrders(prepareOrdersForPanel(rows));
  }, []);

  const loadCatalog = useCallback(async (cid) => {
    try {
      const [prodRows, cntRows] = await Promise.all([
        cachedList("products", cid, {
          onCached: (rows) => {
            setProducts(rows);
            setAllProducts(rows);
          },
        }),
        cachedList("contacts", cid, {
          filter: contactTypeFilter("customer"),
          onCached: setContacts,
        }),
      ]);
      setProducts(prodRows);
      setAllProducts(prodRows);
      setContacts(cntRows);
      if (cntRows.length > 0) setB2bCustomer((prev) => prev || cntRows[0].id || cntRows[0]._id);
    } catch {
      /* katalog isteğe bağlı — üret/eşle sonra gelir */
    }
  }, []);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    const cid = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
    try {
      if (!silent) setLoading(true);
      // Aktif B2B sepet varsayılan listede yok (orderPanelFilter)
      const rows = await cachedList("orders", cid, {
        filter: orderPanelFilter,
        onCached: (cached) => {
          paintOrders(cached);
          if (!silent) setLoading(false);
        },
      });
      paintOrders(rows);
      if (!silent) setLoading(false);
      // Ürün + cari: tablo boyandıktan sonra (Üretim / e-belge menüsü)
      void loadCatalog(cid);
    } catch (err) {
      toast.error("Sipariş verileri yüklenemedi.");
      if (!silent) setLoading(false);
    }
  }, [activeCompany, loadCatalog, paintOrders]);
  useEffect(() => { loadData(); }, [loadData]);
  const refreshOrdersSilent = useCallback(() => loadData({ silent: true }), [loadData]);
  useDataRefresh(refreshOrdersSilent, { companyId, scopes: ["orders", "invoices"] });

  /**
   * Pazaryerinden sipariş çek — SADECE Yenile butonu / toplu menü Yenile.
   * Nav tıklama, F5, mount, loadData bunu ÇAĞIRMAZ.
   * Arka plan: sunucu 10 dk döngüsü (_marketplace_auto_sync_loop).
   */
  const syncMarketplaceOrders = useCallback(async () => {
    setMpSyncing(true);
    try {
      const r = await axios.get(`${API_URL}/integrations/ecommerce?company_id=${companyId}`);
      const channels = Array.isArray(r.data) ? r.data : [];
      let synced = 0;
      for (const c of channels) {
        try {
          await axios.post(`${API_URL}/integrations/ecommerce/${c.id || c._id}/sync-now`, null, { timeout: 120000 });
          synced += 1;
        } catch { /* kanal kapalıysa devam */ }
      }
      // Pazaryeri sync sonrası sipariş cache’ini düşür — taze delta çekilsin
      await dropCached("orders", companyId);
      await loadData({ silent: true });
      toast.success(synced ? `${synced} kanal senkronlandı, siparişler güncellendi.` : "Sipariş listesi yenilendi.");
    } catch {
      await dropCached("orders", companyId);
      await loadData({ silent: true });
      toast.success("Sipariş listesi yenilendi.");
    } finally {
      setMpSyncing(false);
    }
  }, [companyId, loadData]);
  syncMarketplaceOrdersRef.current = syncMarketplaceOrders;
  const refreshOrders = syncMarketplaceOrders;

  const [expandedItems, setExpandedItems] = useState(null);
  const [produceFromOrder, setProduceFromOrder] = useState(null);
  const [produceBusyId, setProduceBusyId] = useState(null);
  const [produceRecipeOrd, setProduceRecipeOrd] = useState(null);
  const [lineStock, setLineStock] = useState(null);
  const productCatalog = allProducts.length ? allProducts : products;
  const openOrderLineStock = (ord, it, idx) => {
    const resolved = resolveOrderLineProduct(it, productCatalog);
    setLineStock({ order: ord, item: it, itemIndex: idx, product: resolved });
    if (resolved?.id || resolved?._id) {
      // Lite listede eksik alan varsa tam kartı çek
      axios.get(`${API_URL}/products/${encodeURIComponent(resolved.id || resolved._id)}`)
        .then((r) => {
          if (r.data) setLineStock((prev) => (prev && prev.itemIndex === idx ? { ...prev, product: r.data } : prev));
        })
        .catch(() => {});
    }
  };
  const openProduceForLine = (ord, it, idx) => {
    const p = resolveOrderLineProduct(it, productCatalog);
    if (!p) {
      toast.error("Ürün stok kartında bulunamadı.");
      return;
    }
    if (!orderLineCanProduce(p)) {
      toast.error("Bu ürün tipi için üretim emri verilemez.");
      return;
    }
    const payload = buildProduceFromOrderPayload(ord, it, p);
    if (!payload) return;
    setProduceFromOrder({ product: payload, order: ord, lineIndex: idx });
  };
  const openProduceForOrder = (ord) => {
    const lines = producibleLinesForOrder(ord, productCatalog);
    if (!lines.length) {
      toast.error("Bu siparişte üretilebilir ürün yok.");
      return;
    }
    setProduceRecipeOrd(ord);
  };
  const submitProduceRecipe = async (station) => {
    const ord = produceRecipeOrd;
    const oid = ord?.id || ord?._id;
    if (!oid) return;
    const st = String(station || "").trim();
    if (!st) {
      toast.error("İstasyon seçin.");
      return;
    }
    setProduceBusyId(oid);
    try {
      const r = await axios.post(`${API_URL}/orders/${oid}/production-recipe`, {
        station: st,
        default_station: st,
      });
      toast.success(r.data.message || `Reçete ve üretim emri oluşturuldu (${st}).`);
      setProduceRecipeOrd(null);
      loadData();
    } catch (err) {
      const data = err.response?.data;
      const raw = data?.detail ?? data?.message ?? data?.error;
      let msg = "";
      if (typeof raw === "string") msg = raw;
      else if (Array.isArray(raw)) msg = raw.map((x) => x?.msg || x?.message || x?.detail || "").filter(Boolean).join(" ");
      else if (raw && typeof raw === "object") msg = raw.msg || raw.message || "";
      if (!msg && err.response?.status === 404) msg = "Sunucu bu işlemi henüz açmadı. Sayfayı yenileyip tekrar deneyin.";
      toast.error(msg || "Reçete / üretim emri oluşturulamadı.");
    } finally {
      setProduceBusyId(null);
    }
  };
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

  /** Sipariş formu yazdır: varsa fatura kalemlerini (güncel ad/ürün) kullan; görselleri stoktan bas. */
  const openPrintOrder = useCallback(async (ord) => {
    if (!ord) return;
    let doc = ord;
    const invId = ord.invoice_id;
    if (invId) {
      try {
        const r = await axios.get(`${API_URL}/invoices/${invId}`);
        doc = mergeInvoiceItemsIntoOrder(ord, r.data) || ord;
      } catch {
        doc = ord;
      }
    }
    const items = doc.items || [];
    const missingImg = items.some((it) => !(it.image_url || it.thumbnail_url));
    if (missingImg && items.length) {
      try {
        const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
        const ids = [...new Set(items.map((it) => it.product_id).filter(Boolean))];
        const skus = [...new Set(items.map((it) => String(it.sku || "").trim()).filter(Boolean))];
        let products = [];
        if (ids.length || skus.length) {
          const qs = new URLSearchParams({ company_id: companyId, lite: "1" });
          if (ids.length) qs.set("ids", ids.join(","));
          if (skus.length) qs.set("skus", skus.join(","));
          const r = await axios.get(`${API_URL}/products?${qs}`);
          products = Array.isArray(r.data) ? r.data : [];
        }
        const stillMissing = hydratePrintItemImages(items, products).some((it) => !(it.image_url || it.thumbnail_url));
        if (stillMissing) {
          const all = await axios.get(`${API_URL}/products?company_id=${companyId}&lite=1`);
          const extra = Array.isArray(all.data) ? all.data : [];
          const seen = new Set(products.map((p) => p.id || p._id));
          extra.forEach((p) => {
            const id = p.id || p._id;
            if (id && !seen.has(id)) {
              seen.add(id);
              products.push(p);
            }
          });
        }
        doc = { ...doc, items: hydratePrintItemImages(items, products) };
      } catch {
        /* yazdırma yine açılsın */
      }
    }
    setPrintOrder(doc);
  }, [activeCompany]);

  /** Faturalaştır → cariye işlenmiş fatura (yeşil). E-belge ayrıca kesilir. */
  const handleFaturalastir = async (ord) => {
    if (ord.is_invoiced) {
      toast.info("Sipariş zaten cariye faturalaştı.");
      return;
    }
    try {
      let invoiceId = ord.invoice_id;
      if (!invoiceId) {
        const draft = await axios.post(`${API_URL}/orders/${ord.id || ord._id}/convert-to-invoice`, {
          e_type: orderEBelgeType(ord, contacts) || "e_archive",
          as_draft: true,
        });
        invoiceId = draft.data?.invoice_id;
        if (!invoiceId) {
          toast.error("Fatura oluşturulamadı.");
          return;
        }
      }
      if (!window.confirm(`${ord.order_number} cariye faturalaşsın mı?\nCari bakiyesi ve stok işlenecek.`)) return;
      const res = await axios.post(`${API_URL}/invoices/${invoiceId}/approve`);
      toast.success(res.data.message || "Faturalaştı — cari bakiyesi işlendi.");
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Faturalaştırılamadı.");
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
      toast.success(res.data.message || "Faturalaştı — cari bakiyesi işlendi.");
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Fatura onaylanamadı.");
    }
  };

  /** Diğer işlemler: e-belge (GİB). Yalnızca faturalaşmış sipariş. Mükellef değilse e-arşiv. */
  const handleEBelgeInvoice = async (ord, eType, opts = {}) => {
    if (!ord?.is_invoiced) {
      toast.error("E-Fatura / E-Arşiv yalnızca faturalaşmış siparişlerden kesilir. Önce Faturalaştırın.");
      return;
    }
    const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
    const explicitScenario = opts.scenario === "TEMEL" || opts.scenario === "TICARI";
    const resolved = explicitScenario
      ? "e_invoice"
      : (eType === "e_invoice" && orderEBelgeType(ord, contacts) !== "e_invoice"
        ? "e_archive"
        : (eType || orderEBelgeType(ord, contacts)));
    const label = resolved === "e_invoice" ? "E-Fatura" : "E-Arşiv";
    if (!explicitScenario && resolved !== eType && eType === "e_invoice") {
      toast.message("Cari e-fatura mükellefi değil; E-Arşiv kesilecek.");
    }
    if (!opts.skipConfirm && !window.confirm(`${ord.order_number} için ${label} GİB'e iletilsin mi?`)) return;
    try {
      let invoiceId = ord.invoice_id;
      if (!invoiceId) {
        const draft = await axios.post(`${API_URL}/orders/${ord.id || ord._id}/convert-to-invoice`, {
          e_type: resolved,
          as_draft: true,
        });
        invoiceId = draft.data?.invoice_id;
      }
      const issueStamp = opts.stampNow ? (opts.issueStamp || nowIssueDateTime()) : null;
      if (issueStamp && invoiceId) {
        try {
          await axios.put(`${API_URL}/invoices/${invoiceId}`, issueStamp);
        } catch {
          /* send body stamp_now ile uygulanır */
        }
      }
      const scenario = resolved === "e_invoice"
        ? (opts.scenario === "TEMEL" ? "TEMEL" : "TICARI")
        : undefined;
      const createBody = {
        invoice_id: invoiceId || undefined,
        order_id: ord.id || ord._id,
        company_id: companyId,
        e_type: resolved,
        scenario,
      };
      if (issueStamp) {
        createBody.stamp_now = true;
        createBody.issue_date = issueStamp.issue_date;
        createBody.issue_time = issueStamp.issue_time;
      }
      const res = await axios.post(`${API_URL}/e-invoice/create`, createBody);
      if (!opts.silentToast) toast.success(res.data.message || `${label} GİB'e iletildi.`);
      if (!opts.skipReload) loadData();
      return res.data;
    } catch (err) {
      if (!opts.silentToast) toast.error(err.response?.data?.detail || `${label} kesilemedi.`);
      throw err;
    }
  };

  const confirmBulkEInvoiceDates = async ({ setDateToToday, orders: list }) => {
    const rows = Array.isArray(list) ? list : [];
    if (!rows.length) {
      setBulkEInvoiceConfirm(null);
      return;
    }
    if (setDateToToday) {
      const today = todayYmd();
      setBulkBusy(true);
      try {
        for (const o of rows) {
          if (!o.invoice_id) continue;
          try {
            await axios.put(`${API_URL}/invoices/${o.invoice_id}`, { issue_date: today });
          } catch (err) {
            toast.error(bulkApiErrorDetail(err) || `${o.order_number || "Fatura"} tarihi güncellenemedi.`);
          }
        }
      } finally {
        setBulkBusy(false);
      }
      setBulkEInvoiceConfirm(null);
      setEFaturaOrders(rows.map((o) => ({ ...o, invoice_date: today, issue_date: today })));
      return;
    }
    setBulkEInvoiceConfirm(null);
    setEFaturaOrders(rows);
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
    if (["mini_10x15", "mini_8x20", "cargo_mini", "cargo_10x10", "xml", "efatura_pdf", "invoice_link", "refresh_status"].includes(actionId)) {
      await runBulkForOrder(actionId, ord);
      return;
    }
    switch (actionId) {
      case "faturalastir":
        await handleFaturalastir(ord);
        return;
      case "efatura_olustur":
        setEFaturaOrder(ord);
        return;
      case "invoice_date": {
        const date = window.prompt("Yeni fatura tarihi (YYYY-AA-GG)", new Date().toISOString().slice(0, 10));
        if (!date) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          toast.error("Tarih YYYY-AA-GG olmalı.");
          return;
        }
        try {
          let invoiceId = ord.invoice_id;
          if (!invoiceId) {
            const draft = await axios.post(`${API_URL}/orders/${ord.id || ord._id}/convert-to-invoice`, {
              e_type: orderEBelgeType(ord, contacts) || "e_archive",
              as_draft: true,
            });
            invoiceId = draft.data?.invoice_id;
            if (!invoiceId) {
              toast.error("Fatura oluşturulamadı; tarih değiştirilemedi.");
              return;
            }
          }
          await axios.put(`${API_URL}/invoices/${invoiceId}`, { issue_date: date });
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
      case "navlungo_create":
        // Eski menü kimliği — kargo gönderim modalını aç
        setShipOrder(ord);
        return;
      case "earsiv_send":
        if (!ord.invoice_id) {
          toast.error("Önce fatura oluşturun.");
          return;
        }
        setPrintShareOrder(ord);
        return;
      case "cargo_track_notify":
        if (!ord.cargo_tracking_number) {
          toast.error("Bu siparişte kargo takip kodu yok. Önce Kargola veya takip kodunu kaydedin.");
          return;
        }
        setNotifyOrder({
          ...ord,
          _notifySubject: `Kargo takip kodunuz - ${ord.order_number}`,
          _notifyMessage: [
            `Sayın ${ord.customer_name || "Müşterimiz"},`,
            "",
            `${ord.order_number} numaralı siparişiniz kargoya verildi.`,
            `Takip kodu: ${ord.cargo_tracking_number}`,
            ord.cargo_tracking_url ? `Takip linki: ${ord.cargo_tracking_url}` : "",
            ord.cargo_carrier_name || ord.cargo_carrier ? `Kargo: ${ord.cargo_carrier_name || ord.cargo_carrier}` : "",
            "",
            "İyi günler.",
          ].filter(Boolean).join("\n"),
        });
        return;
      case "digital_code_notify": {
        const code = window.prompt("Müşteriye bildirilecek dijital / aktivasyon kodu:");
        if (code == null) return;
        const trimmed = String(code).trim();
        if (!trimmed) {
          toast.error("Dijital kod boş olamaz.");
          return;
        }
        setNotifyOrder({
          ...ord,
          _notifySubject: `Dijital kodunuz - ${ord.order_number}`,
          _notifyMessage: [
            `Sayın ${ord.customer_name || "Müşterimiz"},`,
            "",
            `${ord.order_number} numaralı siparişinizin dijital kodu:`,
            "",
            trimmed,
            "",
            "İyi günler.",
          ].join("\n"),
        });
        return;
      }
      case "warehouse_update": {
        try {
          const r = await axios.get(`${API_URL}/warehouses`, { params: { company_id: companyId } });
          const list = Array.isArray(r.data) ? r.data : [];
          if (!list.length) {
            toast.error("Tanımlı depo yok. Önce Stok → Depolar ekleyin.");
            return;
          }
          const lines = list.map((w, i) => `${i + 1}) ${w.name || w.account_name || w.id || w._id}`).join("\n");
          const curIdx = Math.max(0, list.findIndex((w) => (w.id || w._id) === (ord.warehouse_id)));
          const pick = window.prompt(`Depo seçin (numara):\n${lines}`, String(curIdx + 1));
          if (pick == null) return;
          const idx = Math.trunc(Number(pick)) - 1;
          if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) {
            toast.error("Geçersiz depo seçimi.");
            return;
          }
          const wh = list[idx];
          await axios.put(`${API_URL}/orders/${ord.id || ord._id}`, {
            warehouse_id: wh.id || wh._id,
            warehouse_name: wh.name || wh.account_name || "",
          });
          toast.success(`Depo güncellendi: ${wh.name || wh.id || wh._id}`);
          loadData();
        } catch (err) {
          toast.error(err.response?.data?.detail || "Depo bilgisi güncellenemedi.");
        }
        return;
      }
      case "cargo_change":
        setCargoChangeOrder(ord);
        return;
      case "delete": {
        if (ord.is_invoiced || ord.invoice_id || orderHasEInvoiceIssued(ord)) {
          toast.error("Faturalanmış veya GİB'e gönderilmiş sipariş silinemez.");
          return;
        }
        if (!window.confirm(`${ord.order_number || "Sipariş"} silinsin mi?`)) return;
        try {
          await axios.delete(`${API_URL}/orders/${ord.id || ord._id}`);
          toast.success("Sipariş silindi.");
          loadData();
        } catch (err) {
          toast.error(err.response?.data?.detail || "Silinemedi.");
        }
        return;
      }
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
        openPrintOrder(ord);
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
      if (ord.invoice_id) {
        const r = await printMiniInvoicesFromIntegrator([ord], { apiUrl: API_URL, axiosClient: axios });
        if (r.ok) toast.success("Entegratör e-belge PDF yazdırmaya açıldı.");
        else toast.error(r.message || "Entegratör PDF yazdırılamadı.");
        return;
      }
      if (!printMiniInvoices([ord], activeCompany, size)) toast.error("Yazdırılacak fatura yok veya pencere engellendi.");
      else toast.success("Mini fatura fişi yazdırmaya gönderildi.");
      return;
    }
    if (actionId === "cargo_mini" || actionId === "cargo_10x10") {
      const size = actionId === "cargo_10x10" ? "100x100" : "100x150";
      const r = await printCargoLabelsPreferIntegrator([ord], activeCompany, {
        apiUrl: API_URL,
        axiosClient: axios,
        size,
      });
      if (r.ok || r.thermal) {
        axios.post(`${API_URL}/orders/mark-labels-printed`, { ids: [ord.id || ord._id].filter(Boolean) }).catch(() => {});
        toast.success(r.message || (actionId === "cargo_10x10" ? "Etiket (10×10) yazdırmaya gönderildi." : "Mini kargo etiketi yazdırmaya gönderildi."));
      } else {
        toast.error(r.message || "Etiket yazdırılamadı.");
      }
      return;
    }
    if (actionId === "xml") {
      await downloadInvoiceXml([ord]);
      return;
    }
    if (actionId === "efatura_pdf") {
      await downloadInvoicePdf([ord]);
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
      {cargoChangeOrder && (
        <ChangeMarketplaceCargoModal
          order={cargoChangeOrder}
          onClose={() => setCargoChangeOrder(null)}
          onDone={loadData}
        />
      )}
      {approveOrder && <ApproveOrderModal order={approveOrder} companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setApproveOrder(null)} onDone={loadData} />}
      {bulkEInvoiceConfirm && (
        <BulkEInvoiceConfirmModal
          orders={bulkEInvoiceConfirm.orders}
          busy={bulkBusy}
          onClose={() => setBulkEInvoiceConfirm(null)}
          onConfirm={confirmBulkEInvoiceDates}
        />
      )}
      {(eFaturaOrder || eFaturaOrders) && (
        <ElektronikFaturaOnayModal
          order={eFaturaOrder || null}
          invoices={eFaturaOrders || undefined}
          contacts={contacts}
          companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}
          onClose={() => {
            setEFaturaOrder(null);
            setEFaturaOrders(null);
            if (eFaturaOrders) loadData();
          }}
          onConfirm={async (payload, ctx) => {
            const bulkList = eFaturaOrders;
            if (bulkList?.length) {
              const { eType, scenario } = payload || {};
              ctx?.setStep?.("prepare", "active");
              let ok = 0;
              let fail = 0;
              ctx?.setStep?.("send", "active");
              for (const ord of bulkList) {
                const key = orderRowId(ord) || ord.invoice_id;
                try {
                  ctx?.setItem?.(key, { status: "running", detail: "Gönderiliyor…" });
                  await handleEBelgeInvoice(ord, eType, {
                    scenario,
                    skipConfirm: true,
                    silentToast: true,
                    skipReload: true,
                  });
                  ok++;
                  ctx?.setItem?.(key, { status: "ok", detail: "Gönderildi" });
                } catch (err) {
                  fail++;
                  ctx?.setItem?.(key, { status: "error", detail: bulkApiErrorDetail(err) || "Kesilemedi" });
                }
              }
              ctx?.setStep?.("refresh", "done");
              loadData();
              setSelected([]);
              return { ok, fail, skipped: 0 };
            }
            const ord = eFaturaOrder;
            if (!ord) return;
            const { eType, scenario, alias, stampNow } = payload || {};
            if (alias && ord.contact_id) {
              try {
                await axios.put(`${API_URL}/contacts/${ord.contact_id}`, {
                  e_invoice_alias: alias,
                  is_e_invoice_user: eType === "e_invoice",
                });
              } catch {
                /* gönderim yine denenecek */
              }
            }
            const issueStamp = stampNow ? nowIssueDateTime() : null;
            await handleEBelgeInvoice(ord, eType, {
              scenario,
              skipConfirm: true,
              stampNow: !!issueStamp,
              issueStamp: issueStamp || undefined,
            });
          }}
        />
      )}
      {returnOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"><div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 text-xs" data-testid="return-modal">
          <h3 className="text-sm font-bold">İade — {returnOrder.order_number}</h3><p className="text-slate-500">Tüm kalemler iade alınır, stok geri eklenir ve iade kaydı oluşturulur.</p>
          <textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} rows={3} placeholder="İade nedeni" className="w-full bg-slate-50 border rounded-lg p-2" data-testid="return-reason-input" />
          <div className="flex justify-end gap-2"><button onClick={() => setReturnOrder(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={doReturn} className="px-4 py-1.5 bg-rose-600 text-white rounded-lg font-semibold" data-testid="return-confirm-btn">İadeyi Kaydet</button></div>
        </div></div>
      )}
      {labelOrder && <CargoLabel order={labelOrder} company={activeCompany} onClose={() => setLabelOrder(null)} />}
      {printShareOrder && (
        <InvoicePrintShareModal
          order={printShareOrder}
          contact={contacts.find((c) => (c.id || c._id) === printShareOrder.contact_id) || {}}
          companyId={companyId}
          companyName={activeCompany?.name || activeCompany?.title || ""}
          onPrint={(doc) => setPrintInvoice(doc)}
          onClose={() => setPrintShareOrder(null)}
        />
      )}
      {printInvoice && (
        <PrintDocument
          docType="invoice"
          doc={printInvoice}
          company={activeCompany}
          onClose={() => setPrintInvoice(null)}
        />
      )}
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
          defaultSubject={notifyOrder._notifySubject || `Siparişiniz Yola Çıktı - ${notifyOrder.order_number}`}
          defaultMessage={notifyOrder._notifyMessage || TEMPLATES.order(notifyOrder)}
          context="order"
          refId={notifyOrder.id || notifyOrder._id}
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
          {canDeleteOrder ? <button onClick={() => bulk("delete")} className="px-3 py-1.5 bg-rose-600 rounded-lg font-semibold flex items-center gap-1" data-testid="bulk-delete-btn"><Trash2 className="w-3.5 h-3.5" /> Sil</button> : null}
          <button onClick={() => setSelected([])} className="ml-auto px-2 py-1 border border-slate-600 rounded-lg" data-testid="bulk-clear-btn">Seçimi Kaldır</button>
        </div>
      )}
      {bulkLabels && (
        <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-start justify-center p-4 overflow-y-auto print:static print:bg-white print:p-0" {...backdropDismissProps(() => setBulkLabels(null))}>
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
      {activeTab === "claims" && <ClaimsPanel companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />}
      {activeTab === "cancelled" && <CancelledPanel orders={orders} />}
      {activeTab === "profit" && <ProfitabilityPanel companyId={activeCompany?.id || "comp_nexus_main_01"} />}
      {activeTab === "questions" && <QuestionsPanel companyId={activeCompany?.id || "comp_nexus_main_01"} />}
      {activeTab === "pricing" && <PricingCenter companyId={activeCompany?.id || "comp_nexus_main_01"} />}
      {activeTab === "mp_products" && <MarketplaceProductsPanel companyId={activeCompany?.id || "comp_nexus_main_01"} />}
      {newOrder && <NewOrderModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} contacts={contacts} products={productCatalog} onClose={closeNewOrder} onSaved={loadData} />}
      {editOrder && <OrderEditModal order={editOrder} products={productCatalog} onClose={() => setEditOrder(null)} onSaved={loadData} />}
      {produceFromOrder && (
        <ProductionOrderModal
          companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}
          product={produceFromOrder.product}
          source="sales_order"
          onClose={() => setProduceFromOrder(null)}
          onCreated={() => setProduceFromOrder(null)}
        />
      )}
      {produceRecipeOrd && (
        <OrderProduceRecipeModal
          order={produceRecipeOrd}
          companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}
          lineCount={producibleLinesForOrder(produceRecipeOrd, productCatalog).length}
          busy={produceBusyId === (produceRecipeOrd.id || produceRecipeOrd._id)}
          onClose={() => !produceBusyId && setProduceRecipeOrd(null)}
          onConfirm={submitProduceRecipe}
        />
      )}
      {autoShip && <AutoShipModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setAutoShip(false)} onDone={loadData} />}
      {aiImport && <AiOrderImportModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setAiImport(false)} onSaved={loadData} />}
      {lineStock && (
        <OrderLineStockModal
          order={lineStock.order}
          item={lineStock.item}
          itemIndex={lineStock.itemIndex}
          product={lineStock.product}
          products={productCatalog}
          companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}
          onClose={() => setLineStock(null)}
          onMatched={(updated) => {
            if (updated) {
              setOrders((prev) => prev.map((o) => ((o.id || o._id) === (updated.id || updated._id) ? { ...o, ...updated } : o)));
            } else {
              loadData();
            }
          }}
          onProductUpdated={() => {
            axios.get(`${API_URL}/products?company_id=${activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}&lite=1`)
              .then((r) => { setAllProducts(r.data || []); setProducts(r.data || []); })
              .catch(() => {});
          }}
        />
      )}

      {activeTab === "orders" ? (<>
        <OrdersToolbar
          f={ordF}
          setF={setOrdF}
          orders={orders}
          count={visibleOrders.length}
          total={visibleTotal}
          rows={visibleOrders}
          selectedCount={selected.length}
          bulkBusy={bulkBusy}
          onBulkAction={bulk}
          pageSize={pageSize}
          onPageSizeChange={setPageSizePersist}
          onRefresh={refreshOrders}
          refreshBusy={mpSyncing}
        />

        {/* Mobil: sade kart + aynı Diğer işlemler menüsü */}
        <div className="md:hidden space-y-2" data-testid="orders-mobile-list">
          {visibleOrders.length === 0 && (
            <div className="bg-white border border-dashed rounded-2xl px-4 py-8 text-center text-xs text-slate-400" data-testid="ord-empty-mobile">
              Filtreye uyan sipariş yok.
            </div>
          )}
          {pagedOrders.map((ord) => {
            const primary = mobilePrimaryAction(ord);
            return (
              <div
                key={ord.id || ord._id || ord.order_number}
                className={`bg-white border border-slate-200 rounded-2xl p-3 space-y-2 text-xs [content-visibility:auto] [contain-intrinsic-size:auto_120px] ${isB2BCartOrder(ord) ? "opacity-70 bg-slate-50" : ""}`}
                data-testid={`order-card-mobile-${ord.order_number}`}
              >
                <div className="flex justify-between gap-2 items-start">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-slate-900 truncate">{ord.held_label || ord.order_number}</div>
                    {(() => {
                      const od = formatOrderDateTime(ord.order_date || ord.created_at);
                      const termin = orderTerminRemaining(ord.estimated_delivery);
                      return (
                        <div className="mt-0.5 space-y-0.5" data-testid={`order-dates-mobile-${ord.order_number}`}>
                          {od ? <div className="text-[10px] text-slate-500">{od}</div> : null}
                          {termin ? (
                            <div className={`text-[10px] font-semibold ${termin.overdue ? "text-rose-600" : "text-amber-700"}`} title={termin.title}>
                              {termin.label}
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span className="text-[10px] uppercase font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{channelTr(ord.channel)}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${orderStatusBadgeClass(ord.order_status)}`}>{orderStatusLabel(ord, statusTr(ord.order_status))}</span>
                    </div>
                    <button type="button" onClick={() => goContact(ord)} className="mt-1 font-semibold text-slate-800 hover:text-indigo-700 truncate text-left block max-w-full">
                      {ord.customer_name || "—"}
                    </button>
                  </div>
                  <div className="text-right shrink-0 font-bold text-slate-900">
                    {showPrices ? `${formatTrAmount(ord.grand_total ?? ord.total_amount)} ₺` : "—"}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-100" data-testid={`order-actions-mobile-${ord.order_number}`}>
                  {isB2BCartOrder(ord) ? (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`${ord.held_label || ord.order_number} için eksik kalemler üretime alınsın mı?`)) return;
                          try {
                            const r = await axios.post(`${API_URL}/order-picks/${ord.id || ord._id}/to-production`, {});
                            toast.success(r.data.message || "Eksik ürünler üretime alındı.");
                            loadData();
                          } catch (err) {
                            toast.error(err.response?.data?.detail || "Eksik ürünler üretime alınamadı.");
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200"
                        title="Eksik ürünleri üretime al"
                        data-testid={`order-produce-missing-mobile-${ord.order_number}`}
                      >
                        <span className="inline-flex items-center gap-1"><Factory className="w-3.5 h-3.5" /> Üretime al</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openPrintOrder(ord)}
                        className={printOrderButtonClass(ord)}
                        title={printOrderTitle(ord)}
                        data-testid={`print-order-mobile-${ord.order_number}`}
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
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
                      ) : showCargoLabel ? (
                        <button
                          type="button"
                          onClick={() => printOrderCargoLabel(ord)}
                          className={ord.label_printed_at
                            ? "p-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm ring-1 ring-sky-700/30"
                            : "p-1.5 text-indigo-700 hover:bg-indigo-50 border border-dashed border-indigo-200 rounded-lg"}
                          title={cargoActionTitle(ord)}
                          aria-label="Kargo etiketi"
                          data-testid={`print-label-mobile-${ord.order_number}`}
                        >
                          <Truck className="w-4 h-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openPrintOrder(ord)}
                        className={printOrderButtonClass(ord)}
                        title={printOrderTitle(ord)}
                        data-testid={`print-order-mobile-${ord.order_number}`}
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      <OrderProduceButton ord={ord} catalog={productCatalog} onProduce={openProduceForOrder} testSuffix="-mobile" busy={produceBusyId === (ord.id || ord._id)} />
                      {showMoreActions ? (
                        <OrderMoreMenuButton
                          ord={ord}
                          contacts={contacts}
                          onAction={handleOrderMoreAction}
                          align="end"
                          side="top"
                          testSuffix="-mobile"
                          canDelete={canDeleteOrder}
                        />
                      ) : null}
                    </>
                  )}
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
                  <th className="px-3 py-3 w-8"><input type="checkbox" checked={selected.length > 0 && orders.length > 0 && selected.length === orders.map(orderRowId).filter(Boolean).length} onChange={(e) => setSelected(e.target.checked ? orders.map(orderRowId).filter(Boolean) : [])} className="rounded" data-testid="orders-select-all" /></th>
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
                {pagedOrders.map((ord) => (
                  <tr key={ord.id || ord._id || ord.order_number} className={`group/row hover:bg-slate-50/70 transition [content-visibility:auto] [contain-intrinsic-size:auto_64px] ${selected.includes(orderRowId(ord)) ? "bg-emerald-50/60" : ""} ${isB2BCartOrder(ord) ? "opacity-70 bg-slate-50/90" : ""}`} data-testid={`order-row-${ord.order_number}`}>
                    <td className="px-3 py-3"><input type="checkbox" checked={selected.includes(orderRowId(ord))} onChange={() => toggleSel(orderRowId(ord))} className="rounded" data-testid={`order-select-${ord.order_number}`} /></td>
                    <td className="px-4 py-3 font-medium overflow-hidden" data-testid={`order-no-cell-${ord.order_number}`}>
                      <div className="font-bold text-slate-900 font-mono">{ord.held_label || ord.order_number}</div>
                      {ord.held_label && ord.order_number && ord.held_label !== ord.order_number ? (
                        <div className="text-[10px] text-slate-400 font-mono">{ord.order_number}</div>
                      ) : null}
                      {ord.customer_order_number ? <div className="text-[10px] text-slate-500 font-mono" data-testid={`order-customer-no-${ord.order_number}`}>Müşteri no: {ord.customer_order_number}</div> : null}
                      {(() => {
                        const od = formatOrderDateTime(ord.order_date || ord.created_at);
                        const termin = orderTerminRemaining(ord.estimated_delivery);
                        return (
                          <div className="mt-0.5 space-y-0.5" data-testid={`order-dates-${ord.order_number}`}>
                            {od ? <div className="text-[10px] text-slate-500" title="Sipariş tarihi">{od}</div> : null}
                            {termin ? (
                              <div
                                className={`text-[10px] font-semibold ${termin.overdue ? "text-rose-600" : "text-amber-700"}`}
                                title={termin.title}
                                data-testid={`order-termin-${ord.order_number}`}
                              >
                                {termin.label}
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                      {(() => {
                        const gibNo = orderGibInvoiceNumber(ord);
                        return gibNo ? (
                          <div className="text-[10px] text-emerald-700 font-mono font-semibold mt-0.5" data-testid={`order-gib-no-${ord.order_number}`} title="GİB fatura numarası">
                            GİB: {gibNo}
                          </div>
                        ) : null;
                      })()}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] uppercase font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                          {channelTr(ord.channel)}
                        </span>
                        <span
                          className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${orderStatusBadgeClass(ord.order_status)}`}
                          data-testid={`order-status-chip-${ord.order_number}`}
                          title={`Durum: ${orderStatusLabel(ord, statusTr(ord.order_status))}`}
                        >
                          {orderStatusLabel(ord, statusTr(ord.order_status))}
                        </span>
                        {(ord.payment_method || ord.bank_name) ? (
                          <span
                            className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 max-w-[14rem] truncate"
                            title={[ord.payment_method, ord.bank_name].filter(Boolean).join(" · ")}
                            data-testid={`order-payment-${ord.order_number}`}
                          >
                            {ord.payment_method || ord.bank_name}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 cursor-pointer group overflow-hidden" onClick={() => goContact(ord)} title="Cariye git" data-testid={`order-customer-${ord.order_number}`}>
                      <div className="font-semibold text-slate-900 group-hover:text-indigo-700 group-hover:underline decoration-dotted truncate">{ord.customer_name}</div>
                      <div className="text-[11px] text-slate-400">{ord.city}</div>
                    </td>
                    <td className="px-4 py-3 align-top overflow-hidden">
                      {(() => { const items = ord.items || []; const open = expandedItems === ord.id; const shown = open ? items : items.slice(0, 2); const img = (it, p) => listImageUrl(orderLineListImageUrl(it, p), open ? 80 : 48); return (
                        <div data-testid={`order-items-${ord.order_number}`}>
                          <div className={open ? "flex flex-col gap-1 max-h-64 overflow-y-auto pr-1 mb-1.5" : "space-y-1"}>
                          {shown.map((it, idx) => {
                            const lineProd = resolveOrderLineProduct(it, productCatalog);
                            const canProduce = orderLineCanProduce(lineProd);
                            const thumb = img(it, lineProd);
                            return (
                            <div key={idx} className={`flex items-center gap-2 ${open ? `rounded-lg p-1.5 ${idx % 2 === 0 ? "bg-slate-50" : "bg-emerald-50/80"}` : ""}`}>
                              {thumb ? <img src={thumb} alt="" width={open ? 40 : 32} height={open ? 40 : 32} loading="lazy" decoding="async" className={`${open ? "w-10 h-10" : "w-8 h-8"} rounded-md object-cover border bg-white shrink-0`} /> : <div className={`${open ? "w-10 h-10" : "w-8 h-8"} rounded-md border bg-white flex items-center justify-center text-slate-300 shrink-0`}><PackageIcon className="w-4 h-4" /></div>}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openOrderLineStock(ord, it, idx); }}
                                className={`text-left min-w-0 flex-1 hover:underline decoration-dotted ${lineProd ? "text-slate-700 hover:text-indigo-700" : "text-amber-800 hover:text-amber-900"}`}
                                title={lineProd ? "Stok kartını aç" : "Stok kartına eşleştir"}
                                data-testid={`order-item-link-${ord.order_number}-${idx}`}
                              >
                                <div className={`${open ? "font-semibold" : ""} truncate`}>{it.quantity}x {it.product_name || it.name}</div>
                                {open && <div className="text-[10px] text-slate-400">{it.sku ? `SKU ${it.sku} · ` : ""}{showPrices && it.unit_price != null ? `${formatTrAmount(Number(it.unit_price))} ₺` : ""}{it.variant ? ` · ${it.variant}` : ""}{!lineProd ? " · eşleşmedi" : ""}</div>}
                              </button>
                              {canProduce ? (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); openProduceForLine(ord, it, idx); }}
                                  className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-1 rounded-md text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100"
                                  title="Üretim emri ver"
                                  data-testid={`order-produce-${ord.order_number}-${idx}`}
                                >
                                  <Factory className="w-3 h-3" />
                                  <span className="hidden xl:inline">Üretim</span>
                                </button>
                              ) : null}
                            </div>);
                          })}
                          </div>
                          {items.length > 2 && <button type="button" onClick={() => setExpandedItems(open ? null : ord.id)} className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100" data-testid={`order-items-toggle-${ord.order_number}`}>{open ? "Daralt" : `+${items.length - 2} ürün daha · büyüt`}</button>}
                        </div>); })()}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {showPrices ? (
                        <>
                          {formatTrAmount((ord.grand_total ?? ord.total_amount))} ₺
                          {Number(ord.vat_total) > 0 && <div className="text-[10px] font-semibold text-slate-400">KDV dahil</div>}
                        </>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {ord.channel && !["b2b", "manual"].includes(ord.channel) ? (
                        <div data-testid={`order-status-badge-${ord.order_number}`} title="Durum pazaryerinden otomatik güncellenir">
                          <span className={`inline-block px-2 py-1 rounded-lg text-[11px] font-semibold border ${orderStatusBadgeClass(ord.order_status)}`}>{orderStatusLabel(ord, statusTr(ord.order_status))}</span>
                          {ord.marketplace_status && <div className="text-[10px] text-slate-400 mt-0.5">{channelTr(ord.channel)}: {marketplaceStatusTr(ord.marketplace_status)}</div>}
                          {ord.channel === "shopphp" && <button onClick={async () => { try { const r = await axios.post(`${API_URL}/orders/${ord.id || ord._id}/push-shopphp`); toast.success(r.data.message); loadData(); } catch (e) { toast.error(e.response?.data?.detail || "Bildirilemedi."); } }} className={`mt-1 text-[10px] font-semibold underline ${ord.shopphp_push?.ok ? "text-emerald-700" : ord.shopphp_push?.ok === false ? "text-rose-600" : "text-indigo-600"}`} title={ord.shopphp_push ? `Son bildirim: ${new Date(ord.shopphp_push.at).toLocaleString("tr-TR")}${ord.shopphp_push.error ? " — " + ord.shopphp_push.error : ""}` : "Onay/kargo/fatura bilgisini ShopPHP mağazasına yaz"} data-testid={`shopphp-push-${ord.order_number}`}>{ord.shopphp_push?.ok ? "Mağazaya bildirildi ✓" : ord.shopphp_push?.ok === false ? "Bildirim hatası — tekrar dene" : "Mağazaya Bildir"}</button>}
                        </div>
                      ) : isB2BCartOrder(ord) ? (
                        <span className={`inline-block px-2 py-1 rounded-lg text-[11px] font-semibold border ${orderStatusBadgeClass(ord.order_status)}`} data-testid={`order-status-badge-${ord.order_number}`}>{orderStatusLabel(ord, statusTr(ord.order_status))}</span>
                      ) : (
                      <select
                        value={ord.order_status}
                        onChange={(e) => handleUpdateOrderStatus(ord.id || ord._id, e.target.value)}
                        className="bg-slate-100 border border-slate-200 rounded p-1 text-[11px] font-semibold"
                        data-testid={`order-status-select-${ord.order_number}`}
                      >
                        {orderStatusSelectOptions(ord).map(([k, l]) => (
                          <option key={k} value={k}>{l}</option>
                        ))}
                      </select>)}
                    </td>
                    <td className={`px-3 py-3 text-center overflow-hidden sticky right-0 z-[1] ${selected.includes(orderRowId(ord)) ? "bg-emerald-50" : "bg-white group-hover/row:bg-slate-50"}`} style={{ width: ORDER_ACTIONS_COL }}>
                      <div className="inline-flex items-center justify-center gap-1" data-testid={`order-actions-${ord.order_number}`}>
                        {isB2BCartOrder(ord) ? (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(`${ord.held_label || ord.order_number} için eksik kalemler üretime alınsın mı?`)) return;
                                try {
                                  const r = await axios.post(`${API_URL}/order-picks/${ord.id || ord._id}/to-production`, {});
                                  toast.success(r.data.message || "Eksik ürünler üretime alındı.");
                                  loadData();
                                } catch (err) {
                                  toast.error(err.response?.data?.detail || "Eksik ürünler üretime alınamadı.");
                                }
                              }}
                              className="p-1.5 rounded-lg text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100"
                              title="Eksik ürünleri üretime al"
                              aria-label="Eksik ürünleri üretime al"
                              data-testid={`order-produce-missing-${ord.order_number}`}
                            >
                              <Factory className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openPrintOrder(ord)}
                              className={printOrderButtonClass(ord)}
                              title={printOrderTitle(ord)}
                              aria-label={printOrderTitle(ord)}
                              data-testid={`print-order-btn-${ord.order_number}`}
                              data-printed={ord.form_printed_at ? "1" : "0"}
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                        {!ord.is_invoiced && !ord.invoice_id && !orderHasEInvoiceIssued(ord) && canDeleteOrder ? <button onClick={async () => { if (!window.confirm(`${ord.order_number} silinsin mi?`)) return; try { await axios.delete(`${API_URL}/orders/${ord.id}`); toast.success("Sipariş silindi."); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="Siparişi sil" data-testid={`order-delete-${ord.order_number}`}><Trash2 className="w-4 h-4" /></button> : <span className="inline-block w-8 h-8" aria-hidden="true" />}
                        {(() => {
                          const invBadge = orderInvoiceBadge(ord);
                          if (orderHasEInvoiceIssued(ord) && invBadge) {
                            return (
                              <span
                                className={`inline-flex flex-col items-center justify-center px-1.5 py-0.5 rounded-lg text-[8px] font-bold border leading-tight text-center max-w-[5.25rem] pointer-events-none select-none ${invBadge.className}`}
                                title={invBadge.title || invBadge.label}
                                data-testid={`invoiced-badge-${ord.order_number}`}
                                data-badge={invBadge.testId}
                                aria-label={invBadge.label}
                              >
                                <span>{invBadge.line1 || "Faturalaşmış"}</span>
                                <span>{invBadge.line2 || ""}</span>
                              </span>
                            );
                          }
                          if (ord.is_invoiced) {
                            return (
                              <button
                                type="button"
                                onClick={() => setEFaturaOrder(ord)}
                                className="inline-flex flex-col items-center justify-center px-1.5 py-0.5 rounded-lg text-[9px] font-bold leading-tight bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 max-w-[4.5rem]"
                                title="Faturalaştı — tıkla: E-Fatura Oluştur"
                                data-testid={`invoiced-badge-${ord.order_number}`}
                              >
                                Faturalaştı
                              </button>
                            );
                          }
                          if (ord.invoice_id) {
                            return (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="p-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg shadow-sm border border-amber-600"
                                title={`Taslak — Faturalaştır veya İrsaliye olarak kaydet${ord.invoice_number ? `: ${ord.invoice_number}` : ""}`}
                                aria-label="Faturalaştır"
                                data-testid={`convert-inv-btn-${ord.order_number}`}
                              >
                                <FileText className="w-4 h-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={8} collisionPadding={24} className="z-[80] w-56 rounded-xl p-1.5 shadow-lg" data-testid={`draft-inv-chooser-${ord.order_number}`}>
                              <div className="px-2 py-1 text-[10px] font-bold text-amber-700 uppercase">Taslak belge</div>
                              <DropdownMenuItem
                                onSelect={() => handlePostDraftInvoice(ord)}
                                className="flex-col items-start gap-0 py-1.5"
                                data-testid={`inv-faturalastir-draft-${ord.order_number}`}
                              >
                                <span className="text-xs font-semibold text-slate-800">Faturalaştır</span>
                                <span className="text-[10px] text-slate-400">Cari bakiyesi + stok işlenir</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => makeDispatch(ord)}
                                className="flex-col items-start gap-0 py-1.5"
                                data-testid={`inv-save-dispatch-${ord.order_number}`}
                              >
                                <span className="text-xs font-semibold text-slate-800">
                                  {ord.dispatch_number ? `İrsaliye: ${ord.dispatch_number}` : "İrsaliye olarak kaydet"}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {ord.dispatch_number ? "Bu siparişin irsaliyesi var" : "Sevk irsaliyesi · cari fatura değil"}
                                </span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                            );
                          }
                          return (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm"
                                title="Fatura işlemleri"
                                aria-label="Fatura işlemleri"
                                data-testid={`convert-inv-btn-${ord.order_number}`}
                              >
                                <FileText className="w-4 h-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={8} collisionPadding={24} className="z-[80] w-56 rounded-xl p-1.5 shadow-lg" data-testid={`inv-type-chooser-${ord.order_number}`}>
                              <div className="px-2 py-1 text-[10px] font-bold text-emerald-700 uppercase">Fatura işlemleri</div>
                              <DropdownMenuItem
                                onSelect={() => handleFaturalastir(ord)}
                                className="flex-col items-start gap-0 py-1.5"
                                data-testid={`inv-faturalastir-${ord.order_number}`}
                              >
                                <span className="text-xs font-semibold text-slate-800">Faturalaştır</span>
                                <span className="text-[10px] text-slate-400">Cariye işle · yeşil Faturalaştı</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => makeDispatch(ord)}
                                className="flex-col items-start gap-0 py-1.5"
                                data-testid={`inv-save-dispatch-${ord.order_number}`}
                              >
                                <span className="text-xs font-semibold text-slate-800">
                                  {ord.dispatch_number ? `İrsaliye: ${ord.dispatch_number}` : "İrsaliye olarak kaydet"}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {ord.dispatch_number ? "Bu siparişin irsaliyesi var" : "e-İrsaliye taslağı · fatura değil"}
                                </span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => handleConvertToInvoice(ord.id || ord._id, "paper")}
                                className="flex-col items-start gap-0 py-1.5"
                                data-testid={`inv-type-paper-${ord.order_number}`}
                              >
                                <span className="text-xs font-semibold text-slate-800">Kağıt Fatura</span>
                                <span className="text-[10px] text-slate-400">Matbu taslak · GİB&apos;e gitmez</span>
                              </DropdownMenuItem>
                              {ord.order_status === "pending" && (
                                <DropdownMenuItem onSelect={() => setApproveOrder(ord)} className="border-t mt-1 rounded-lg font-semibold text-emerald-700" data-testid={`inv-chooser-approve-${ord.order_number}`}>
                                  Önce Onayla + Kargo
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          );
                        })()}

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
                        ) : showCargoLabel ? (
                          <button
                            type="button"
                            onClick={() => printOrderCargoLabel(ord)}
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
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openPrintOrder(ord)}
                          className={printOrderButtonClass(ord)}
                          title={printOrderTitle(ord)}
                          aria-label={printOrderTitle(ord)}
                          data-testid={`print-order-btn-${ord.order_number}`}
                          data-printed={ord.form_printed_at ? "1" : "0"}
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <OrderProduceButton ord={ord} catalog={productCatalog} onProduce={openProduceForOrder} busy={produceBusyId === (ord.id || ord._id)} />
                        {showMoreActions ? (
                          <OrderMoreMenuButton
                            ord={ord}
                            contacts={contacts}
                            onAction={handleOrderMoreAction}
                            canDelete={canDeleteOrder}
                          />
                        ) : null}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {ordersHasMore && (
          <div ref={ordersSentinelRef} className="py-3 text-center text-[11px] text-slate-400" data-testid="orders-load-more">
            Daha fazla sipariş yükleniyor…
          </div>
        )}
      </>) : null}
    </div>
  );
}

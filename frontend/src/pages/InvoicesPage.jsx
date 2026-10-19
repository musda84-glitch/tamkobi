import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { ScanButton } from "../components/CameraScanner";
import { toast } from "sonner";
import { InvoiceContextMenu, isIncomingPurchaseInvoice, isIncomingPurchasePending, incomingPurchaseResponse, incomingPurchaseLedgerPosted, isGibIssued, canDeleteInvoice, canCancelInvoice, canEditInvoice, canIssueInvoice, canFaturalastirDraftInvoice, canRunInvoiceIssueFlow, refreshInvoiceGibStatus, invoiceETypeLabel, displayInvoiceNumber, formatGibStatusLabel, canMatchIncomingProducts, unmatchedIncomingLineCount, invoiceDeleteConfirmMessage, invoicesBulkDeleteConfirmMessage } from "../components/InvoiceContextMenu";
import { COMMERCIAL_BADGE_CLASS, incomingCommercialStatusLabel } from "../utils/edocInbox";
import { DraftInvoiceFaturalastirButton } from "../components/DraftInvoiceFaturalastirButton";
import { IncomingInvoiceFaturalastirButton } from "../components/IncomingInvoiceFaturalastirButton";
import { InvoiceCopyButton, useInvoiceCopyFromContext } from "../components/InvoiceCopyMenu";
import { invoiceToOpenAfterCopy } from "../components/invoiceCopyModes";
import { InstallmentPlanModal } from "../components/InstallmentPlanModal";
import { PaymentTargetSelect, splitPaymentTarget } from "../components/PaymentTargetSelect";
import { GibContactLookup } from "../components/GibContactLookup";
import { BarcodeRenderer } from "../components/BarcodeRenderer";
import { QuickMessageModal, TEMPLATES } from "../components/QuickMessageModal";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PrintDocument, PrintTemplateEditor, shouldUseIntegratorPdf } from "../components/PrintDocument";
import { ExpenseSlipPrint } from "../components/ExpenseSlipPrint";
import { SearchSelect } from "../components/SearchSelect";
import { ContactSearchSelect } from "../components/ContactSearchSelect";
import { DocumentLineEditor } from "../components/DocumentLineEditor";
import { DocumentFormModal } from "../components/DocumentFormModal";
import { MoneyInput } from "../components/MoneyInput";
import { AiInvoiceImportModal } from "../components/AiInvoiceImportModal";
import { InvoiceToolbar, applyInvoiceFilters, DEFAULT_FILTERS, toggleInvoiceSort, invoiceSortCol, invoiceSortDir } from "../components/InvoiceToolbar";
import InvoiceActionPanel from "../components/InvoiceActionPanel";
import { ElektronikFaturaOnayModal } from "../components/ElektronikFaturaOnayModal";
import { BulkEInvoiceConfirmModal } from "../components/BulkEInvoiceConfirmModal";
import { SourceBadge } from "../components/SourceBadge";
import { QuickContactForm } from "../components/QuickContactForm";
import { INVOICE_ACTIONS_COL } from "../utils/invoiceTableLayout";
import {
  invoiceBulkNeedsSelection,
  bulkApiErrorDetail,
  bulkApiErrorDetailAsync,
  invoiceBulkRefreshGate,
  runInvoiceRefreshBulk,
  runInvoiceXmlBulk,
  fetchInvoiceXmlResponse,
  invoiceXmlFileName,
  triggerBrowserDownload,
  classifyInvoiceDateBulk,
  runInvoiceDateBulk,
  runInvoiceDeleteBulk,
  invoiceCancelConfirmText,
  classifyInvoiceLinkRecipients,
  sendInvoiceShareLink,
  invoiceBulkApproveSkipReason,
  runInvoiceBulkItems,
} from "../utils/invoiceBulkActions";
import { isCancelledInvoice, isApprovingInvoice, APPROVING_INVOICE_BADGE, invoiceRowActionsDisabled } from "../utils/invoiceStatus";
import { BulkResultModal } from "../components/BulkResultModal";
import { BulkInvoiceDateModal } from "../components/BulkInvoiceDateModal";
import { BulkInvoiceLinkConfirmModal } from "../components/BulkInvoiceLinkConfirmModal";
import { nowIssueDateTime } from "../utils/invoiceIssueNow";
import { contactMukellefPatch } from "../utils/gibMukellef";
import { shouldAskBulkEInvoiceDate, todayYmd } from "../utils/orderBulkActions";
import { FxPicker } from "../components/FxPicker";
import { TimeInput } from "../components/TimeInput";
import { fmtDate, fmtMoney, formatTrAmount } from "../utils/money";
import { computeLine, emptyLine, hydrateLine, invoiceMoneyTotals, lineFromProduct, variantUnitPrice } from "../utils/documentLines";
import { cachedList, invoiceTypeFilter } from "../utils/dataSync";
import { invoicesServerPagingEnabled } from "../utils/featureFlags";
import { WITHHOLDING_OPTIONS } from "../utils/invoiceWithholding";
import { useInfiniteRows } from "../hooks/useInfiniteRows";
import { useInvoiceLineExpand } from "../hooks/useInvoiceLineExpand";
import { InvoiceLinesTable } from "../components/InvoiceLinesTable";
import { useEinvoiceIntegrator } from "../hooks/useEinvoiceIntegrator";
import { InvoiceGibBar } from "../components/InvoiceGibBar";
import { isEinvoiceConfigured, supportsEDispatch } from "../utils/einvoiceIntegrator";
import { einvoiceInboxSyncParams } from "../utils/einvoiceInboxPull";
import { findRetailContact, invoiceFormPatchForRetail, retailContactCreatePayload } from "../utils/barcodeSale";
import { isSameScanLine, resolveScanMatch } from "../utils/variantScan";
import { paymentAskMessage, shouldAskPaymentAfterSave } from "../utils/invoiceAskPayment";
import { DespatchSendDialog } from "../components/DespatchSendDialog";
import { canSendOutgoingDispatch, despatchSendLabel, isIncomingDispatch } from "../utils/despatchShipment";
import { selectedOutgoingDispatchIds } from "../utils/dispatchMerge";

import {
  FileText,
  Plus,
  Eye,
  CheckCircle2,
  Clock,
  Printer,
  Download,
  Filter,
  X,
  CreditCard,
  Building2,
  Store,
  Sparkles,
  QrCode,
  MoreVertical,
  MousePointerClick,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronDown,
  CircleHelp,
  FileCheck2, XCircle, Trash2, Pencil, CalendarClock, Truck, RefreshCw, PackagePlus, Loader2 } from "lucide-react";
import { notifyDataChanged, useDataRefresh } from "../utils/dataRefresh";
import { activeCompanyId } from "../utils/activeCompanyId";
import NoCompanyNotice from "../components/NoCompanyNotice";

const typeBadge = (inv) => {
  if (inv.e_type === "expense_slip") return ["Gider Pusulası", "bg-rose-50 text-rose-800"];
  if (inv._is_quote) return ["Teklif", "bg-indigo-50 text-indigo-700"];
  if (inv.trade_kind === "export" || inv.e_type === "e_export") return ["İhracat", "bg-sky-50 text-sky-800"];
  if (inv.trade_kind === "import") return ["İthalat", "bg-teal-50 text-teal-800"];
  if (inv.invoice_type === "proforma") return ["Proforma", "bg-violet-50 text-violet-700"];
  if (inv.invoice_type === "return") return ["İade", "bg-rose-50 text-rose-700"];
  if (inv.invoice_type === "sales") return ["Satış", "bg-blue-50 text-blue-700"];
  if (inv.invoice_type === "dispatch") return ["İrsaliye", "bg-fuchsia-50 text-fuchsia-700"];
  return ["Alış", "bg-amber-50 text-amber-700"];
};

/** Teklif kaydını fatura listesi satırına map'ler (Proforma & Teklif sekmesi). */
const quoteAsInvoiceRow = (q) => ({
  id: q.id || q._id,
  _is_quote: true,
  invoice_number: q.quote_number || q.number || "—",
  invoice_type: "quote",
  e_type: "quote",
  contact_id: q.contact_id,
  contact_name: q.contact_name,
  contact_tax_id: q.contact_tax_id,
  issue_date: q.issue_date || (q.created_at || "").slice(0, 10),
  due_date: q.valid_until || null,
  grand_total: q.grand_total,
  local_total: q.grand_total,
  currency: q.currency || "TRY",
  status: q.status || "draft",
  gib_status: q.status === "accepted" || q.approval?.status === "accepted" ? "Kabul" : q.status === "rejected" ? "Red" : q.status === "sent" ? "Gönderildi" : "Taslak",
  payment_status: q.invoice_id ? "paid" : "unpaid",
  source_channel: "quote",
  title: q.title,
  invoice_id: q.invoice_id,
  project_id: q.project_id,
});

const SERVER_INVOICE_TABS = new Set(["all", "sales", "purchase", "incoming", "outgoing_gib", "export", "import"]);
const EMPTY_INVOICE_ROWS = [];
const INVOICE_SERVER_PAGE_SIZE = 50;
const INVOICE_EXPORT_PAGE_SIZE = 200;

function invoiceServerParams({ companyId, filterType, contactFilter, filters, showCancelled, page, pageSize }) {
  const params = {
    company_id: companyId,
    tab: filterType,
    pay: filters?.pay || "all",
    etype: filters?.etype || "all",
    sort: filters?.sort || "date_desc",
    show_cancelled: showCancelled ? 1 : 0,
    page,
    page_size: pageSize,
  };
  if (contactFilter) params.contact_id = contactFilter;
  const q = String(filters?.q || "").trim();
  if (q) params.q = q;
  if (filters?.from) params.from = filters.from;
  if (filters?.to) params.to = filters.to;
  if (filters?.min) params.min = filters.min;
  if (filters?.max) params.max = filters.max;
  return params;
}

const moneyTry = (n) => formatTrAmount((Number(n) || 0));
const buyPrice = (p, invoiceType) => (invoiceType === "sales" ? p.sale_price : (p.last_purchase_price || p.purchase_price));
const purchaseCostText = (p) => {
  const hist = p?.purchase_costs || [];
  const kart = Number(p?.purchase_price || 0);
  const last = p?.last_purchase_price;
  if (!hist.length && !kart) return "Alış kaydı yok";
  const bits = [];
  if (kart) bits.push(`kart ${moneyTry(kart)}`);
  if (last != null) {
    const d = p.last_purchase_date ? String(p.last_purchase_date).slice(0, 10) : "";
    const dm = d.length === 10 ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : "";
    const who = p.last_purchase_supplier ? ` ${p.last_purchase_supplier}` : "";
    bits.push(`son ${moneyTry(last)}${dm ? ` (${dm}${who})` : who}`);
  }
  return `Alış ${bits.join(" · ")}`;
};

export default function InvoicesPage({ initialType = "all", lockType = false }) {
  const { activeCompany, addonOn, can } = useAuth();
  const canDeleteInv = can("/invoices", "delete");
  const canIssueInv = can("/invoices", "edit");
  const companyId = activeCompanyId(activeCompany);
  const {
    settings: einvoiceSettings,
    loading: einvoiceLoading,
  } = useEinvoiceIntegrator(activeCompany?.id || activeCompany?._id || "");
  const [invoices, setInvoices] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [products, setProducts] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [filterType, setFilterType] = useState(initialType);
  const [showCancelled, setShowCancelled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gibBusy, setGibBusy] = useState("");

  // Modals
  const [showNewModal, setShowNewModal] = useState(false);
  const [showAiImport, setShowAiImport] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [serverSummary, setServerSummary] = useState(null);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedAllFiltered, setSelectedAllFiltered] = useState(false);
  const pageRef = useRef(1);
  const listReq = useRef(0);
  const selectReq = useRef(0);
  const listResetKeyRef = useRef("");
  const loadingMore = useRef(false);
  const serverAbortRef = useRef(null);
  const serverSentinelRef = useRef(null);
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const contactFilter = searchParams.get("contact_id") || "";
  const dispatchView = filterType === "dispatch";
  const dispatchDir = searchParams.get("dir") === "in" ? "in" : "out";
  const setDispatchDir = (dir) => {
    const next = new URLSearchParams(searchParams);
    next.set("dir", dir === "in" ? "in" : "out");
    setSearchParams(next, { replace: true });
  };
  const serverPaging = invoicesServerPagingEnabled() && SERVER_INVOICE_TABS.has(filterType);
  const filteredInvoices = useMemo(
    () => (serverPaging
      ? invoices
      : applyInvoiceFilters(
        invoices.filter((inv) => !contactFilter || inv.contact_id === contactFilter),
        { ...filters, showCancelled },
      )),
    [serverPaging, invoices, contactFilter, filters, showCancelled],
  );
  const incomingDispatches = useMemo(
    () => (dispatchView ? filteredInvoices.filter((inv) => isIncomingDispatch(inv)) : []),
    [dispatchView, filteredInvoices],
  );
  const outgoingDispatches = useMemo(
    () => (dispatchView ? filteredInvoices.filter((inv) => !isIncomingDispatch(inv)) : []),
    [dispatchView, filteredInvoices],
  );
  const visibleInvoices = dispatchView
    ? (dispatchDir === "in" ? incomingDispatches : outgoingDispatches)
    : filteredInvoices;
  const clientTotal = useMemo(() => visibleInvoices.reduce((t, i) => t + (Number(i.local_total || ((i.currency || "TRY") === "TRY" ? i.grand_total : 0)) || Number(i.grand_total) || 0), 0), [visibleInvoices]);
  const visibleTotal = serverPaging ? Number(serverSummary?.total_amount || 0) : clientTotal;
  const resultCount = serverPaging ? Number(serverSummary?.count ?? serverTotal ?? 0) : visibleInvoices.length;
  const listResetKey = useMemo(() => `${filterType}|${dispatchDir}|${contactFilter || ""}|${showCancelled ? 1 : 0}|${JSON.stringify(filters)}`, [filterType, dispatchDir, contactFilter, showCancelled, filters]);
  listResetKeyRef.current = listResetKey;
  const { visible: pagedInvoices, hasMore: invoicesHasMore, sentinelRef: invoicesSentinelRef } = useInfiniteRows(serverPaging ? EMPTY_INVOICE_ROWS : visibleInvoices, { resetKey: listResetKey });
  const tableInvoices = serverPaging ? invoices : pagedInvoices;

  const activeSortCol = invoiceSortCol(filters.sort);
  const activeSortDir = invoiceSortDir(filters.sort);
  const onHeaderSort = (col) => setFilters((s) => ({ ...s, sort: toggleInvoiceSort(s.sort, col) }));
  const SortTh = ({ col, children, className = "", title }) => {
    const active = activeSortCol === col;
    const right = className.includes("text-right");
    return (
      <th className={`px-4 py-3 ${className}`} title={title || "Sıralamak için tıkla"}>
        <button type="button" onClick={() => onHeaderSort(col)} className={`inline-flex items-center gap-1 uppercase font-semibold hover:text-slate-900 ${right ? "justify-end w-full" : ""} ${active ? "text-emerald-700" : "text-slate-500"}`} data-testid={`inv-col-sort-${col}`}>
          {children}
          {active ? (activeSortDir === "asc" ? <ArrowUp className="w-3 h-3 shrink-0" /> : <ArrowDown className="w-3 h-3 shrink-0" />) : <ArrowUpDown className="w-3 h-3 text-slate-300 shrink-0" />}
        </button>
      </th>
    );
  };

  const [printInv, setPrintInv] = useState(null);
  const [editTpl, setEditTpl] = useState(false);
  const [notifyInvoice, setNotifyInvoice] = useState(null);
  const [notifyFiles, setNotifyFiles] = useState([]);
  const [paymentModalInvoice, setPaymentModalInvoice] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [ctxMenu, setCtxMenu] = useState(null);
  /** null | { mode: 'send'|'print', invoice?, invoices? } */
  const [eFaturaJob, setEFaturaJob] = useState(null);
  const [despatchTarget, setDespatchTarget] = useState(null);
  const [bulkEInvoiceConfirm, setBulkEInvoiceConfirm] = useState(null);
  const [bulkEInvoiceBusy, setBulkEInvoiceBusy] = useState(false);
  const [bulkDateConfirm, setBulkDateConfirm] = useState(null);
  const [bulkLinkConfirm, setBulkLinkConfirm] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);
  const linkSendLockRef = useRef(false);
  const [selected, setSelected] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [installmentInv, setInstallmentInv] = useState(null);
  const {
    isOpen: invLinesOpen,
    toggle: toggleInvLines,
    itemsFor: itemsForInv,
    loadingId: expandLoadingId,
    setItems: setExpandedItems,
  } = useInvoiceLineExpand();
  const [lineMatchBusy, setLineMatchBusy] = useState("");
  const closeCtx = React.useCallback(() => setCtxMenu(null), []);
  const openCtxFromButton = (e, inv) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setCtxMenu({ x: Math.max(8, r.right - 256), y: r.bottom + 4, inv });
  };
  const invRowId = (inv) => inv?.id || inv?._id || inv?.invoice_number;
  const toggleSel = (id) => {
    setSelectedAllFiltered(false);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const selectedInvoices = () => visibleInvoices.filter((inv) => selected.includes(invRowId(inv)));
  const invoiceNeedsDetail = (inv) => serverPaging && inv && !inv._is_quote && !Array.isArray(inv.items);
  const presentInvoice = (inv, setter) => {
    if (!invoiceNeedsDetail(inv)) {
      setter(inv);
      return;
    }
    const id = inv.id || inv._id;
    if (!id) {
      setter(inv);
      return;
    }
    axios.get(`${API_URL}/invoices/${id}`).then((r) => setter(r.data || inv)).catch(() => setter(inv));
  };
  const resolveSelectedInvoiceDocs = async () => {
    if (!serverPaging) return selectedInvoices();
    const byId = new Map();
    for (const inv of invoices) {
      const id = invRowId(inv);
      if (id) byId.set(id, inv);
    }
    const missing = selected.filter((id) => id && !byId.has(id));
    if (missing.length) {
      const rows = await Promise.all(missing.map(async (id) => {
        try {
          const r = await axios.get(`${API_URL}/invoices/${id}`);
          return r.data;
        } catch {
          return null;
        }
      }));
      for (const row of rows) {
        if (!row) continue;
        const id = row.id || row._id;
        if (id) byId.set(id, row);
      }
    }
    return selected.map((id) => byId.get(id)).filter(Boolean);
  };
  const visibleSelIds = useMemo(
    () => visibleInvoices.map((inv) => invRowId(inv)).filter(Boolean),
    [visibleInvoices],
  );
  const allVisibleSelected = visibleSelIds.length > 0 && visibleSelIds.every((id) => selected.includes(id));
  const someVisibleSelected = visibleSelIds.some((id) => selected.includes(id));
  const allFilteredSelected = serverPaging && Number(serverSummary?.count) > 0 && selected.length === Number(serverSummary.count);
  const headerAllSelected = serverPaging ? (selectedAllFiltered || allFilteredSelected) : allVisibleSelected;
  const headerSomeSelected = serverPaging ? (selected.length > 0 && !headerAllSelected) : (someVisibleSelected && !allVisibleSelected);
  const toggleSelectAllVisible = () => {
    if (!serverPaging) {
      setSelected(allVisibleSelected ? [] : visibleSelIds);
      return;
    }
    if (headerAllSelected) {
      setSelectedAllFiltered(false);
      setSelected([]);
      return;
    }
    const gen = ++selectReq.current;
    const stamp = listResetKeyRef.current;
    const params = invoiceServerParams({
      companyId, filterType, contactFilter, filters, showCancelled, page: 1, pageSize: INVOICE_SERVER_PAGE_SIZE,
    });
    delete params.page;
    delete params.page_size;
    axios.get(`${API_URL}/invoices/page/ids`, { params })
      .then(({ data }) => {
        if (gen !== selectReq.current || stamp !== listResetKeyRef.current) return;
        const ids = Array.isArray(data?.ids) ? data.ids : [];
        setSelected(ids);
        setSelectedAllFiltered(true);
      })
      .catch((err) => {
        if (gen !== selectReq.current) return;
        const canceled = err?.code === "ERR_CANCELED" || err?.name === "CanceledError" || axios.isCancel?.(err);
        if (!canceled) toast.error("Faturalar seçilemedi.");
      });
  };
  const applyMatchedInvoice = (invId, invoice) => {
    if (!invoice) return;
    const items = Array.isArray(invoice.items) ? invoice.items : [];
    setExpandedItems(invId, items);
    setInvoices((prev) => prev.map((row) => {
      const rid = invRowId(row);
      if (rid !== invId) return row;
      return { ...row, ...invoice, id: invoice.id || invoice._id || row.id, items };
    }));
  };

  const reloadProducts = async () => {
    try {
      const r = await axios.get(`${API_URL}/products`, { params: { company_id: companyId } });
      setProducts(Array.isArray(r.data) ? r.data : r.data?.items || []);
    } catch { /* keep cache */ }
  };

  const matchIncomingLine = async (inv, idx, productId) => {
    const id = invRowId(inv);
    if (!id) return;
    setLineMatchBusy(`${id}:${idx}`);
    try {
      const r = await axios.put(`${API_URL}/invoices/${id}/items/match`, { idx, product_id: productId || null });
      applyMatchedInvoice(id, r.data?.invoice);
      toast.success(r.data?.message || "Satır eşleştirildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Eşleştirme başarısız.");
    } finally {
      setLineMatchBusy("");
    }
  };

  const createProductForIncomingLine = async (inv, idx) => {
    const id = invRowId(inv);
    if (!id) return;
    setLineMatchBusy(`${id}:create:${idx}`);
    try {
      const r = await axios.post(`${API_URL}/invoices/${id}/items/create-product`, { idx });
      applyMatchedInvoice(id, r.data?.invoice);
      toast.success(r.data?.message || "Stok kartı oluşturuldu.");
      await reloadProducts();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Stok kartı oluşturulamadı.");
    } finally {
      setLineMatchBusy("");
    }
  };

  const createMissingIncomingProducts = async (inv) => {
    const id = invRowId(inv);
    if (!id) return;
    const n = unmatchedIncomingLineCount(itemsForInv(inv));
    if (!n) {
      toast.message("Eşleşmeyen satır yok.");
      return;
    }
    if (!window.confirm(`${n} eşleşmeyen satır için stok kartı açılsın mı?`)) return;
    setLineMatchBusy(`${id}:create-all`);
    try {
      const r = await axios.post(`${API_URL}/invoices/${id}/items/create-missing-products`, {});
      applyMatchedInvoice(id, r.data?.invoice);
      toast.success(r.data?.message || "Stok kartları oluşturuldu.");
      await reloadProducts();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Toplu stok kartı açılamadı.");
    } finally {
      setLineMatchBusy("");
    }
  };
  const mergeOutgoingIds = selectedOutgoingDispatchIds(visibleInvoices, selected);
  const handleMergeDispatches = async () => {
    const ids = selectedOutgoingDispatchIds(visibleInvoices, selected);
    if (ids.length < 2) {
      toast.error("Birleştirmek için en az iki giden irsaliye seçin.");
      return;
    }
    if (!window.confirm(`${ids.length} giden irsaliye tek taslak satış faturasında birleştirilsin mi?`)) return;
    const key = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `merge-${Date.now()}`;
    setMergeBusy(true);
    try {
      const r = await axios.post(
        `${API_URL}/dispatches/merge-to-invoice`,
        { dispatch_ids: ids, idempotency_key: key },
        { headers: { "Idempotency-Key": key } },
      );
      toast.success(r.data?.message || "İrsaliyeler tek faturada birleştirildi.");
      setSelected([]);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İrsaliyeler birleştirilemedi.");
    } finally {
      setMergeBusy(false);
    }
  };
  const handleConvertDispatch = async (inv) => {
    const existingNo = inv.invoice_ref_number || inv.converted_invoice_number;
    const msg = existingNo
      ? `${inv.invoice_number} mevcut faturaya bağlansın mı? (${existingNo})`
      : `${inv.invoice_number} irsaliyesinden satış faturası oluşturulsun mu?\nSiparişte veya irsaliyede fatura varsa yeni fatura açılmaz, mevcut faturaya bağlanır.`;
    if (!window.confirm(msg)) return;
    try {
      const r = await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/convert-to-invoice`, {});
      toast[r.data.status === "linked" || r.data.status === "exists" ? "info" : "success"](r.data.message);
      loadData();
    } catch (err) { toast.error(err.response?.data?.detail || "Dönüştürülemedi."); }
  };
  const handleCreateDispatch = async (inv) => {
    try { const r = await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/create-dispatch`); toast[r.data.status === "exists" ? "info" : "success"](r.data.message); loadData(); }
    catch (err) { toast.error(err.response?.data?.detail || "İrsaliye oluşturulamadı."); }
  };
  const openPayment = (inv) => { setPaymentModalInvoice(inv); setPaymentAmount(inv.grand_total - (inv.paid_amount || 0)); };

  const pullGibIncoming = async () => {
    const cid = activeCompany?.id || activeCompany?._id;
    if (!cid) { toast.error("Firma seçin."); return; }
    setGibBusy("pull");
    try {
      const r = await axios.post(`${API_URL}/einvoice/incoming/sync`, null, {
        params: einvoiceInboxSyncParams(cid),
        timeout: 180000,
      });
      toast.success(r.data?.message || "Gelen GİB kutusu (son 30 gün) çekildi.");
      navigate("/edoc-inbox");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gelen kutu çekilemedi.");
    } finally {
      setGibBusy("");
    }
  };

  const filterOutgoingGib = () => {
    setFilterType("outgoing_gib");
    setFilters((s) => ({ ...s, etype: "all" }));
  };
  const filterIncomingGib = () => {
    setFilterType("incoming");
    setFilters((s) => ({ ...s, etype: "all" }));
  };
  const filterDispatchList = () => {
    setFilterType("dispatch");
    setFilters((s) => ({ ...s, etype: "all" }));
  };
  const openGibInbox = () => navigate("/edoc-inbox");
  const openIncomingDispatchInbox = () => navigate("/edoc-inbox?kind=dispatch");
  const refreshOutgoingGib = async () => {
    setGibBusy("refresh");
    try {
      await bulk("refresh");
    } finally {
      setGibBusy("");
    }
  };

  // New Invoice Form
  const [formData, setFormData] = useState(() => {
    const now = nowIssueDateTime();
    return {
    invoice_type: "sales",
    e_type: "paper",
    status: "draft",
    withholding_rate: 0,
    withholding_code: "",
    price_mode: "excl",
    contact_id: "",
    contact_name: "",
    contact_tax_id: "",
    contact_tax_office: "",
    issue_date: now.issue_date,
    issue_time: now.issue_time,
    due_date: new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
    items: [
      emptyLine()
    ],
    notes: "Teşekkür ederiz.",
    general_discount_rate: 0,
    general_discount_amount: 0,
    currency: "TRY",
    fx_rate: 1,
    fx_source: "try",
    trade_kind: "",
    incoterm: "",
    country: "",
    customs_office: "",
    project_id: "",
    regime_code: "",
    declaration_no: "",
    declaration_date: "",
    dab_no: "",
    bl_awb: "",
    certificate: "",
    trade_file_number: "",
  };
  });
  const [gdMode, setGdMode] = useState("percent");
  const [quickContact, setQuickContact] = useState(false);
  const [invoiceInfoOpen, setInvoiceInfoOpen] = useState(true);
  const [contactFieldsOpen, setContactFieldsOpen] = useState(false);
  const newParam = searchParams.get("new");
  const newContactParam = searchParams.get("contact_id");
  const newProjectParam = searchParams.get("project_id");
  const editParam = searchParams.get("edit") || searchParams.get("open");
  useEffect(() => {
    if (!newParam) return;
    if (newContactParam && contacts.length === 0) return;
    const c = contacts.find((x) => x.id === newContactParam);
    setFormData((fd) => ({
      ...fd,
      invoice_type: newParam === "purchase" ? "purchase" : "sales",
      e_type: newParam === "purchase" ? "paper" : "e_archive",
      contact_id: c?.id || fd.contact_id || "",
      contact_name: c?.name || fd.contact_name || "",
      contact_tax_id: c?.tax_number_or_id || fd.contact_tax_id || "",
      contact_tax_office: c?.tax_office || fd.contact_tax_office || "",
      shipping_address: c?.address || fd.shipping_address || "",
      city: c?.city || fd.city || "",
      customer_phone: c?.phone || fd.customer_phone || "",
      project_id: newProjectParam || fd.project_id || "",
    }));
    setShowNewModal(true);
    setSearchParams({}, { replace: true });
  }, [newParam, newContactParam, newProjectParam, contacts, setSearchParams]);

  const loadCatalog = useCallback(async () => {
    if (!companyId) return;
    try {
      const [cntRows, prodRows] = await Promise.all([
        cachedList("contacts", companyId, { onCached: setContacts }),
        cachedList("products", companyId, { onCached: setProducts }),
      ]);
      setContacts(cntRows || []);
      setProducts(prodRows || []);
    } catch { /* form kataloğu */ }
  }, [companyId]);
  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!companyId) {
      if (!silent) setLoading(false);
      return;
    }
    if (invoicesServerPagingEnabled() && SERVER_INVOICE_TABS.has(filterType)) {
      setReloadTick((n) => n + 1);
      return;
    }
    try {
      if (!silent) setLoading(true);
      const cid = companyId;
      const [invRows, cntRows, prodRows, quoteRes] = await Promise.all([
        cachedList("invoices", cid, {
          filter: invoiceTypeFilter(filterType),
          // Proforma sekmesinde tekliflerle birleştiriyoruz; onCached yalnızca faturaları basmasın.
          onCached: filterType === "proforma" ? undefined : setInvoices,
        }),
        cachedList("contacts", cid, { onCached: setContacts }),
        cachedList("products", cid, { onCached: setProducts }),
        filterType === "proforma"
          ? axios.get(`${API_URL}/quotes`, { params: { company_id: cid, summary: 1 } }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
      ]);
      const quoteRows = filterType === "proforma" ? (quoteRes.data || []).map(quoteAsInvoiceRow) : [];
      setInvoices([...quoteRows, ...(invRows || [])]);
      setContacts(cntRows);
      setProducts(prodRows);
    } catch (err) {
      toast.error("Veriler yüklenirken hata oluştu.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [companyId, filterType]);
  useEffect(() => {
    if (serverPaging) return;
    loadData();
  }, [loadData, serverPaging]);
  useEffect(() => {
    if (!serverPaging) return;
    loadCatalog();
  }, [serverPaging, loadCatalog]);
  useEffect(() => {
    if (!serverPaging) return undefined;
    if (!companyId) {
      setLoading(false);
      return undefined;
    }
    const gen = ++listReq.current;
    pageRef.current = 1;
    loadingMore.current = false;
    if (serverAbortRef.current) serverAbortRef.current.abort();
    const ctrl = new AbortController();
    serverAbortRef.current = ctrl;
    let alive = true;
    setLoading(true);
    const params = invoiceServerParams({
      companyId, filterType, contactFilter, filters, showCancelled,
      page: 1, pageSize: INVOICE_SERVER_PAGE_SIZE,
    });
    axios.get(`${API_URL}/invoices/page`, { params, signal: ctrl.signal })
      .then(({ data }) => {
        if (!alive || gen !== listReq.current) return;
        setInvoices(Array.isArray(data?.items) ? data.items : []);
        setServerSummary(data?.summary || null);
        setServerTotal(Number(data?.total) || 0);
        setServerHasMore(!!data?.has_more);
      })
      .catch((err) => {
        if (!alive || gen !== listReq.current) return;
        const canceled = err?.code === "ERR_CANCELED" || err?.name === "CanceledError" || axios.isCancel?.(err);
        if (!canceled) toast.error("Faturalar yüklenemedi.");
      })
      .finally(() => {
        if (alive && gen === listReq.current) setLoading(false);
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [serverPaging, companyId, filterType, contactFilter, filters, showCancelled, reloadTick]);
  const loadMoreServerInvoices = useCallback(() => {
    if (!serverPaging || !serverHasMore || loadingMore.current) return;
    const next = pageRef.current + 1;
    pageRef.current = next;
    const gen = ++listReq.current;
    loadingMore.current = true;
    if (serverAbortRef.current) serverAbortRef.current.abort();
    const ctrl = new AbortController();
    serverAbortRef.current = ctrl;
    const params = invoiceServerParams({
      companyId, filterType, contactFilter, filters, showCancelled,
      page: next, pageSize: INVOICE_SERVER_PAGE_SIZE,
    });
    axios.get(`${API_URL}/invoices/page`, { params, signal: ctrl.signal })
      .then(({ data }) => {
        if (gen !== listReq.current) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setInvoices((prev) => {
          const seen = new Set(prev.map((inv) => inv.id || inv._id || inv.invoice_number));
          return prev.concat(items.filter((inv) => !seen.has(inv.id || inv._id || inv.invoice_number)));
        });
        setServerSummary(data?.summary || null);
        setServerTotal(Number(data?.total) || 0);
        setServerHasMore(!!data?.has_more);
      })
      .catch((err) => {
        if (gen !== listReq.current) return;
        pageRef.current = Math.max(1, next - 1);
        const canceled = err?.code === "ERR_CANCELED" || err?.name === "CanceledError" || axios.isCancel?.(err);
        if (!canceled) toast.error("Faturalar yüklenemedi.");
      })
      .finally(() => {
        if (gen === listReq.current) loadingMore.current = false;
      });
  }, [serverPaging, serverHasMore, companyId, filterType, contactFilter, filters, showCancelled]);
  useEffect(() => {
    if (!serverPaging) return undefined;
    const el = serverSentinelRef.current;
    if (!el || !serverHasMore || loading) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      loadMoreServerInvoices();
    }, { root: null, rootMargin: "240px 0px", threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [serverPaging, serverHasMore, loading, invoices.length, loadMoreServerInvoices]);
  const loadExportRows = useCallback(async () => {
    const all = [];
    let pageNo = 1;
    let more = true;
    while (more && pageNo <= 500) {
      const params = invoiceServerParams({
        companyId, filterType, contactFilter, filters, showCancelled,
        page: pageNo, pageSize: INVOICE_EXPORT_PAGE_SIZE,
      });
      const { data } = await axios.get(`${API_URL}/invoices/page`, { params });
      const items = Array.isArray(data?.items) ? data.items : [];
      all.push(...items);
      more = !!data?.has_more && items.length > 0;
      pageNo += 1;
    }
    return all;
  }, [companyId, filterType, contactFilter, filters, showCancelled]);
  useEffect(() => { setSelected([]); setSelectedAllFiltered(false); }, [listResetKey]);
  useEffect(() => {
    if (!companyId) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/projects?company_id=${companyId}`)
      .then((r) => { if (!cancelled) setProjects(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setProjects([]); });
    return () => { cancelled = true; };
  }, [companyId]);
  const loadedAccountsFor = useRef("");
  useEffect(() => {
    if (loadedAccountsFor.current && loadedAccountsFor.current !== companyId) {
      loadedAccountsFor.current = "";
      setBankAccounts([]);
      setPaymentAccount("");
    }
  }, [companyId]);
  useEffect(() => {
    if (!paymentModalInvoice) return undefined;
    if (loadedAccountsFor.current === companyId) return undefined;
    let cancelled = false;
    const cid = companyId;
    axios.get(`${API_URL}/banking/accounts?company_id=${cid}`)
      .then((r) => {
        if (cancelled) return;
        const rows = Array.isArray(r.data) ? r.data : [];
        loadedAccountsFor.current = cid;
        setBankAccounts(rows);
        setPaymentAccount((prev) => {
          if (prev && rows.some((a) => (a.id || a._id) === prev)) return prev;
          return rows[0] ? (rows[0].id || rows[0]._id || "") : "";
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [paymentModalInvoice, companyId]);
  const refreshInvoicesSilent = useCallback(() => loadData({ silent: true }), [loadData]);
  useDataRefresh(refreshInvoicesSilent, { companyId, scopes: ["invoices", "contacts"] });

  const handleScanAddItem = (code) => {
    const c = String(code || "").trim();
    const match = resolveScanMatch(products, c);
    if (!match) { toast.error(`Barkod eşleşmedi: ${c}`); return; }
    const prod = match.product;
    const v = match.variant;
    const pid = prod.id || prod._id;
    const label = v ? `${prod.name} - ${v.name}` : prod.name;
    const existing = formData.items.findIndex((it) => isSameScanLine(it, pid, v));
    if (existing >= 0) {
      const items = formData.items.map((it, i) => (i === existing ? computeLine({ ...it, quantity: Number(it.quantity || 0) + 1 }, "quantity") : it));
      setFormData({ ...formData, items });
      toast.success(`${label} miktarı +1`);
      return;
    }
    const emptyIdx = formData.items.findIndex((it) => !it.product_id && !it.name && !it.product_name);
    const price = variantUnitPrice(v, formData.invoice_type, buyPrice(prod, formData.invoice_type));
    const priceIncl = formData.invoice_type !== "purchase" && !!prod.price_includes_vat;
    const line = computeLine({
      ...lineFromProduct(prod, { invoiceType: formData.invoice_type }),
      name: label,
      product_name: label,
      unit_price: priceIncl ? 0 : price,
      unit_price_incl: priceIncl ? price : 0,
      sku: v?.sku || prod.sku || "",
      barcode: v?.barcode || prod.barcode || "",
      vat_rate: formData.trade_kind === "export" || formData.e_type === "e_export" ? 0 : (prod.vat_rate || 20),
    }, priceIncl ? "unit_price_incl" : "unit_price");
    if (emptyIdx >= 0) {
      setFormData({ ...formData, items: formData.items.map((it, i) => (i === emptyIdx ? line : it)) });
    } else {
      setFormData((f) => ({ ...f, items: [...f.items, line] }));
    }
    toast.success(`${label} eklendi`);
  };

  const WITHHOLDING = WITHHOLDING_OPTIONS;
  const calculateTotals = () => invoiceMoneyTotals(formData.items, {
    generalDiscountRate: formData.general_discount_rate,
    generalDiscountAmount: formData.general_discount_amount,
    discountMode: gdMode,
    withholdingRate: formData.withholding_rate,
  });

  const [editingInvoice, setEditingInvoice] = useState(null);
  const openEditInvoice = useCallback((inv) => {
    const apply = (source) => {
      if (!source) return;
      setEditingInvoice(source);
      setGdMode(source.general_discount_rate ? "percent" : "amount");
      setFormData((fd) => ({
        ...fd,
        invoice_type: source.invoice_type || "sales",
        e_type: source.e_type || "paper",
        status: "draft",
        contact_id: source.contact_id || "",
        contact_name: source.contact_name || "",
        contact_tax_id: source.contact_tax_id || "",
        contact_tax_office: source.contact_tax_office || "",
        shipping_address: source.shipping_address || source.address || "",
        city: source.city || "",
        customer_phone: source.customer_phone || "",
        issue_date: (source.issue_date || "").slice(0, 10),
        issue_time: (source.issue_time || "").slice(0, 8) || nowIssueDateTime().issue_time,
        due_date: (source.due_date || "").slice(0, 10),
        notes: source.notes || "",
        withholding_rate: source.withholding_rate || 0,
        withholding_code: source.withholding_code || "",
        price_mode: source.price_mode || "excl",
        general_discount_rate: source.general_discount_rate || 0,
        general_discount_amount: source.general_discount_amount || 0,
        currency: source.currency || "TRY",
        fx_rate: source.fx_rate || 1,
        fx_source: source.fx_source || "try",
        trade_kind: source.trade_kind || "",
        incoterm: source.incoterm || "",
        country: source.country || "",
        customs_office: source.customs_office || "",
        project_id: source.project_id || "",
        regime_code: source.regime_code || "",
        declaration_no: source.declaration_no || "",
        declaration_date: source.declaration_date || "",
        dab_no: source.dab_no || "",
        bl_awb: source.bl_awb || "",
        certificate: source.certificate || "",
        trade_file_number: source.trade_file_number || "",
        items: (source.items || []).map((it) => hydrateLine({ ...it, is_service: it.is_service || !it.product_id })),
      }));
      setShowNewModal(true);
    };
    const needsDetail = serverPaging && inv && !inv._is_quote && !Array.isArray(inv.items);
    if (needsDetail) {
      const id = inv.id || inv._id;
      if (id) {
        axios.get(`${API_URL}/invoices/${id}`).then((r) => apply(r.data || inv)).catch(() => apply(inv));
        return;
      }
    }
    apply(inv);
  }, [serverPaging]);

  const onInvoiceCopied = useCallback((result) => {
    loadData();
    if (result?.kind === "purchase_order") {
      navigate("/purchase-orders");
      return;
    }
    // Kopya taslağı formu doldur (cari dahil); yalnızca modal açmak cariyi boş bırakır.
    const inv = invoiceToOpenAfterCopy(result);
    if (inv) openEditInvoice(inv);
  }, [loadData, navigate, openEditInvoice]);
  const invoiceCopy = useInvoiceCopyFromContext({
    contacts,
    companyId,
    onCopied: onInvoiceCopied,
  });

  useEffect(() => {
    if (!editParam) return undefined;
    let cancelled = false;
    const openFromId = async () => {
      try {
        let inv = invoices.find((x) => x.id === editParam || x._id === editParam);
        if (!inv) {
          const r = await axios.get(`${API_URL}/invoices/${editParam}`);
          inv = r.data;
        }
        if (cancelled || !inv) return;
        openEditInvoice(inv);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete("edit");
          next.delete("open");
          return next;
        }, { replace: true });
      } catch (err) {
        if (!cancelled) toast.error(err?.response?.status === 404 ? "Kayıt bulunamadı" : "Taslak fatura açılamadı.");
      }
    };
    openFromId();
    return () => { cancelled = true; };
    // One-shot deep link from teklif → fatura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam]);

  const handleApproveDraft = async (inv) => {
    if (!inv) return;
    const no = inv.invoice_number || "Belge";
    if (!window.confirm(`${no} taslak faturası onaylansın mı?\nCari bakiyesi ve stok işlenecek. E-belge gönderimi ayrı adımdır.`)) return;
    try {
      const res = await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/approve`);
      toast.success(res.data.message || "Faturalaştı — cari bakiyesi işlendi.");
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Faturalaştırılamadı.");
    }
  };
  const handleDeleteInvoice = async (inv) => {
    if (!window.confirm(invoiceDeleteConfirmMessage(inv))) return;
    try { const r = await axios.delete(`${API_URL}/invoices/${inv.id}`); toast.success(r.data.message); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
  };
  const handleCancelInvoice = async (inv) => {
    const isDisp = inv.invoice_type === "dispatch" || inv.e_type === "e_dispatch";
    if (!window.confirm(invoiceCancelConfirmText({
      invoices: [inv],
      gibSentCount: isGibIssued(inv) ? 1 : 0,
      isDispatch: isDisp,
    }))) return;
    try {
      const r = await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/cancel`, {});
      toast.success(r.data.message || "Fatura iptal edildi.");
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İptal edilemedi.");
    }
  };
  const handleExpenseSlip = async (inv) => {
    if (!window.confirm(`${inv.invoice_number} için gider pusulası kesilsin mi?\nAynı cari ve kalemlerle alış pusulası oluşur.`)) return;
    try {
      const r = await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/expense-slip`);
      toast.success(r.data.message || "Gider pusulası kesildi.");
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gider pusulası kesilemedi.");
    }
  };
  const pickRetailContact = async () => {
    if (formData.invoice_type === "purchase") {
      toast.error("Perakende (carisiz) alış faturasında kullanılamaz.");
      return;
    }
    try {
      let contact = findRetailContact(contacts);
      if (!contact) {
        if (!companyId) { toast.error("Firma seçili değil"); return; }
        const company_id = companyId;
        const r = await axios.post(`${API_URL}/contacts`, retailContactCreatePayload(company_id));
        contact = r.data;
        setContacts((prev) => [contact, ...prev]);
      }
      setFormData((fd) => ({ ...fd, ...invoiceFormPatchForRetail(contact, fd) }));
      setContactFieldsOpen(false);
      toast.success("Perakende (carisiz) seçildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Perakende cari oluşturulamadı.");
    }
  };

  const askPaymentAfterSave = async (inv) => {
    if (!shouldAskPaymentAfterSave(inv)) return;
    if (!window.confirm(paymentAskMessage(inv))) return;
    let ready = inv;
    if (String(inv.status || "") === "draft") {
      try {
        await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/approve`);
        ready = { ...inv, status: "approved" };
        toast.success("Fatura onaylandı (cariye işlendi).");
      } catch (err) {
        toast.error(err.response?.data?.detail || "Onaylanamadı; ödeme açılamadı.");
        return;
      }
    }
    openPayment(ready);
  };

  const handleCreateInvoice = async (e) => {
    e.preventDefault();
    if (!formData.contact_id) {
      toast.error("Lütfen bir cari seçiniz veya Perakende (carisiz) kullanın.");
      return;
    }
    try {
      const t = calculateTotals();
      if (formData.items.some((it) => !(it.name || it.product_name))) { toast.error("Her satır için ürün seçin ya da hizmet adı yazın."); return; }
      const contactRow = contacts.find((x) => x.id === formData.contact_id || x._id === formData.contact_id);
      const ship = String(formData.shipping_address || contactRow?.address || "").trim();
      const city = String(formData.city || contactRow?.city || "").trim();
      const phone = String(formData.customer_phone || contactRow?.phone || "").trim();
      if (!companyId) { toast.error("Firma seçili değil"); return; }
      const payload = {
        company_id: companyId,
        ...formData,
        shipping_address: ship && ship !== "-" ? ship : (formData.shipping_address || null),
        city: city && city !== "-" ? city : (formData.city || null),
        customer_phone: phone || formData.customer_phone || null,
        items: formData.items.map((it) => {
          const line = computeLine(it);
          return { ...line, unit_price: Number(Number(line.unit_price).toFixed(4)), product_id: it.is_service ? "" : it.product_id };
        }),
        price_mode: "excl",
        withholding_rate: Number(formData.withholding_rate || 0),
        withholding_code: formData.withholding_code || null,
        general_discount_amount: t.gd,
        general_discount_rate: gdMode === "percent" ? Number(formData.general_discount_rate || 0) : 0,
        status: formData.invoice_type === "dispatch" ? "draft" : (formData.status || "draft"),
        gib_status: (formData.status || "draft") === "draft" ? "Taslak" : "Onaylandı"
      };
      let saved = null;
      if (editingInvoice) {
        const { company_id, invoice_type, gib_status, ...upd } = payload;
        const putRes = await axios.put(`${API_URL}/invoices/${editingInvoice.id}`, { ...upd, invoice_type });
        if (payload.status === "approved") await axios.post(`${API_URL}/invoices/${editingInvoice.id}/approve`);
        toast.success("Taslak fatura güncellendi.");
        saved = putRes?.data || {
          ...editingInvoice,
          ...upd,
          id: editingInvoice.id || editingInvoice._id,
          status: payload.status === "approved" ? "approved" : (editingInvoice.status || payload.status),
          grand_total: Number(putRes?.data?.grand_total ?? t.grandTotal ?? editingInvoice.grand_total ?? 0),
        };
        setEditingInvoice(null);
      } else {
        const res = await axios.post(`${API_URL}/invoices`, payload);
        saved = res.data;
        toast.success(payload.status === "draft" ? "Fatura taslak olarak kaydedildi." : "Fatura başarıyla oluşturuldu ve cariye işlendi.");
      }
      setShowNewModal(false);
      loadData();
      await askPaymentAfterSave(saved);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      let msg = "Fatura kaydedilemedi.";
      if (typeof detail === "string" && detail.trim()) msg = detail;
      else if (Array.isArray(detail) && detail.length) {
        msg = "Eksik alan: " + detail.map((d) => d?.loc?.slice(-1)?.[0] || d?.msg || "?").filter(Boolean).join(", ");
      } else if (err?.response?.status) {
        msg = `Fatura kaydedilemedi (HTTP ${err.response.status}).`;
      } else if (err?.message) {
        msg = `Fatura kaydedilemedi: ${err.message}`;
      }
      toast.error(msg);
    }
  };

  const handleSendToGib = async (invId, eType, opts = {}) => {
    try {
      const body = {};
      if (eType && eType !== "auto") body.e_type = eType;
      if (opts.scenario === "TEMEL" || opts.scenario === "TICARI") body.scenario = opts.scenario;
      if (opts.stampNow) {
        body.stamp_now = true;
        const stamp = opts.issueStamp || nowIssueDateTime();
        if (stamp.issue_date) body.issue_date = stamp.issue_date;
        if (stamp.issue_time) body.issue_time = stamp.issue_time;
      }
      const res = await axios.post(`${API_URL}/invoices/${invId}/send-to-gib`, body);
      if (!opts.silentToast) toast.success(res.data.message);
      const draftWarn = res.data?.warning || res.data?.dispatch_draft_warning;
      if (draftWarn && !opts.silentToast) toast.warning(draftWarn);
      // Portal/GİB fatura no + durumu gecikebilir — hemen bir kez daha çek.
      // Onay modalı zaten send içinde wait_for_gib poll eder; ekstra refresh süreyi uzatır.
      let refreshMsg = "";
      if (!opts.skipRefresh) {
        try {
          const st = await axios.post(`${API_URL}/e-invoice/${invId}/refresh-status`);
          if (st.data?.invoice_number) {
            refreshMsg = `GİB fatura no: ${st.data.invoice_number}`;
            if (!opts.silentToast) toast.message(refreshMsg);
          } else if (st.data?.gib_status) {
            refreshMsg = st.data.gib_status;
            if (!opts.silentToast) toast.message(refreshMsg);
          }
        } catch { /* liste yine yenilenecek */ }
      } else {
        refreshMsg = res.data?.gib_status || res.data?.message || "";
      }
      if (!opts.skipReload) loadData();
      return { message: res.data?.message || "Gönderildi", refreshMsg };
    } catch (err) {
      if (!opts.silentToast) toast.error(err.response?.data?.detail || "Fatura kesilemedi.");
      throw err;
    }
  };

  const openDespatchSend = (inv) => {
    if (!canSendOutgoingDispatch(inv)) return;
    closeCtx();
    setDespatchTarget(inv);
  };
  const submitDespatchSend = async (payload) => {
    const inv = despatchTarget;
    const id = inv?.id || inv?._id;
    if (!id) return;
    try {
      const res = await axios.post(`${API_URL}/invoices/${id}/send-to-gib`, payload);
      toast.success(res.data?.message || "e-İrsaliye gönderildi.");
      setDespatchTarget(null);
      setPreviewInvoice(null);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "e-İrsaliye gönderilemedi.");
    }
  };
  const handleIssueFromMenu = (inv, eType) => {
    if (eType === "e_dispatch" || inv?.invoice_type === "dispatch" || inv?.e_type === "e_dispatch") {
      openDespatchSend(inv);
      return;
    }
    // Siparişlerdeki gibi: GİB e-belge kesimi Elektronik Fatura Onayı modalından geçer.
    const openOnay = !eType || eType === "auto" || eType === "e_invoice" || eType === "e_archive";
    if (openOnay) {
      closeCtx();
      // Menü mousedown/unmount sonrası açılsın (sipariş dropdown ile aynı güvenli timing).
      window.setTimeout(() => setEFaturaJob({ mode: "send", invoice: inv }), 0);
      return;
    }
    return handleSendToGib(inv.id || inv._id, eType);
  };

  const openInvoicePdfsWithProgress = async (list, ctx) => {
    const docs = (list || []).filter((o) => o?.id || o?._id);
    if (!docs.length) throw new Error("Seçili faturalarda yazdırılacak belge yok.");
    ctx?.setSteps?.([
      { id: "prepare", label: "Belgeler hazırlanıyor" },
      { id: "print", label: "Yazdırma pencereleri açılıyor" },
      { id: "done", label: "Tamamlandı" },
    ]);
    ctx?.initItems?.(docs.map((d) => ({
      id: d.id || d._id,
      label: d.invoice_number || d.id,
      sublabel: d.contact_name || "",
    })));
    ctx?.setStep?.("prepare", "active");
    let ok = 0;
    let fail = 0;
    const capped = docs.slice(0, 12);
    ctx?.completeStep?.("prepare", `${docs.length} belge${docs.length > 12 ? " (ilk 12 yazdırılacak)" : ""}`);
    ctx?.setStep?.("print", "active");
    for (const inv of capped) {
      const id = inv.id || inv._id;
      ctx?.setItem?.(id, { status: "running", detail: "PDF açılıyor…" });
      try {
        const w = window.open(`${API_URL}/invoices/${id}/pdf`, "_blank", "noopener");
        if (!w) {
          fail++;
          ctx?.setItem?.(id, { status: "error", detail: "Açılır pencere engellendi" });
          continue;
        }
        ok++;
        ctx?.setItem?.(id, { status: "ok", detail: "Yazdırma penceresi açıldı" });
      } catch (err) {
        fail++;
        ctx?.setItem?.(id, { status: "error", detail: bulkApiErrorDetail(err) || "Açılamadı" });
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    for (const inv of docs.slice(12)) {
      const id = inv.id || inv._id;
      ctx?.setItem?.(id, { status: "skipped", detail: "İlk 12 limitine takıldı" });
    }
    ctx?.completeStep?.("print", `${ok} açıldı${fail ? `, ${fail} hata` : ""}`);
    ctx?.setStep?.("done", "done");
    return { ok, fail, skipped: Math.max(0, docs.length - capped.length) };
  };

  const openEFaturaSendJob = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return;
    setEFaturaJob({
      mode: "send",
      invoices: list,
      invoice: list.length === 1 ? list[0] : null,
    });
  };

  const confirmBulkEInvoiceDates = async ({ setDateToToday, invoices: list, docs }) => {
    const rows = Array.isArray(docs) && docs.length ? docs : (Array.isArray(list) ? list : []);
    if (!rows.length) {
      setBulkEInvoiceConfirm(null);
      return;
    }
    if (setDateToToday) {
      const today = todayYmd();
      setBulkEInvoiceBusy(true);
      const updated = [];
      try {
        for (const inv of rows) {
          const id = inv.id || inv._id;
          if (!id) {
            updated.push({ ...inv, issue_date: today, invoice_date: today });
            continue;
          }
          try {
            await axios.put(`${API_URL}/invoices/${id}`, { issue_date: today });
            updated.push({ ...inv, issue_date: today, invoice_date: today });
          } catch (err) {
            toast.error(bulkApiErrorDetail(err) || `${inv.invoice_number || id} tarihi güncellenemedi.`);
            updated.push(inv);
          }
        }
      } finally {
        setBulkEInvoiceBusy(false);
      }
      setBulkEInvoiceConfirm(null);
      openEFaturaSendJob(updated);
      return;
    }
    setBulkEInvoiceConfirm(null);
    openEFaturaSendJob(rows);
  };

  const downloadInvoiceXmlBulk = async (list) => {
    setBulkBusy(true);
    try {
      const items = await runInvoiceXmlBulk(list, {
        download: async (inv) => {
          const id = inv.id || inv._id;
          try {
            const r = await fetchInvoiceXmlResponse(axios, API_URL, id);
            triggerBrowserDownload(r.data, invoiceXmlFileName(inv));
          } catch (err) {
            const detail = await bulkApiErrorDetailAsync(err);
            const wrapped = new Error(detail || "Hata");
            wrapped.response = err?.response;
            throw wrapped;
          }
        },
      });
      setBulkResult({ title: "XML indirme sonucu", items });
    } finally {
      setBulkBusy(false);
    }
  };

  const confirmBulkInvoiceDate = async (date) => {
    if (!bulkDateConfirm) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("Tarih YYYY-AA-GG olmalı.");
      return;
    }
    setBulkBusy(true);
    try {
      const items = await runInvoiceDateBulk(bulkDateConfirm.list || [], {
        date,
        put: (inv, issueDate) => axios.put(`${API_URL}/invoices/${inv.id || inv._id}`, { issue_date: issueDate }),
      });
      setBulkDateConfirm(null);
      setBulkResult({ title: "Toplu fatura tarihi", items });
      loadData();
    } finally {
      setBulkBusy(false);
    }
  };

  const bulk = async (action) => {
    if (invoiceBulkNeedsSelection(action) && !selected.length) {
      toast.error("Fatura seçin.");
      return;
    }
    const list = serverPaging ? await resolveSelectedInvoiceDocs() : selectedInvoices();

    if (action === "refresh") {
      const gate = invoiceBulkRefreshGate({ selected: list, visible: serverPaging ? invoices : visibleInvoices });
      if (gate.empty) {
        toast.info("Güncellenecek GİB belgesi yok.");
        return;
      }
      if (gate.cancelled) return;
      setBulkBusy(true);
      try {
        const workList = list.length ? list : gate.targets;
        const items = await runInvoiceRefreshBulk(workList, {
          remainder: gate.remainder,
          refresh: (inv) => refreshInvoiceGibStatus(API_URL, inv, { silent: true }),
        });
        setBulkResult({ title: "GİB durum güncelleme", items });
        await loadData({ silent: true });
      } finally {
        setBulkBusy(false);
      }
      return;
    }

    if (action === "einvoice_print" || action === "invoice_print") {
      if (!list.length) { toast.error("Fatura seçin."); return; }
      setEFaturaJob({ mode: "print", invoices: list });
      return;
    }
    if (action === "einvoice_send") {
      const drafts = list.filter((inv) => canFaturalastirDraftInvoice(inv));
      const issuable = list.filter((inv) => canIssueInvoice(inv) && !isIncomingPurchaseInvoice(inv));
      if (!issuable.length) {
        toast.info(drafts.length ? "Önce Faturalaştırın" : "Seçili faturalarda e-belge gönderilecek uygun kayıt yok.");
        return;
      }
      if (drafts.length) toast.info("Önce Faturalaştırın");
      if (shouldAskBulkEInvoiceDate(issuable)) {
        setBulkEInvoiceConfirm({ invoices: issuable });
        return;
      }
      openEFaturaSendJob(issuable);
      return;
    }
    if (action === "xml") {
      await downloadInvoiceXmlBulk(list);
      return;
    }
    if (action === "invoice_date") {
      setBulkDateConfirm({ list, classified: classifyInvoiceDateBulk(list) });
      return;
    }
    if (action === "invoice_link") {
      const preview = classifyInvoiceLinkRecipients(list, contacts);
      if (!preview.total) { toast.error("Fatura seçin."); return; }
      setBulkLinkConfirm(preview);
      return;
    }
    if (action === "delete") {
      const deletable = list.filter((inv) => canDeleteInvoice(inv));
      if (!deletable.length) { toast.error("Silinebilir (taslak/kağıt) fatura seçin."); return; }
      if (!canDeleteInv) { toast.error("Silme yetkiniz yok."); return; }
      if (!window.confirm(invoicesBulkDeleteConfirmMessage(deletable))) return;
      setBulkBusy(true);
      try {
        const items = await runInvoiceDeleteBulk(list, {
          remove: (inv) => axios.delete(`${API_URL}/invoices/${inv.id || inv._id}`),
        });
        setBulkResult({ title: "Toplu silme sonucu", items });
        setSelected([]);
        loadData();
      } finally {
        setBulkBusy(false);
      }
      return;
    }
    if (action === "cancel") {
      const open = list.filter((inv) => canCancelInvoice(inv));
      if (!open.length) { toast.info("İptal edilebilir fatura yok."); return; }
      const gibSentCount = open.filter((inv) => isGibIssued(inv)).length;
      const allDisp = open.every((inv) => inv.invoice_type === "dispatch" || inv.e_type === "e_dispatch");
      if (!window.confirm(invoiceCancelConfirmText({
        invoices: open,
        count: open.length,
        gibSentCount,
        isDispatch: allDisp,
      }))) return;
    }

    if (action !== "approve" && action !== "cancel") return;

    setBulkBusy(true);
    try {
      const items = await runInvoiceBulkItems(list, {
        skipReason: (inv) => {
          if (action === "approve") return invoiceBulkApproveSkipReason(inv);
          if (!canCancelInvoice(inv)) return "İptal edilemez";
          return "";
        },
        run: async (inv) => {
          if (action === "approve") {
            await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/approve`);
          } else {
            await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/cancel`, {});
          }
        },
      });
      setBulkResult({
        title: action === "approve" ? "Toplu taslak onay sonucu" : "Toplu iptal sonucu",
        items,
      });
      setSelected([]);
      loadData();
    } finally {
      setBulkBusy(false);
    }
  };

  const confirmBulkInvoiceLinkSend = async () => {
    const preview = bulkLinkConfirm;
    if (!preview || bulkBusy || linkSendLockRef.current) return;
    linkSendLockRef.current = true;
    setBulkBusy(true);
    const items = [];
    try {
      for (const row of preview.skipped || []) {
        items.push({
          id: row.inv.id || row.inv._id,
          label: row.inv.invoice_number,
          outcome: "skipped",
          reason: row.reason || "E-posta yok",
        });
      }
      for (const row of preview.ready || []) {
        const id = row.inv.id || row.inv._id;
        const label = row.inv.invoice_number;
        try {
          await sendInvoiceShareLink({
            axiosClient: axios,
            apiUrl: API_URL,
            companyId,
            inv: row.inv,
            email: row.email,
          });
          items.push({ id, label, outcome: "ok" });
        } catch (err) {
          items.push({ id, label, outcome: "error", reason: bulkApiErrorDetail(err) || "Hata" });
        }
      }
      setBulkLinkConfirm(null);
      setBulkResult({ title: "Fatura linki gönderimi", items });
    } finally {
      setBulkBusy(false);
      linkSendLockRef.current = false;
    }
  };

  const postingIncomingRef = useRef(new Set());
  const [postingIncomingId, setPostingIncomingId] = useState(null);
  const handleFaturalastirIncoming = async (inv) => {
    if (!inv || incomingPurchaseLedgerPosted(inv)) return;
    const id = inv.id || inv._id;
    if (!id || postingIncomingRef.current.has(id)) return;
    if (!window.confirm(`${inv.invoice_number} alış faturası olarak cariye işlensin mi?\nCari bakiyesi ve stok işlenecek.`)) return;
    postingIncomingRef.current.add(id);
    setPostingIncomingId(id);
    try {
      const res = await axios.post(`${API_URL}/invoices/${id}/approve`);
      toast.success(res.data?.message || "Cariye işlendi.");
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Faturalaştırılamadı.");
    } finally {
      postingIncomingRef.current.delete(id);
      setPostingIncomingId((cur) => (cur === id ? null : cur));
    }
  };

  const handleAcceptIncoming = async (inv) => {
    const id = inv.id || inv._id;
    if (!window.confirm(`${inv.invoice_number} gelen e-faturası onaylansın mı? Ticari kabul GİB'e iletilir.`)) return;
    try {
      const res = await axios.post(`${API_URL}/invoices/${id}/accept-incoming`);
      toast.success(res.data.message);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Onaylanamadı.");
    }
  };

  const handleRejectIncoming = async (inv) => {
    const id = inv.id || inv._id;
    const reason = window.prompt(`${inv.invoice_number} gelen e-faturası reddedilsin mi?\nİsteğe bağlı ret nedeni (GİB ticari yanıt, 8 gün):`, "") ?? null;
    if (reason === null) return;
    try {
      const res = await axios.post(`${API_URL}/invoices/${id}/reject-incoming`, { reason });
      toast.success(res.data.message);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Reddedilemedi.");
    }
  };

  const handleRecordPayment = async () => {
    if (!paymentAmount || Number(paymentAmount) <= 0) {
      toast.error("Lütfen geçerli bir tutar girin.");
      return;
    }
    try {
      await axios.post(`${API_URL}/invoices/${paymentModalInvoice.id || paymentModalInvoice._id}/record-payment`, {
        amount: Number(paymentAmount),
        ...splitPaymentTarget(paymentAccount)
      });
      toast.success("Tahsilat/Ödeme kaydı başarıyla işlendi.");
      await notifyDataChanged({ companyId, scopes: ["cash", "invoices", "contacts"] });
      setPaymentModalInvoice(null);
      setPaymentAmount("");
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ödeme kaydedilemedi.");
    }
  };

  const totals = calculateTotals();
  const money = (n) => fmtMoney(n, formData.currency);

  return (
    <div className="space-y-6" data-testid="invoices-page">
      {!companyId && <NoCompanyNotice />}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{lockType ? "İrsaliyeler" : "Ön Muhasebe & E-Dönüşüm"}</h1>
          <p className="text-xs sm:text-sm text-slate-500">{lockType ? "Sevk irsaliyeleri, e-İrsaliye ve faturaya dönüştürme" : "Satış, Alış, E-Fatura, E-Arşiv ve GİB Portal Entegrasyonu"}</p>
        </div>
        <div className="flex gap-2 self-start">
        {addonOn("ai.invoice") && <button type="button" onClick={() => {
          const cid = activeCompany?.id || activeCompany?._id;
          if (!cid) { toast.error("Firma yükleniyor, bir saniye sonra tekrar deneyin."); return; }
          setShowAiImport(true);
        }} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-violet-600/20 transition" data-testid="ai-import-btn"><Sparkles className="w-4 h-4" /><span>{(filterType === "sales" || filterType === "export") ? "PDF/XML Satış Aktar (AI)" : "PDF'den Aktar (AI)"}</span></button>}
        <button
          onClick={() => { if (filterType === "dispatch") setFormData((fd) => ({ ...fd, invoice_type: "dispatch", e_type: "e_dispatch" })); setShowNewModal(true); }}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-600/20 transition self-start sm:self-auto"
          data-testid="create-new-invoice-btn"
        >
          <Plus className="w-4 h-4" />
          <span>{filterType === "dispatch" ? "Yeni İrsaliye" : filterType === "purchase" ? "Alış Faturası Gir" : "Yeni Fatura Kes"}</span>
        </button>
        </div>
      </div>
      {showAiImport && addonOn("ai.invoice") && (activeCompany?.id || activeCompany?._id) && (
        <AiInvoiceImportModal
          companyId={activeCompany?.id || activeCompany?._id}
          contacts={contacts}
          invoiceType={(filterType === "sales" || filterType === "export") ? "sales" : "purchase"}
          onClose={() => setShowAiImport(false)}
          onDone={() => { setShowAiImport(false); loadData(); }}
        />
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 text-xs">
        {dispatchView && (
          <div className="flex items-center gap-1 shrink-0" data-testid="dispatch-dir-tabs">
            {[
              { id: "out", label: "Giden", count: outgoingDispatches.length },
              { id: "in", label: "Gelen", count: incomingDispatches.length },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDispatchDir(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  dispatchDir === tab.id ? "bg-fuchsia-700 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
                data-testid={`dispatch-dir-${tab.id}`}
                data-active={dispatchDir === tab.id ? "1" : "0"}
              >
                {tab.label}
                <span className={`ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full px-1 text-[10px] ${dispatchDir === tab.id ? "bg-white/20" : "bg-slate-200 text-slate-700"}`} data-testid={`dispatch-dir-count-${tab.id}`}>{tab.count}</span>
              </button>
            ))}
            {dispatchDir === "out" && (
              <button
                type="button"
                onClick={handleMergeDispatches}
                disabled={mergeOutgoingIds.length < 2 || mergeBusy}
                className="ml-1 px-3 py-1.5 rounded-lg font-semibold bg-fuchsia-50 text-fuchsia-800 border border-fuchsia-200 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="merge-dispatches-btn"
              >
                Tek faturada birleştir
              </button>
            )}
          </div>
        )}
        {!lockType && (
          <div className="flex items-center gap-2 overflow-x-auto min-w-0 flex-1">
            {[
              { id: "all", label: "Tüm Faturalar" },
              { id: "sales", label: "Satış Faturaları" },
              { id: "purchase", label: "Alış Faturaları" },
              { id: "incoming", label: "Gelen e-Fatura" },
              { id: "outgoing_gib", label: "Giden e-Fatura" },
              { id: "proforma", label: "Proforma & Teklif" },
              { id: "return", label: "İade Faturaları" },
              { id: "export", label: "İhracat" },
              { id: "import", label: "İthalat" },
              { id: "dispatch", label: "Giden e-İrsaliye" }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setFilterType(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-medium transition shrink-0 ${
                  filterType === tab.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
                data-testid={`filter-tab-${tab.id}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        <label
          className={`inline-flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-lg cursor-pointer select-none transition ${
            showCancelled ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-100"
          } ${lockType ? "ml-auto" : ""}`}
          data-testid="show-cancelled-invoices"
        >
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(e) => setShowCancelled(e.target.checked)}
            className="rounded border-slate-300 text-slate-900 accent-slate-900 w-3.5 h-3.5"
            data-testid="show-cancelled-invoices-check"
          />
          İptal edilenleri göster
        </label>
      </div>

      {!lockType && (
        <InvoiceGibBar
          settings={einvoiceSettings}
          loading={einvoiceLoading}
          busy={gibBusy}
          onPullIncoming={pullGibIncoming}
          onRefreshOutgoing={refreshOutgoingGib}
          onFilterDispatch={filterDispatchList}
          onFilterOutgoing={filterOutgoingGib}
          onFilterIncoming={filterIncomingGib}
        />
      )}

      <InvoiceToolbar
        f={filters}
        setF={setFilters}
        count={resultCount}
        total={visibleTotal}
        hidePay={filterType === "dispatch"}
        rows={serverPaging ? invoices : visibleInvoices}
        loadRows={serverPaging ? loadExportRows : undefined}
        draftCount={serverPaging ? serverSummary?.draft_count : undefined}
        approvedCount={serverPaging ? serverSummary?.approved_count : undefined}
        selectedCount={selected.length}
        bulkBusy={bulkBusy}
        onBulkAction={bulk}
      />

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        {contactFilter && (
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border-b border-emerald-100 text-xs" data-testid="contact-filter-chip">
            <span className="text-emerald-800">Cari filtresi: <b>{contacts.find((c) => c.id === contactFilter)?.name || invoices.find((i) => i.contact_id === contactFilter)?.contact_name || contactFilter}</b> ({serverPaging ? resultCount : invoices.filter((i) => i.contact_id === contactFilter).length} fatura)</span>
            <button onClick={() => navigate("/invoices")} className="ml-auto px-2 py-0.5 rounded-full bg-white border border-emerald-200 text-emerald-700 font-semibold hover:bg-emerald-100" data-testid="clear-contact-filter-btn">Filtreyi Kaldır</button>
          </div>
        )}
        <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-50/70 border-b border-slate-100 text-[11px] text-slate-500" data-testid="ctx-hint">
          <MousePointerClick className="w-3.5 h-3.5 text-emerald-600" /> İpucu: Satış taslaklarında <b>Taslağı faturalaştır</b> ile belge türü seçilir. Gelen faturada <b>Faturalaştır</b> tek tıkla alış faturası olarak cariye ve stoğa işler; e-Fatura / e-Arşiv / kağıt seçilmez. Ticari yanıt için <b>Onayla</b> veya <b>Reddet</b> kullanılır.
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-xs text-slate-600">
            <colgroup>
              <col style={{ width: "2.25rem" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: INVOICE_ACTIONS_COL }} />
            </colgroup>
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={headerAllSelected}
                    ref={(el) => { if (el) el.indeterminate = headerSomeSelected; }}
                    onChange={toggleSelectAllVisible}
                    className="rounded border-slate-300"
                    title="Hepsini seç"
                    data-testid="inv-select-all"
                  />
                </th>
                <SortTh col="number">{filterType === "dispatch" ? "İrsaliye No" : "Fatura No"} / Tür / Kaynak</SortTh>
                <SortTh col="contact">Cari (Müşteri / Tedarikçi)</SortTh>
                <SortTh col="date">Tarih / Saat / Vade</SortTh>
                <SortTh col="gib">GİB Durumu</SortTh>
                <SortTh col="amount" className="text-right">Tutar</SortTh>
                {filterType === "dispatch" ? (
                  <th className="px-4 py-3 text-right">İrsaliye Durumu</th>
                ) : (
                  <SortTh col="pay" className="text-right">Ödeme Durumu</SortTh>
                )}
                <th className="px-3 py-3 text-center bg-slate-50 sticky right-0 z-[1]" style={{ width: INVOICE_ACTIONS_COL }} data-testid="inv-actions-header">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400" data-testid="inv-empty">
                    {invoices.length === 0
                      ? (filterType === "proforma" ? "Proforma veya teklif kaydı yok." : "Kayıtlı fatura bulunamadı.")
                      : "Filtreye uyan kayıt yok."}
                  </td>
                </tr>
              ) : (
                tableInvoices.map((inv) => {
                  const rowId = invRowId(inv);
                  const linesOpen = invLinesOpen(rowId);
                  const lineItems = linesOpen ? itemsForInv(inv) : [];
                  const linesLoading = expandLoadingId === rowId;
                  return (
                  <React.Fragment key={rowId}>
                  <tr className={`group/row hover:bg-slate-50/70 transition ${ctxMenu?.inv?.invoice_number === inv.invoice_number ? "bg-emerald-50/60" : ""} ${linesOpen ? "bg-slate-50/50" : ""} ${selected.includes(rowId) ? "bg-rose-50/40" : ""}`} data-testid={inv._is_quote ? `quote-row-${inv.invoice_number}` : `invoice-row-${inv.invoice_number}`}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.includes(rowId)}
                        onChange={() => toggleSel(rowId)}
                        className="rounded border-slate-300"
                        data-testid={`inv-select-${inv.invoice_number}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium overflow-hidden">
                      <div className="flex items-start gap-1.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => toggleInvLines(inv)}
                          className="mt-0.5 shrink-0 p-0.5 rounded text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 transition"
                          title={linesOpen ? "Kalemleri gizle" : "Kalemleri göster"}
                          aria-expanded={linesOpen}
                          data-testid={`inv-lines-toggle-${inv.invoice_number}`}
                        >
                          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${linesOpen ? "rotate-180 text-emerald-700" : ""}`} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="text-slate-900 font-mono font-semibold truncate">{displayInvoiceNumber(inv)}</div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${typeBadge(inv)[1]}`}>
                              {typeBadge(inv)[0]}
                            </span>
                            {isCancelledInvoice(inv) ? (
                              <span className="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-rose-100 text-rose-800" data-testid={`inv-cancelled-badge-${inv.invoice_number}`}>İptal</span>
                            ) : isApprovingInvoice(inv) ? (
                              <span className="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-amber-100 text-amber-800" data-testid={`inv-approving-badge-${inv.invoice_number}`}>{APPROVING_INVOICE_BADGE}</span>
                            ) : null}
                            <SourceBadge channel={inv.source_channel} testId={`inv-source-${inv.invoice_number}`} />
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded uppercase" data-testid={`inv-etype-badge-${inv.invoice_number}`}>
                              {invoiceETypeLabel(inv)}
                            </span>
                            {(() => {
                              const commercial = incomingCommercialStatusLabel(inv);
                              if (!commercial) return null;
                              return (
                                <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${COMMERCIAL_BADGE_CLASS[commercial.tone] || ""}`} data-testid={`inv-commercial-${inv.invoice_number}`}>
                                  {commercial.label}
                                </span>
                              );
                            })()}
                            {inv.installment_plan && <button onClick={() => setInstallmentInv(inv)} className="text-[10px] bg-violet-50 text-violet-700 px-1.5 py-0.2 rounded font-semibold hover:bg-violet-100" data-testid={`inv-installment-badge-${inv.invoice_number}`}>{inv.installment_plan.paid_count}/{inv.installment_plan.count} Taksit</button>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 overflow-hidden">
                      <button onClick={() => inv.contact_id && navigate(`/contacts?contact_id=${inv.contact_id}`)} className="font-semibold text-slate-900 hover:text-emerald-700 hover:underline text-left truncate max-w-full block" data-testid={`inv-contact-link-${inv.invoice_number}`}>{inv.contact_name}</button>
                      <div className="text-[11px] text-slate-400 truncate">VKN/TCKN: {inv.contact_tax_id || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{fmtDate(inv.issue_date)}{inv.issue_time ? <span className="text-slate-400 font-normal"> · {String(inv.issue_time).slice(0, 5)}</span> : null}</div>
                      <div className="text-[11px] text-slate-400">Vade: {inv.due_date ? fmtDate(inv.due_date) : 'Peşin'}</div>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const incoming = isIncomingPurchaseInvoice(inv);
                        const pending = isIncomingPurchasePending(inv);
                        const resp = incomingPurchaseResponse(inv);
                        const gs = formatGibStatusLabel(inv);
                        const rawGs = String(inv.gib_status || "");
                        const isErr =
                          inv.einvoice_state === "error" ||
                          /^\s*hata\s*:/i.test(rawGs) ||
                          /^\s*hata\s*:/i.test(gs) ||
                          resp === "rejected" ||
                          inv.status === "cancelled";
                        const isTest = /test/i.test(String(inv.gib_mode || "")) || /^test\b/i.test(gs);
                        const cls = isErr
                          ? "bg-rose-50 text-rose-700"
                          : incoming && pending
                            ? "bg-amber-50 text-amber-800"
                            : isTest
                              ? "bg-sky-50 text-sky-800"
                              : "bg-emerald-50 text-emerald-700";
                        const Icon = isErr ? XCircle : CheckCircle2;
                        const label =
                          isErr && gs.length > 96 ? `${gs.slice(0, 93)}…` : gs || "Taslak";
                        return (
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full max-w-full ${cls}`}
                        title={rawGs || gs || undefined}
                        data-testid={`inv-gib-badge-${inv.invoice_number}`}
                        data-gib-mode={inv.gib_mode || ""}
                      >
                        <Icon className="w-3 h-3 shrink-0" />
                        <span className="min-w-0 break-words">{label}</span>
                      </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-bold text-slate-900">{fmtMoney(inv.grand_total, inv.currency || "TRY")}</div>
                      {(inv.currency || "TRY") !== "TRY" && inv.local_total != null && <div className="text-[10px] text-slate-400">{fmtMoney(inv.local_total, "TRY")}</div>}
                      {(inv.currency || "TRY") !== "TRY" && inv.local_total == null && Number(inv.fx_rate) > 0 && <div className="text-[10px] text-slate-400">{fmtMoney(Number(inv.grand_total || 0) * Number(inv.fx_rate || 1), "TRY")} · kur {inv.fx_rate}</div>}
                      <div className="text-[10px] text-slate-400">{inv.invoice_type === 'dispatch' ? "KDV'siz (Sevk)" : 'KDV Dahil'}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {inv._is_quote ? (
                        <span className={`inline-block text-[11px] px-2 py-0.5 rounded-md font-semibold ${
                          inv.invoice_id ? "bg-emerald-100 text-emerald-800" : inv.status === "accepted" ? "bg-emerald-100 text-emerald-800" : inv.status === "rejected" ? "bg-rose-100 text-rose-800" : "bg-indigo-100 text-indigo-800"
                        }`} data-testid={`quote-status-${inv.invoice_number}`}>
                          {inv.invoice_id ? "Faturalandı" : inv.gib_status || inv.status || "Taslak"}
                        </span>
                      ) : inv.invoice_type === "dispatch" ? (
                        <span className={`inline-block text-[11px] px-2 py-0.5 rounded-md font-semibold ${inv.converted_invoice_id ? "bg-emerald-100 text-emerald-800" : "bg-fuchsia-100 text-fuchsia-800"}`} data-testid={`dispatch-status-${inv.invoice_number}`}>
                          {inv.converted_invoice_id ? `Faturalandı · ${inv.converted_invoice_number}` : inv.order_number ? `Sipariş ${inv.order_number}` : inv.invoice_ref_number ? `Fatura ${inv.invoice_ref_number}` : "Faturalanmadı"}
                        </span>
                      ) : (
                      <span className={`inline-block text-[11px] px-2 py-0.5 rounded-md font-semibold ${
                        isCancelledInvoice(inv)
                          ? "bg-rose-100 text-rose-800"
                          : isIncomingPurchaseInvoice(inv) && !incomingPurchaseLedgerPosted(inv)
                          ? "bg-amber-100 text-amber-800"
                          : inv.payment_status === "paid"
                          ? "bg-emerald-100 text-emerald-800"
                          : inv.payment_status === "partially_paid"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-rose-100 text-rose-800"
                      }`} data-testid={`inv-pay-${inv.invoice_number}`}>
                        {isCancelledInvoice(inv)
                          ? "İptal"
                          : isIncomingPurchaseInvoice(inv) && !incomingPurchaseLedgerPosted(inv)
                          ? "İşlenmedi"
                          : inv.payment_status === "paid" ? "Ödendi" : inv.payment_status === "partially_paid" ? "Kısmi Ödendi" : "Cariye işlendi"}
                      </span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-3 text-center sticky right-0 z-[1] ${ctxMenu?.inv?.invoice_number === inv.invoice_number ? "bg-emerald-50" : "bg-white group-hover/row:bg-slate-50"}`}
                      style={{ width: INVOICE_ACTIONS_COL }}
                    >
                      {inv._is_quote ? (
                        <div className="flex items-center justify-center gap-1.5" data-testid={`quote-actions-${inv.invoice_number}`}>
                          <button type="button" onClick={() => navigate("/quotes")} className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 hover:bg-slate-50" data-testid={`quote-open-${inv.invoice_number}`}>Teklifler</button>
                          {!inv.invoice_id && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const r = await axios.post(`${API_URL}/quotes/${inv.id}/convert-to-invoice`, {});
                                  toast.success(r.data.message || "Fatura oluşturuldu.");
                                  loadData();
                                } catch (err) {
                                  toast.error(err.response?.data?.detail || "Faturaya çevrilemedi.");
                                }
                              }}
                              className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                              data-testid={`quote-to-invoice-${inv.invoice_number}`}
                            >
                              Faturaya Çevir
                            </button>
                          )}
                        </div>
                      ) : (() => {
                        const incoming = isIncomingPurchaseInvoice(inv);
                        const pendingIncoming = incoming && isIncomingPurchasePending(inv);
                        if (incoming) {
                          const incomingDisabled = invoiceRowActionsDisabled(inv);
                          return (
                            <div
                              className={`flex flex-wrap items-center justify-center gap-1.5 ${incomingDisabled ? "opacity-40 pointer-events-none" : ""}`}
                              data-testid={`inv-actions-${inv.invoice_number}`}
                              aria-disabled={incomingDisabled || undefined}
                            >
                              <IncomingInvoiceFaturalastirButton
                                inv={inv}
                                disabled={postingIncomingId === (inv.id || inv._id)}
                                onPress={handleFaturalastirIncoming}
                                testId={`incoming-faturalastir-${inv.invoice_number}`}
                              />
                              {pendingIncoming ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleAcceptIncoming(inv)}
                                    className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                    title="Ticari kabul yanıtı GİB'e iletilir"
                                    data-testid={`accept-incoming-btn-${inv.invoice_number}`}
                                  >
                                    Onayla
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRejectIncoming(inv)}
                                    className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
                                    title="Ticari ret — alış kaydı iptal edilir"
                                    data-testid={`reject-incoming-btn-${inv.invoice_number}`}
                                  >
                                    Reddet
                                  </button>
                                </>
                              ) : (
                                <span
                                  className={`inline-flex items-center px-2 py-1 text-[10px] font-semibold rounded-md ${
                                    incomingPurchaseResponse(inv) === "rejected"
                                      ? "bg-rose-50 text-rose-700"
                                      : "bg-emerald-50 text-emerald-700"
                                  }`}
                                  data-testid={`incoming-response-${inv.invoice_number}`}
                                >
                                  {incomingPurchaseResponse(inv) === "rejected" ? "Reddedildi" : "Onaylandı"}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  if (shouldUseIntegratorPdf("invoice", inv)) presentInvoice(inv, setPrintInv);
                                  else presentInvoice(inv, setPreviewInvoice);
                                }}
                                className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                                title="Görüntüle / Yazdır"
                                data-testid={`preview-inv-btn-${inv.invoice_number}`}
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            </div>
                          );
                        }
                        const actionsDisabled = invoiceRowActionsDisabled(inv);
                        return (
                      <div className={`flex flex-col items-center gap-1 mx-auto ${actionsDisabled ? "opacity-40 pointer-events-none" : ""}`} data-testid={`inv-actions-${inv.invoice_number}`} aria-disabled={actionsDisabled || undefined}>
                        {canIssueInv && canFaturalastirDraftInvoice(inv) ? (
                          <DraftInvoiceFaturalastirButton
                            inv={inv}
                            onApprove={handleApproveDraft}
                            testId={`draft-faturalastir-btn-${inv.invoice_number}`}
                          />
                        ) : null}
                        <div className="grid grid-cols-[repeat(6,1.75rem)] gap-1 justify-center justify-items-center items-center">
                        <button
                          onClick={() => presentInvoice(inv, setPreviewInvoice)}
                          className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                          title="Faturayı Görüntüle / Yazdır"
                          data-testid={`preview-inv-btn-${inv.invoice_number}`}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {canDeleteInv && canDeleteInvoice(inv) ? (
                          <button type="button" onClick={() => handleDeleteInvoice(inv)} className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition" title={inv.status === "draft" ? "Taslağı sil" : (inv.invoice_type === "dispatch" || inv.e_type === "e_dispatch") ? "İrsaliyeyi sil" : "Kağıt faturayı sil"} data-testid={`delete-inv-btn-${inv.invoice_number}`}><Trash2 className="w-4 h-4" /></button>
                        ) : <span className="w-7 h-7" aria-hidden="true" />}
                        {canEditInvoice(inv) ? (
                          <button
                            type="button"
                            onClick={() => openEditInvoice(inv)}
                            className="p-1.5 text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition"
                            title="Faturayı düzenle"
                            data-testid={`edit-inv-btn-${inv.invoice_number}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        ) : <span className="w-7 h-7" aria-hidden="true" />}
                        <button type="button" onClick={(e) => openCtxFromButton(e, inv)} className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition" title="Fatura kesim & diğer işlemler" data-testid={`inv-more-btn-${inv.invoice_number}`}><MoreVertical className="w-4 h-4" /></button>
                        {inv.invoice_type === "dispatch" ? (
                          <>
                            {canSendOutgoingDispatch(inv) ? (
                              <button type="button" onClick={() => openDespatchSend(inv)} className="col-span-6 px-2 py-1 text-[10px] font-semibold rounded-lg bg-fuchsia-700 text-white hover:bg-fuchsia-800" data-testid={`dispatch-send-btn-${inv.invoice_number}`}>{despatchSendLabel(inv)}</button>
                            ) : null}
                            <button onClick={() => handleConvertDispatch(inv)} disabled={!!inv.converted_invoice_id || isIncomingDispatch(inv)} className="p-1.5 text-fuchsia-600 hover:text-fuchsia-800 hover:bg-fuchsia-50 rounded-lg transition disabled:opacity-30" title={inv.converted_invoice_id ? "Faturalandı" : (inv.invoice_ref_number || inv.invoice_id) ? "Mevcut faturaya bağla" : "İrsaliyeyi Faturaya Dönüştür"} data-testid={`dispatch-convert-btn-${inv.invoice_number}`}><FileCheck2 className="w-4 h-4" /></button>
                          </>
                        ) : inv.invoice_type === "sales" && supportsEDispatch(einvoiceSettings) ? (
                          <button type="button" onClick={() => handleCreateDispatch(inv)} className="p-1.5 text-fuchsia-600 hover:text-fuchsia-800 hover:bg-fuchsia-50 rounded-lg transition" title={inv.dispatch_number ? `İrsaliye: ${inv.dispatch_number}` : "e-İrsaliye oluştur (bağlı entegratör)"} data-testid={`create-dispatch-btn-${inv.invoice_number}`}><Truck className="w-4 h-4" /></button>
                        ) : <span className="w-7 h-7" aria-hidden="true" />}
                        {(inv.gib_uuid || inv.gib_tracking_id) && isEinvoiceConfigured(einvoiceSettings) ? (
                          <button
                            type="button"
                            onClick={async () => { await refreshInvoiceGibStatus(API_URL, inv); loadData({ silent: true }); }}
                            className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition"
                            title="Giden GİB durumunu yenile (bağlı entegratör)"
                            data-testid={`refresh-gib-btn-${inv.invoice_number}`}
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        ) : <span className="w-7 h-7" aria-hidden="true" />}
                        </div>
                      </div>
                        );
                      })()}
                    </td>
                  </tr>
                  {linesOpen && (
                    <tr className="bg-slate-50/80" data-testid={`inv-lines-row-${inv.invoice_number}`}>
                      <td colSpan={8} className="px-4 py-3 border-t border-slate-100">
                        <InvoiceLinesTable
                          inv={inv}
                          items={lineItems}
                          loading={linesLoading}
                          prefix="inv"
                          topSlot={canMatchIncomingProducts(inv) && unmatchedIncomingLineCount(lineItems) > 0 ? (
                            <div
                              className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
                              data-testid={`inv-stock-match-bar-${inv.invoice_number}`}
                            >
                              <PackagePlus className="w-4 h-4 text-amber-700 shrink-0" />
                              <span className="text-[11px] text-amber-900 flex-1">
                                {unmatchedIncomingLineCount(lineItems)} satır stok kartıyla eşleşmedi. Satırdan seçin veya kart oluşturun.
                              </span>
                              <button
                                type="button"
                                onClick={() => createMissingIncomingProducts(inv)}
                                disabled={!!lineMatchBusy}
                                className="px-3 py-1.5 bg-amber-700 text-white rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                                data-testid={`inv-create-missing-products-${inv.invoice_number}`}
                              >
                                {lineMatchBusy === `${rowId}:create-all` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackagePlus className="w-3.5 h-3.5" />}
                                Eşleşmeyenlere stok kartı oluştur
                              </button>
                            </div>
                          ) : null}
                          extraHeader={canMatchIncomingProducts(inv) ? (
                            <th className="py-1 pl-2 text-left font-semibold w-64">Stok Kartı</th>
                          ) : null}
                          renderExtraCell={canMatchIncomingProducts(inv) ? (it, i) => (
                            <td className="py-1.5 pl-2">
                              <div className="flex items-center gap-1 min-w-[14rem]">
                                <div className="flex-1 min-w-0">
                                  <SearchSelect
                                    value={it.product_id || ""}
                                    options={products}
                                    getLabel={(p) => p.name}
                                    getSub={(p) => `${p.sku || ""} · stok ${p.stock_quantity ?? "-"}`}
                                    valueLabel={it.matched_product_name || products.find((p) => (p.id || p._id) === it.product_id)?.name || ""}
                                    placeholder="Stok kartı seç…"
                                    clearable
                                    clearLabel="Eşleştirmeyi kaldır"
                                    onChange={(pid) => matchIncomingLine(inv, i, pid || null)}
                                    testId={`inv-line-select-${inv.invoice_number}-${i}`}
                                  />
                                </div>
                                {!it.product_id && (
                                  <button
                                    type="button"
                                    onClick={() => createProductForIncomingLine(inv, i)}
                                    disabled={!!lineMatchBusy}
                                    className="p-1.5 bg-emerald-600 text-white rounded-lg disabled:opacity-50"
                                    title="Bu kalemden stok kartı aç"
                                    data-testid={`inv-line-create-${inv.invoice_number}-${i}`}
                                  >
                                    {lineMatchBusy === `${rowId}:create:${i}`
                                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      : <PackagePlus className="w-3.5 h-3.5" />}
                                  </button>
                                )}
                              </div>
                            </td>
                          ) : undefined}
                        />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {serverPaging && selectedAllFiltered && selected.length > 0 && (
          <div className="px-4 py-2 text-xs text-emerald-800 bg-emerald-50 border-t border-emerald-100" data-testid="inv-all-selected">
            {selected.length} belgenin tümü seçildi
          </div>
        )}
        {serverPaging && serverHasMore && (
          <div ref={serverSentinelRef} className="px-4 py-3 text-center text-[11px] text-slate-400 border-t border-slate-100" data-testid="invoices-load-more-server">
            Daha fazla fatura yükleniyor…
          </div>
        )}
        {!serverPaging && invoicesHasMore && (
          <div ref={invoicesSentinelRef} className="px-4 py-3 text-center text-[11px] text-slate-400 border-t border-slate-100" data-testid="invoices-load-more">
            Daha fazla fatura yükleniyor…
          </div>
        )}
      </div>

      <InvoiceContextMenu
        menu={ctxMenu}
        onClose={closeCtx}
        companyId={activeCompany?.id || activeCompany?._id}
        onIssue={handleIssueFromMenu}
        onApproveDraft={handleApproveDraft}
        onPreview={(inv) => {
          // GİB'e iletilmiş e-belge: yerel şablon yerine entegratör PDF (İşNet)
          if (shouldUseIntegratorPdf("invoice", inv)) {
            presentInvoice(inv, setPrintInv);
            return;
          }
          presentInvoice(inv, setPreviewInvoice);
        }}
        onPrint={(inv) => presentInvoice(inv, setPrintInv)}
        onNotify={async (inv) => {
          setNotifyInvoice(inv);
          setNotifyFiles([]);
          if (!shouldUseIntegratorPdf("invoice", inv)) return;
          const id = inv.id || inv._id;
          if (!id) return;
          try {
            const r = await axios.get(`${API_URL}/invoices/${id}/pdf`, {
              responseType: "blob",
              params: { require_integrator: 1 },
              headers: { Accept: "application/pdf" },
            });
            const source = String(r.headers?.["x-document-source"] || "").toLowerCase();
            if (source && source !== "integrator") return;
            const blob = r.data instanceof Blob ? r.data : new Blob([r.data], { type: "application/pdf" });
            if (!blob || blob.size < 50) return;
            const name = `${displayInvoiceNumber(inv)}.pdf`;
            const file = new File([blob], name, { type: "application/pdf" });
            setNotifyFiles([file]);
          } catch {
            /* e-posta ekleri isteğe bağlı; mesaj yine gönderilebilir */
          }
        }}
        onPayment={openPayment}
        onDispatch={handleCreateDispatch}
        onInstallments={setInstallmentInv}
        onAcceptIncoming={handleAcceptIncoming}
        onRejectIncoming={handleRejectIncoming}
        onFaturalastirIncoming={handleFaturalastirIncoming}
        apiBase={API_URL}
        onEdit={openEditInvoice}
        onDelete={canDeleteInv ? handleDeleteInvoice : undefined}
        onCancel={handleCancelInvoice}
        onExpenseSlip={handleExpenseSlip}
        onCopy={invoiceCopy.handleCopyMode}
        onGibStatusRefreshed={() => loadData({ silent: true })}
        einvoiceSettings={einvoiceSettings}
        onOpenGibInbox={openGibInbox}
        onOpenIncomingDispatch={openIncomingDispatchInbox}
        onPullGibInbox={pullGibIncoming}
        onFilterOutgoingGib={filterOutgoingGib}
        onFilterDispatch={filterDispatchList}
      />
      {bulkEInvoiceConfirm && (
        <BulkEInvoiceConfirmModal
          invoices={bulkEInvoiceConfirm.invoices || []}
          busy={bulkEInvoiceBusy}
          onClose={() => !bulkEInvoiceBusy && setBulkEInvoiceConfirm(null)}
          onConfirm={confirmBulkEInvoiceDates}
        />
      )}
      {bulkDateConfirm && (
        <BulkInvoiceDateModal
          updateCount={bulkDateConfirm.classified?.updateCount || 0}
          skipCount={bulkDateConfirm.classified?.skipCount || 0}
          busy={bulkBusy}
          onClose={() => !bulkBusy && setBulkDateConfirm(null)}
          onConfirm={confirmBulkInvoiceDate}
        />
      )}
      {bulkLinkConfirm && (
        <BulkInvoiceLinkConfirmModal
          ready={bulkLinkConfirm.ready || []}
          skipped={bulkLinkConfirm.skipped || []}
          total={bulkLinkConfirm.total}
          busy={bulkBusy}
          onClose={() => !bulkBusy && setBulkLinkConfirm(null)}
          onConfirm={confirmBulkInvoiceLinkSend}
        />
      )}
      {bulkResult && (
        <BulkResultModal
          title={bulkResult.title}
          items={bulkResult.items || []}
          onClose={() => setBulkResult(null)}
        />
      )}
      {eFaturaJob && (
        <ElektronikFaturaOnayModal
          mode={eFaturaJob.mode || "send"}
          invoice={eFaturaJob.invoice || null}
          invoices={eFaturaJob.invoices || (eFaturaJob.invoice ? [eFaturaJob.invoice] : [])}
          contacts={contacts}
          companyId={activeCompanyId(activeCompany)}
          onClose={() => {
            setEFaturaJob(null);
            loadData({ silent: true });
          }}
          onConfirm={async (payload, ctx) => {
            if ((eFaturaJob.mode || "send") === "print") {
              const list = eFaturaJob.invoices || (eFaturaJob.invoice ? [eFaturaJob.invoice] : []);
              return openInvoicePdfsWithProgress(list, ctx);
            }

            const docs = (payload.documents && payload.documents.length)
              ? payload.documents
              : (eFaturaJob.invoices || (eFaturaJob.invoice ? [eFaturaJob.invoice] : []));
            const { eType, scenario, withholding, returnRef, exemption, stampNow } = payload;

            ctx?.setSteps?.([
              { id: "prepare", label: "Hazırlık ve doğrulama" },
              { id: "send", label: "Entegratöre / GİB’e gönderim" },
              { id: "refresh", label: "GİB durum sorgusu" },
              { id: "done", label: "Tamamlandı" },
            ]);
            ctx?.initItems?.(docs.map((d) => ({
              id: d.id || d._id,
              label: d.invoice_number || d.id,
              sublabel: d.contact_name || "",
            })));
            ctx?.setStep?.("prepare", "active");

            let ok = 0;
            let fail = 0;
            let skipped = 0;

            for (const inv of docs) {
              const invId = inv.id || inv._id;
              const docEType = inv.eType || eType;
              const docScenario = inv.scenario || (docEType === "e_invoice" ? scenario : undefined);
              const docGib = inv.gibMeta || (docs.length === 1 ? payload.gibMeta : null);
              if (!invId || isIncomingPurchaseInvoice(inv)) {
                skipped++;
                if (invId) ctx?.setItem?.(invId, { status: "skipped", detail: "Gönderime uygun değil" });
                continue;
              }
              if (inv.status === "draft" && !canIssueInvoice(inv)) {
                skipped++;
                ctx?.setItem?.(invId, { status: "skipped", detail: "Önce Faturalaştırın" });
                continue;
              }
              if (!canRunInvoiceIssueFlow(inv)) {
                skipped++;
                ctx?.setItem?.(invId, { status: "skipped", detail: "Gönderime uygun değil" });
                continue;
              }
              ctx?.setItem?.(invId, { status: "running", detail: "Hazırlanıyor…" });
              try {
                const mukellefPatch = contactMukellefPatch(docGib);
                if (mukellefPatch && inv.contact_id) {
                  try {
                    await axios.put(`${API_URL}/contacts/${inv.contact_id}`, mukellefPatch);
                  } catch { /* gönderim yine denenecek */ }
                }
                const patch = {};
                const issueStamp = stampNow && docs.length === 1 ? nowIssueDateTime() : null;
                if (issueStamp) {
                  Object.assign(patch, issueStamp);
                }
                if (withholding) {
                  patch.withholding_rate = Number(withholding.withholding_rate || 0);
                  patch.withholding_code = withholding.withholding_code || null;
                }
                if (exemption?.tax_exemption_code) {
                  patch.tax_exemption_code = exemption.tax_exemption_code;
                  patch.tax_exemption_reason = exemption.tax_exemption_reason || null;
                }
                if (returnRef?.original_invoice_number) {
                  patch.original_invoice_number = returnRef.original_invoice_number;
                  patch.original_issue_date = returnRef.original_issue_date || null;
                  if (returnRef.notes) patch.notes = returnRef.notes;
                }
                if (Object.keys(patch).length) {
                  try {
                    await axios.put(`${API_URL}/invoices/${invId}`, patch);
                  } catch (putErr) {
                    // Tarih send-to-gib gövdesinde de uygulanır; diğer alanlar zorunluysa dur.
                    if (!issueStamp || withholding || exemption || returnRef) throw putErr;
                  }
                }
                ctx?.setStep?.("send", "active", docs.length > 1 ? `${inv.invoice_number || invId}` : "");
                ctx?.setItem?.(invId, { status: "running", detail: "GİB’e gönderiliyor…" });
                const sent = await handleSendToGib(invId, docEType, {
                  scenario: docScenario,
                  stampNow: !!issueStamp,
                  issueStamp: issueStamp || undefined,
                  silentToast: true,
                  skipReload: true,
                  skipRefresh: true,
                });
                ctx?.setStep?.("refresh", "active", "Gönderim yanıtından durum alındı");
                ok++;
                ctx?.setItem?.(invId, {
                  status: "ok",
                  detail: sent?.refreshMsg || sent?.message || "Gönderildi",
                });
              } catch (err) {
                fail++;
                ctx?.setItem?.(invId, {
                  status: "error",
                  detail: bulkApiErrorDetail(err) || err?.response?.data?.detail || "Gönderilemedi",
                });
              }
            }

            ctx?.completeStep?.("prepare");
            ctx?.completeStep?.("send", `${ok} gönderildi${fail ? `, ${fail} hata` : ""}`);
            ctx?.completeStep?.("refresh", "Ek durum sorgusu atlandı (gönderimde doğrulandı)");
            ctx?.setStep?.("done", "done");
            setSelected([]);
            await loadData({ silent: true });
            if (!ok && fail) {
              throw new Error(docs.length === 1 ? "Fatura kesilemedi." : `${fail} fatura gönderilemedi.`);
            }
            return { ok, fail, skipped };
          }}
        />
      )}
      {invoiceCopy.modal}
      {installmentInv && <InstallmentPlanModal doc={installmentInv} kind="invoice" accounts={bankAccounts} companyId={activeCompanyId(activeCompany)} onClose={() => setInstallmentInv(null)} onChanged={loadData} />}
      {printInv && printInv.e_type === "expense_slip" && (
        <ExpenseSlipPrint doc={printInv} company={activeCompany} onClose={() => setPrintInv(null)} />
      )}
      {printInv && printInv.e_type !== "expense_slip" && (
        <PrintDocument docType="invoice" doc={printInv} company={activeCompany} onClose={() => setPrintInv(null)} onEditTemplate={() => setEditTpl(true)} />
      )}
      {editTpl && <PrintTemplateEditor companyId={activeCompanyId(activeCompany)} docType="invoice" onClose={() => setEditTpl(false)} />}
      {notifyInvoice && (() => {
        const c = contacts.find(cnt => cnt.id === notifyInvoice.contact_id) || {};
        const overdue = notifyInvoice.payment_status !== 'paid';
        return (
          <QuickMessageModal
            companyId={activeCompanyId(activeCompany)}
            recipient={{ contact_id: notifyInvoice.contact_id, name: notifyInvoice.contact_name, phone: c.phone, email: c.email }}
            defaultSubject={overdue ? `Tahsilat Hatırlatması - ${notifyInvoice.invoice_number}` : `Fatura Bildirimi - ${notifyInvoice.invoice_number}`}
            defaultMessage={overdue ? TEMPLATES.reminder(notifyInvoice) : TEMPLATES.invoice(notifyInvoice)}
            context="invoice"
            refId={notifyInvoice.id}
            initialFiles={notifyFiles}
            onClose={() => { setNotifyInvoice(null); setNotifyFiles([]); }}
          />
        );
      })()}

      {/* NEW INVOICE MODAL */}
      {showNewModal && (
        <DocumentFormModal
          as="form"
          onSubmit={handleCreateInvoice}
          testId="new-invoice-modal"
          maxWidthClass="max-w-7xl"
          panelClassName="text-xs"
          header={(
            <div>
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
              <div className="min-w-0 flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 truncate">{editingInvoice ? `Taslak Düzenle · ${editingInvoice.invoice_number}` : "Yeni Fatura Düzenle"}</h2>
                <span className="hidden sm:inline text-[10px] text-slate-400 truncate">E-Fatura & E-Arşiv</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {editingInvoice && (
                  <InvoiceCopyButton
                    invoice={editingInvoice}
                    onPickMode={(mode) => invoiceCopy.openPick(editingInvoice, mode)}
                    onCopied={onInvoiceCopied}
                  />
                )}
                <button type="button" onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="px-3 py-1.5 space-y-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setInvoiceInfoOpen((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 shrink-0"
                  data-testid="inv-info-toggle"
                  aria-expanded={invoiceInfoOpen}
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${invoiceInfoOpen ? "" : "-rotate-90"}`} />
                  Fatura bilgileri
                </button>
                {!invoiceInfoOpen && (
                  <div className="text-[11px] text-slate-500 truncate" data-testid="inv-info-summary">
                    {{ sales: "Satış", purchase: "Alış", proforma: "Proforma", return: "İade", dispatch: "İrsaliye" }[formData.invoice_type] || "Fatura"}
                    {" · "}
                    {{ e_invoice: "E-Fatura", e_archive: "E-Arşiv", e_export: "e-İhracat", e_dispatch: "E-İrsaliye", paper: "Kağıt" }[formData.e_type] || formData.e_type}
                    {formData.trade_kind === "export" ? " · İhracat" : formData.trade_kind === "import" ? " · İthalat" : ""}
                    {" · "}{formData.currency || "TRY"}
                    {" · "}{(formData.issue_date || "").slice(0, 10)}
                    {" · "}{(formData.status || "draft") === "draft" ? "Taslak" : "Onaylı"}
                    {formData.contact_name ? ` · ${formData.contact_name}` : ""}
                  </div>
                )}
              </div>
              {invoiceInfoOpen && (
              <div className="space-y-1.5" data-testid="inv-info-panel">
              <div className="flex flex-wrap items-end gap-1.5">
                <div className="w-[9.5rem] max-w-full">
                  <label className="block text-[10px] leading-tight font-semibold text-slate-500 mb-0.5">Fatura Türü</label>
                  <select
                    value={formData.invoice_type}
                    onChange={(e) => setFormData({ ...formData, invoice_type: e.target.value })}
                    className="w-full h-8 bg-white border border-slate-200 rounded-md px-2 text-xs font-medium"
                    data-testid="inv-type-select"
                  >
                    <option value="sales">Satış Faturası</option>
                    <option value="purchase">Alış Faturası</option>
                    <option value="proforma">Proforma Fatura</option>
                    <option value="return">İade Faturası</option>
                    <option value="dispatch">İrsaliye (Sevk)</option>
                  </select>
                </div>
                <div className="w-[10.5rem] max-w-full">
                  <label className="block text-[10px] leading-tight font-semibold text-slate-500 mb-0.5">E-Belge Türü</label>
                  <select
                    value={formData.e_type}
                    onChange={(e) => setFormData({ ...formData, e_type: e.target.value })}
                    className="w-full h-8 bg-white border border-slate-200 rounded-md px-2 text-xs font-medium"
                    data-testid="inv-etype-select"
                  >
                    <option value="e_invoice">E-Fatura (GİB Portal)</option>
                    <option value="e_archive">E-Arşiv Fatura</option>
                    <option value="e_export">e-İhracat</option>
                    <option value="e_dispatch">E-İrsaliye</option>
                    <option value="paper">Kağıt Fatura (Matbu)</option>
                  </select>
                </div>
                <div className="w-[7.5rem] max-w-full">
                  <label className="block text-[10px] leading-tight font-semibold text-slate-500 mb-0.5">Dış Ticaret</label>
                  <select
                    value={formData.trade_kind || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      const exportMode = v === "export";
                      setFormData({
                        ...formData,
                        trade_kind: v,
                        invoice_type: v === "import" ? "purchase" : (formData.invoice_type === "purchase" && v === "export" ? "sales" : formData.invoice_type),
                        e_type: exportMode ? (formData.e_type === "paper" ? "paper" : "e_export") : (formData.e_type === "e_export" ? "e_archive" : formData.e_type),
                        items: exportMode ? formData.items.map((it) => ({ ...it, vat_rate: 0 })) : formData.items,
                      });
                    }}
                    className="w-full h-8 bg-white border border-slate-200 rounded-md px-2 text-xs font-medium"
                    data-testid="inv-trade-kind"
                  >
                    <option value="">Yurt içi</option>
                    <option value="export">İhracat</option>
                    <option value="import">İthalat</option>
                  </select>
                </div>
                <FxPicker compact companyId={activeCompanyId(activeCompany)} date={formData.issue_date} currency={formData.currency} rate={formData.fx_rate} source={formData.fx_source} onChange={(p) => setFormData({ ...formData, ...p })} testId="inv-fx" />
                <div className="min-w-[12rem] flex-1">
                  <label className="block text-[10px] leading-tight font-semibold text-slate-500 mb-0.5">Tevkifat</label>
                  <select value={formData.withholding_rate ? `${formData.withholding_rate}|${formData.withholding_code}` : ""} onChange={(e) => { const [r, c] = e.target.value.split("|"); setFormData({ ...formData, withholding_rate: Number(r || 0), withholding_code: c || "" }); }} className="w-full h-8 bg-white border border-slate-200 rounded-md px-2 text-xs font-medium" data-testid="inv-withholding-select">
                    {WITHHOLDING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] leading-tight font-semibold text-slate-500 mb-0.5">Kayıt</label>
                  <div className="flex h-8 rounded-md border border-slate-300 overflow-hidden text-[11px] font-bold">
                    {[["draft", "Taslak"], ["approved", "Onaylı"]].map(([m, l]) => <button type="button" key={m} title={m === "approved" ? "Onaylı (cariye işle)" : "Taslak"} onClick={() => setFormData({ ...formData, status: m })} className={`px-2 ${(formData.status || "draft") === m ? (m === "draft" ? "bg-amber-500 text-white" : "bg-emerald-600 text-white") : "bg-white text-slate-500"}`} data-testid={`inv-status-${m}`}>{l}</button>)}
                  </div>
                </div>
                <button
                  type="button"
                  className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0"
                  title="KDV’siz / KDV’li birim fiyat, iskonto ve KDV oranı her satırda ayrı düzenlenir; tutarlar otomatik hesaplanır."
                  aria-label="Satır fiyatları"
                  data-testid="inv-line-price-hint"
                >
                  <CircleHelp className="w-3.5 h-3.5" />
                  <span className="sr-only">KDV’siz / KDV’li birim fiyat, iskonto ve KDV oranı her satırda ayrı düzenlenir; tutarlar otomatik hesaplanır.</span>
                </button>
              </div>
              {(formData.trade_kind === "export" || formData.trade_kind === "import") && (
                <div className="space-y-1.5 bg-sky-50 border border-sky-100 rounded-lg p-2" data-testid="inv-trade-row">
                  <div className="flex flex-wrap gap-1.5">
                    <div><label className="block font-semibold text-slate-700 mb-1">Teslim şekli</label><select value={formData.incoterm || ""} onChange={(e) => setFormData({ ...formData, incoterm: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-incoterm">{["", "EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"].map((x) => <option key={x || "yok"} value={x}>{x || "Seçin"}</option>)}</select></div>
                    <div><label className="block font-semibold text-slate-700 mb-1">Ülke</label><input value={formData.country || ""} onChange={(e) => setFormData({ ...formData, country: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-country" /></div>
                    <div><label className="block font-semibold text-slate-700 mb-1">Gümrük idaresi</label><input value={formData.customs_office || ""} onChange={(e) => setFormData({ ...formData, customs_office: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-customs" /></div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Rejim</label><input value={formData.regime_code || ""} onChange={(e) => setFormData({ ...formData, regime_code: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" placeholder="4000 / 1000" data-testid="inv-regime" /></div>
                    <div><label className="block font-semibold text-slate-700 mb-1">Beyanname no</label><input value={formData.declaration_no || ""} onChange={(e) => setFormData({ ...formData, declaration_no: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-declaration" /></div>
                    <div><label className="block font-semibold text-slate-700 mb-1">Beyanname tarihi</label><input type="date" value={formData.declaration_date || ""} onChange={(e) => setFormData({ ...formData, declaration_date: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-declaration-date" /></div>
                    {formData.trade_kind === "export" && <div><label className="block font-semibold text-slate-700 mb-1">DAB no</label><input value={formData.dab_no || ""} onChange={(e) => setFormData({ ...formData, dab_no: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-dab" /></div>}
                    <div><label className="block font-semibold text-slate-700 mb-1">Konşimento / AWB</label><input value={formData.bl_awb || ""} onChange={(e) => setFormData({ ...formData, bl_awb: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-bl" /></div>
                    <div><label className="block font-semibold text-slate-700 mb-1">Menşe belgesi</label><input value={formData.certificate || ""} onChange={(e) => setFormData({ ...formData, certificate: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" placeholder="ATR, EUR.1…" data-testid="inv-certificate" /></div>
                  </div>
                  {formData.trade_file_number && <div className="text-[11px] text-sky-800 font-semibold" data-testid="inv-trade-file">Gümrük dosyası: {formData.trade_file_number}</div>}
                </div>
              )}
              <div className="flex flex-wrap items-end gap-1.5" data-testid="inv-scenario-row">
                <div className="flex-[1.4] min-w-[220px]">
                  <label className="flex items-center justify-between text-[10px] leading-tight font-semibold text-slate-500 mb-0.5 gap-2">
                    <span>Cari</span>
                    <span className="flex items-center gap-2 normal-case">
                      {(formData.contact_id || formData.contact_name) && (
                        <button type="button" onClick={() => setContactFieldsOpen((v) => !v)} className="text-slate-500 hover:underline" data-testid="inv-contact-toggle">{contactFieldsOpen ? "Özet" : "Değiştir"}</button>
                      )}
                      <button type="button" onClick={() => setQuickContact((v) => !v)} className="text-emerald-700 hover:underline" data-testid="inv-new-contact-btn">+ Yeni cari</button>
                    </span>
                  </label>
                  {(contactFieldsOpen || !(formData.contact_id || formData.contact_name)) ? (
                    <ContactSearchSelect
                      companyId={activeCompanyId(activeCompany)}
                      value={formData.contact_id}
                      valueLabel={formData.contact_name || ""}
                      placeholder="Cari ara ve seç..."
                      onChange={(id, c) => {
                        setContactFieldsOpen(!id);
                        setFormData({
                          ...formData,
                          contact_id: id,
                          contact_name: c?.name || "",
                          contact_tax_id: c?.tax_number_or_id || "",
                          contact_tax_office: c?.tax_office || "",
                          shipping_address: c?.address || formData.shipping_address || "",
                          city: c?.city || formData.city || "",
                          customer_phone: c?.phone || formData.customer_phone || "",
                          e_type: c && formData.invoice_type === "sales" && !["paper", "e_export", "e_dispatch"].includes(formData.e_type) ? "e_archive" : formData.e_type,
                        });
                      }}
                      testId="inv-contact-select"
                      leadingAction={formData.invoice_type !== "purchase" ? {
                        label: "Perakende (carisiz)",
                        sub: "Cari seçmeden peşin satış — e-arşiv",
                        testId: "inv-retail-contact-option",
                        icon: <Store className="w-4 h-4 shrink-0 text-rose-700" />,
                        onSelect: pickRetailContact,
                      } : null}
                    />
                  ) : (
                    <button type="button" onClick={() => setContactFieldsOpen(true)} className="h-8 w-full truncate rounded-md border border-slate-200 bg-slate-50 px-2 text-left text-xs font-semibold text-slate-800" data-testid="inv-contact-summary">
                      {formData.contact_name || "Cari"}{formData.contact_tax_id ? ` · ${formData.contact_tax_id}` : ""}{formData.contact_tax_office ? ` · ${formData.contact_tax_office}` : ""}
                    </button>
                  )}
                </div>
                {(contactFieldsOpen || !(formData.contact_id || formData.contact_name)) && (
                  <>
                    <div className="w-[8.5rem]">
                      <label className="block text-[10px] leading-tight font-semibold text-slate-500 mb-0.5">VKN / TCKN</label>
                      <input
                        value={formData.contact_tax_id || ""}
                        onChange={(e) => setFormData({ ...formData, contact_tax_id: e.target.value })}
                        placeholder="VKN / TCKN"
                        className="w-full h-8 bg-white border border-slate-200 rounded-md px-2 text-xs font-mono"
                        data-testid="inv-contact-tax"
                      />
                    </div>
                    <div className="w-[9.5rem]">
                      <label className="block text-[10px] leading-tight font-semibold text-slate-500 mb-0.5">Vergi dairesi</label>
                      <input
                        value={formData.contact_tax_office || ""}
                        onChange={(e) => setFormData({ ...formData, contact_tax_office: e.target.value })}
                        placeholder="Vergi dairesi"
                        className="w-full h-8 bg-white border border-slate-200 rounded-md px-2 text-xs"
                        data-testid="inv-contact-tax-office"
                      />
                    </div>
                  </>
                )}
                {formData.invoice_type !== "purchase" && !formData.contact_id && (
                  <button
                    type="button"
                    onClick={pickRetailContact}
                    className="h-8 inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 text-[11px] font-bold text-rose-800 hover:bg-rose-100"
                    data-testid="inv-retail-contact-btn"
                  >
                    <Store className="w-3.5 h-3.5" /> Perakende
                  </button>
                )}
                <div className="w-[9.2rem]">
                  <label className="block text-[10px] leading-tight font-semibold text-slate-500 mb-0.5">Tarih</label>
                  <input
                    type="date"
                    value={formData.issue_date}
                    onChange={(e) => setFormData({ ...formData, issue_date: e.target.value })}
                    className="w-full h-8 bg-white border border-slate-200 rounded-md px-2 text-xs"
                    data-testid="inv-issue-date"
                  />
                </div>
                <div className="w-[12.5rem]">
                  <label className="block text-[10px] leading-tight font-semibold text-slate-500 mb-0.5">Saat</label>
                  <div className="flex gap-1">
                    <TimeInput
                      text24
                      step={1}
                      value={(formData.issue_time || "").slice(0, 8) || ""}
                      onChange={(e) => setFormData({ ...formData, issue_time: e.target.value })}
                      className="flex-1 min-w-0 h-8 bg-white border border-slate-200 rounded-md px-2 text-xs"
                      data-testid="inv-issue-time"
                    />
                    <button
                      type="button"
                      title="Şimdiki tarih ve saat"
                      onClick={() => setFormData({ ...formData, ...nowIssueDateTime() })}
                      className="shrink-0 h-8 inline-flex items-center gap-1 px-2 rounded-md border border-sky-200 bg-sky-50 text-sky-800 font-semibold hover:bg-sky-100"
                      data-testid="inv-now-btn"
                    >
                      <CalendarClock className="w-3.5 h-3.5" />
                      Şimdi
                    </button>
                  </div>
                </div>
                <div className="w-[9.2rem]">
                  <label className="block text-[10px] leading-tight font-semibold text-slate-500 mb-0.5">Vade</label>
                  <input
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full h-8 bg-white border border-slate-200 rounded-md px-2 text-xs"
                    data-testid="inv-due-date"
                  />
                </div>
                <div className="min-w-[9rem] flex-1">
                  <label className="block text-[10px] leading-tight font-semibold text-slate-500 mb-0.5">Proje</label>
                  <select value={formData.project_id || ""} onChange={(e) => { const id = e.target.value; const p = projects.find((x) => x.id === id); setFormData({ ...formData, project_id: id, project_number: p?.project_number || "" }); }} className="w-full h-8 bg-white border border-slate-200 rounded-md px-2 text-xs font-medium" data-testid="inv-project-select">
                    <option value="">— Projesiz —</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.project_number} · {p.name}</option>)}
                  </select>
                </div>
              </div>
              {quickContact && (
                <QuickContactForm companyId={activeCompanyId(activeCompany)} defaultType={formData.invoice_type === "purchase" ? "supplier" : "customer"} onCancel={() => setQuickContact(false)}
                  onCreated={(c) => { setContacts((prev) => [c, ...prev]); setContactFieldsOpen(false); setFormData((fd) => ({ ...fd, contact_id: c.id, contact_name: c.name, shipping_address: c.address || "", city: c.city || "", customer_phone: c.phone || "", e_type: fd.invoice_type === "sales" && !["paper", "e_export", "e_dispatch"].includes(fd.e_type) ? "e_archive" : fd.e_type })); setQuickContact(false); }} />
              )}
              <details className="rounded-md border border-slate-200 bg-white px-2 py-1">
                <summary className="cursor-pointer text-[11px] font-semibold text-slate-600">GİB’den getir</summary>
                <div className="pt-1.5">
                  <GibContactLookup companyId={activeCompanyId(activeCompany)} onSelect={(c, eType, meta) => { setContactFieldsOpen(false); setContacts((prev) => prev.some((x) => x.id === c.id) ? prev : [c, ...prev]); setFormData((f) => ({ ...f, contact_id: c.id, contact_name: c.name, contact_tax_id: c.tax_number_or_id || meta?.tax_id || f.contact_tax_id || "", contact_tax_office: c.tax_office || meta?.tax_office || f.contact_tax_office || "", shipping_address: c.address || f.shipping_address || "", city: c.city || f.city || "", customer_phone: c.phone || f.customer_phone || "", e_type: f.invoice_type === "sales" ? eType : f.e_type })); }} />
                </div>
              </details>
              </div>
              )}
              <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                <span className="font-bold text-slate-900">Kalemler</span>
                <ScanButton size="sm" onScan={handleScanAddItem} continuous title="Barkodla Kalem Ekle" label="Barkodla Ekle" />
              </div>
            </div>
            </div>
          )}

          footer={(
            <div className="px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-700 flex-1 min-w-0">
                <span>Mal/Hizmet <b className="text-slate-900">{money(totals.itemsSum)}</b></span>
                {totals.lineDiscount > 0 && <span className="text-rose-600">Satır iskonto <b>-{money(totals.lineDiscount)}</b></span>}
                <span className="inline-flex items-center gap-1" data-testid="general-discount-row">
                  <span>İskonto</span>
                  <span className="flex rounded border border-slate-300 overflow-hidden text-[10px] font-bold">
                    <button type="button" onClick={() => setGdMode("percent")} className={`px-1.5 py-0.5 ${gdMode === "percent" ? "bg-slate-900 text-white" : "bg-white text-slate-500"}`} data-testid="gd-mode-percent">%</button>
                    <button type="button" onClick={() => setGdMode("amount")} className={`px-1.5 py-0.5 ${gdMode === "amount" ? "bg-slate-900 text-white" : "bg-white text-slate-500"}`} data-testid="gd-mode-amount">₺</button>
                  </span>
                  <MoneyInput value={gdMode === "percent" ? (formData.general_discount_rate || "") : (formData.general_discount_amount || "")} onChange={(n) => setFormData({ ...formData, [gdMode === "percent" ? "general_discount_rate" : "general_discount_amount"]: n ?? "" })} placeholder="0" className="w-16 h-7 bg-white border border-rose-200 rounded px-1 text-right text-rose-700 font-semibold" data-testid="general-discount-input" />
                  <b className="text-rose-600">-{money(totals.gd)}</b>
                </span>
                <span>Ara <b>{money(totals.subtotal)}</b></span>
                <span>KDV <b data-testid="inv-vat-total">{money(totals.vat)}</b></span>
                {totals.withholding > 0 && <span className="text-indigo-700" data-testid="withholding-row">Tevkifat ({WITHHOLDING.find(([v]) => v.startsWith(`${formData.withholding_rate}|`))?.[1]?.split(" – ")[0]}) <b>-{money(totals.withholding)}</b></span>}
                <span className="font-bold text-slate-900">{totals.withholding > 0 ? "Ödenecek" : "Genel Toplam"} <b className="text-emerald-700" data-testid="inv-grand-total">{fmtMoney(totals.grandTotal, formData.currency || "TRY")}</b></span>
                {(formData.currency || "TRY") !== "TRY" && Number(formData.fx_rate) > 0 && (
                  <span className="text-slate-500" data-testid="inv-try-equivalent">TL <b>{fmtMoney(totals.grandTotal * Number(formData.fx_rate), "TRY")}</b></span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-auto">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="h-8 px-3 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-100"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold"
                  data-testid="save-invoice-btn"
                >
                  {(formData.status || "draft") === "draft" ? "Taslak Olarak Kaydet" : "Faturayı Kaydet & Onayla"}
                </button>
              </div>
            </div>
          )}
        >
              <div className="px-2 sm:px-3 py-1">
                <DocumentLineEditor
                  items={formData.items}
                  onChange={(items) => setFormData({ ...formData, items })}
                  products={products}
                  kind="invoice"
                  allowService
                  invoiceType={formData.invoice_type}
                  currency={formData.currency || "TRY"}
                  testIdPrefix="inv-item"
                  defaultVat={formData.trade_kind === "export" || formData.e_type === "e_export" ? 0 : 20}
                  getProductExtra={purchaseCostText}
                  renderRowExtra={(item, idx, { patch }) => {
                    const picked = !item.is_service && item.product_id ? products.find((p) => (p.id || p._id) === item.product_id) : null;
                    const costs = picked?.purchase_costs || [];
                    return (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-2">
                          <input value={item.gtip || ""} onChange={(e) => patch("gtip", e.target.value)} placeholder="GTIP" className="w-40 bg-white border border-slate-200 rounded p-1.5 font-mono text-[11px]" data-testid={`inv-item-gtip-${idx}`} />
                          <input value={item.origin_country || ""} onChange={(e) => patch("origin_country", e.target.value)} placeholder="Menşe ülke" className="w-40 bg-white border border-slate-200 rounded p-1.5 text-[11px]" data-testid={`inv-item-origin-${idx}`} />
                        </div>
                        {picked && (
                          <div className="flex flex-wrap items-center gap-1" data-testid={`inv-item-costs-${idx}`}>
                            <span className="text-[10px] font-semibold text-amber-800">Önceki alış:</span>
                            {Number(picked.purchase_price) > 0 && (
                              <button type="button" onClick={() => patch("unit_price", picked.purchase_price)} className="px-1.5 py-0.5 rounded-md bg-white border border-amber-200 text-[10px] text-amber-900 font-semibold" data-testid={`inv-item-cost-card-${idx}`} title="Stok kartı alış fiyatı">kart {moneyTry(picked.purchase_price)} ₺</button>
                            )}
                            {costs.length === 0 && !(Number(picked.purchase_price) > 0) && <span className="text-[10px] text-slate-400">kayıt yok</span>}
                            {costs.slice(0, 5).map((c, ci) => (
                              <button key={`${c.invoice_number}-${ci}`} type="button" onClick={() => patch("unit_price", c.unit_price)} className="px-1.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[10px] text-amber-900" data-testid={`inv-item-cost-${idx}-${ci}`} title={`${c.invoice_number || ""} ${c.supplier || ""}`.trim()}>
                                {c.date ? `${String(c.date).slice(8, 10)}.${String(c.date).slice(5, 7)} ` : ""}{moneyTry(c.unit_price)} ₺{c.supplier ? ` · ${c.supplier}` : ""}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <details className="mt-1 rounded-md border border-slate-200 bg-white px-2 py-1" data-testid="inv-notes-block">
                  <summary className="cursor-pointer text-[11px] font-semibold text-slate-600">Fatura notu{formData.notes ? " · dolu" : ""}</summary>
                  <textarea
                    rows={2}
                    value={formData.notes || ""}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Fatura altına yazılacak not / açıklama…"
                    className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-800"
                    data-testid="inv-notes-input"
                  />
                </details>
              </div>
        </DocumentFormModal>
      )}

      {/* OFFICIAL E-INVOICE PREVIEW MODAL */}
      {previewInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-8 space-y-6 shadow-2xl border border-slate-200 max-h-[95vh] overflow-y-auto" data-testid="invoice-preview-modal">
            {/* Header controls */}
            <div className="flex items-center justify-between border-b pb-3 no-print">
              <span className="text-xs font-semibold text-slate-500 uppercase">Resmi E-Belge Önizleme</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium"
                >
                  <Printer className="w-3.5 h-3.5" /> Yazdır / PDF
                </button>
                <button onClick={() => setPreviewInvoice(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Official E-Invoice Template */}
            <div className="p-6 border border-slate-300 rounded-xl space-y-6 text-slate-800 bg-white">
              <div className="flex justify-between items-start border-b pb-4">
                <div>
                  <div className="text-xl font-bold text-slate-900">{activeCompany?.name || "TamKobi A.Ş."}</div>
                  <div className="text-xs text-slate-500 max-w-sm mt-1">{activeCompany?.address || "İstanbul, Türkiye"}</div>
                  <div className="text-xs text-slate-600 mt-1">Vergi Dairesi: {activeCompany?.tax_office || "Kadıköy"} • VKN: {activeCompany?.tax_number || "6320984412"}</div>
                </div>
                <div className="text-right">
                  <div className="inline-block px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded">
                    {previewInvoice.e_type === 'expense_slip' ? 'GİDER PUSULASI' : previewInvoice.e_type === 'e_export' || previewInvoice.trade_kind === 'export' ? 'e-İHRACAT' : previewInvoice.e_type === 'e_invoice' ? 'E-FATURA' : previewInvoice.e_type === 'paper' ? 'FATURA' : previewInvoice.e_type === 'e_dispatch' ? 'E-İRSALİYE' : previewInvoice.trade_kind === 'import' ? 'İTHALAT FATURASI' : 'E-ARŞİV FATURA'}
                  </div>
                  <div className="font-mono text-xs font-bold mt-2 text-slate-900">{previewInvoice.invoice_number}</div>
                  <div className="text-xs text-slate-500">Tarih: {fmtDate(previewInvoice.issue_date)}</div>
                </div>
              </div>

              {/* Customer Info */}
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex justify-between items-start text-xs">
                <div>
                  <div className="text-slate-400 font-semibold uppercase text-[10px]">SAYIN (ALICI)</div>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">{previewInvoice.contact_name}</div>
                  <div className="text-slate-600 mt-1">VKN / TCKN: {previewInvoice.contact_tax_id || 'Belirtilmedi'}</div>
                  {(previewInvoice.incoterm || previewInvoice.country) && <div className="text-slate-600 mt-1">{previewInvoice.incoterm} {previewInvoice.country}{previewInvoice.customs_office ? ` · ${previewInvoice.customs_office}` : ""}</div>}
                  {(previewInvoice.declaration_no || previewInvoice.bl_awb || previewInvoice.dab_no || previewInvoice.trade_file_number) && (
                    <div className="text-slate-500 mt-1 text-[11px]">
                      {[previewInvoice.trade_file_number && `Dosya ${previewInvoice.trade_file_number}`, previewInvoice.declaration_no && `Bey. ${previewInvoice.declaration_no}`, previewInvoice.bl_awb && `BL ${previewInvoice.bl_awb}`, previewInvoice.dab_no && `DAB ${previewInvoice.dab_no}`, previewInvoice.certificate].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-slate-400 font-semibold uppercase text-[10px]">ETTN / GİB TAKİP NO</div>
                  <div className="font-mono text-xs font-bold text-indigo-700">{previewInvoice.gib_tracking_id || 'GIB-20260601-9872134'}</div>
                </div>
              </div>

              {/* Items Table */}
              <table className="w-full text-xs text-left">
                <thead className="border-b border-slate-300 text-slate-500 uppercase font-semibold">
                  <tr>
                    <th className="py-2">Hizmet / Ürün Açıklaması</th>
                    <th className="py-2 text-center">Miktar</th>
                    <th className="py-2 text-right">Birim (KDV'siz)</th>
                    <th className="py-2 text-right">Birim (KDV'li)</th>
                    <th className="py-2 text-center">KDV</th>
                    <th className="py-2 text-right">Tutar Hariç</th>
                    <th className="py-2 text-right">Tutar Dahil</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previewInvoice.items?.map((it, i) => (
                    <tr key={i}>
                      <td className="py-2.5 font-medium text-slate-900">{it.name}{it.gtip ? <div className="text-[10px] font-mono text-slate-400">GTIP {it.gtip}</div> : null}</td>
                      <td className="py-2.5 text-center">{it.quantity} {it.unit}</td>
                      <td className="py-2.5 text-right">{fmtMoney(it.unit_price, previewInvoice.currency)}</td>
                      <td className="py-2.5 text-right">{fmtMoney(it.unit_price_incl ?? (Number(it.unit_price || 0) * (1 + Number(it.vat_rate || 0) / 100)), previewInvoice.currency)}</td>
                      <td className="py-2.5 text-center">%{it.vat_rate}</td>
                      <td className="py-2.5 text-right font-semibold">{fmtMoney(it.total, previewInvoice.currency)}</td>
                      <td className="py-2.5 text-right font-bold">{fmtMoney(it.total_incl ?? (Number(it.total || 0) * (1 + Number(it.vat_rate || 0) / 100)), previewInvoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals & Barcode */}
              <div className="flex justify-between items-end border-t pt-4">
                <div className="space-y-2">
                  <BarcodeRenderer code={previewInvoice.invoice_number || "TA202600000104"} width={160} height={40} />
                  <div className="text-[10px] text-slate-400">Bu belge 5070 sayılı kanun uyarınca elektronik imzalanmıştır.</div>
                </div>
                <div className="w-64 space-y-1.5 text-xs text-right">
                  <div className="flex justify-between text-slate-600">
                    <span>Mal Hizmet Toplamı:</span>
                    <span>{fmtMoney(previewInvoice.subtotal, previewInvoice.currency)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Hesaplanan KDV:</span>
                    <span>{fmtMoney(previewInvoice.vat_total, previewInvoice.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-900 pt-1.5 border-t border-slate-300">
                    <span>Ödenecek Tutar:</span>
                    <span className="text-emerald-700">{fmtMoney(previewInvoice.grand_total, previewInvoice.currency || "TRY")}</span>
                  </div>
                  {(previewInvoice.currency || "TRY") !== "TRY" && previewInvoice.local_total != null && (
                    <div className="flex justify-between text-slate-500" data-testid="inv-preview-local-total">
                      <span>TL karşılığı (kur {Number(previewInvoice.fx_rate || 0).toLocaleString("tr-TR")}):</span>
                      <span className="font-semibold">{fmtMoney(previewInvoice.local_total, "TRY")}</span>
                    </div>
                  )}
                </div>
              </div>
              {canSendOutgoingDispatch(previewInvoice) && (
                <div className="pt-3 border-t no-print">
                  <button
                    type="button"
                    onClick={() => openDespatchSend(previewInvoice)}
                    className="px-4 py-2 bg-fuchsia-700 text-white rounded-xl text-xs font-semibold"
                    data-testid="dispatch-preview-send"
                  >
                    {despatchSendLabel(previewInvoice)}
                  </button>
                </div>
              )}
              {!isIncomingPurchaseInvoice(previewInvoice) && previewInvoice.invoice_type !== "dispatch" && previewInvoice.status !== "draft" && (
                <InvoiceActionPanel
                  className="mt-4"
                  invoiceId={previewInvoice.id || previewInvoice._id}
                  companyId={activeCompany?.id || activeCompany?._id || previewInvoice.company_id}
                  alreadyIssued={isGibIssued(previewInvoice)}
                  defaultEType={previewInvoice.e_type === "e_invoice" ? "e_invoice" : previewInvoice.e_type === "paper" ? "paper" : "e_archive"}
                  defaultScenario={(previewInvoice.gib_scenario || "").includes("TEMEL") ? "TEMEL" : "TICARI"}
                  onInvoiceCreated={() => { setPreviewInvoice(null); loadData(); }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {despatchTarget && (
        <DespatchSendDialog
          invoice={despatchTarget}
          defaults={einvoiceSettings?.despatch_defaults}
          fallbackAddress={contacts.find((c) => (c.id || c._id) === despatchTarget.contact_id)?.address || ""}
          onClose={() => setDespatchTarget(null)}
          onSubmit={submitDespatchSend}
        />
      )}

      {/* PAYMENT MODAL */}
      {paymentModalInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid="payment-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Tahsilat / Ödeme Girişi</h3>
              <button onClick={() => setPaymentModalInvoice(null)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-xs text-slate-600 space-y-3">
              <div>
                <span className="font-semibold text-slate-700">Fatura:</span> {paymentModalInvoice.invoice_number} ({paymentModalInvoice.contact_name})
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tahsilat/Ödeme Tutarı ({paymentModalInvoice.currency === "TRY" || !paymentModalInvoice.currency ? "₺" : paymentModalInvoice.currency})</label>
                <MoneyInput
                  value={paymentAmount}
                  onChange={(n) => setPaymentAmount(n ?? "")}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900 text-sm"
                  data-testid="payment-amount-input"
                />
                {(paymentModalInvoice.currency || "TRY") !== "TRY" && Number(paymentModalInvoice.fx_rate) > 0 && (
                  <div className="text-[11px] text-slate-500 mt-1">TL karşılığı ≈ {fmtMoney((Number(paymentAmount) || 0) * Number(paymentModalInvoice.fx_rate), "TRY")} (kur {Number(paymentModalInvoice.fx_rate).toLocaleString("tr-TR")})</div>
                )}
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{paymentModalInvoice.invoice_type === "sales" ? "Kasa / Banka / POS / Ortak (tahsilat)" : "Kasa / Banka / Kart / Ortak"}</label>
                <PaymentTargetSelect companyId={activeCompanyId(activeCompany)} accounts={bankAccounts} value={paymentAccount} onChange={setPaymentAccount} testId="payment-account-select" collectableOnly={paymentModalInvoice.invoice_type === "sales"} fetchAccounts={false} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                onClick={() => setPaymentModalInvoice(null)}
                className="px-3 py-1.5 border rounded-lg text-xs"
              >
                İptal
              </button>
              <button
                onClick={handleRecordPayment}
                className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                data-testid="confirm-payment-btn"
              >
                Ödemeyi Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

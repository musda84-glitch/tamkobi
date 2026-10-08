import React, { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { ScanButton } from "../components/CameraScanner";
import { toast } from "sonner";
import { InvoiceContextMenu, isIncomingPurchaseInvoice, isIncomingPurchasePending, incomingPurchaseResponse, isGibIssued, canDeleteInvoice, canCancelInvoice, canEditInvoice, canIssueInvoice, refreshInvoiceGibStatus, invoiceETypeLabel, displayInvoiceNumber, formatGibStatusLabel, canMatchIncomingProducts, unmatchedIncomingLineCount } from "../components/InvoiceContextMenu";
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
import { DocumentLineEditor } from "../components/DocumentLineEditor";
import { AiInvoiceImportModal } from "../components/AiInvoiceImportModal";
import { InvoiceToolbar, applyInvoiceFilters, DEFAULT_FILTERS, toggleInvoiceSort, invoiceSortCol, invoiceSortDir } from "../components/InvoiceToolbar";
import InvoiceActionPanel from "../components/InvoiceActionPanel";
import { ElektronikFaturaOnayModal } from "../components/ElektronikFaturaOnayModal";
import { SourceBadge } from "../components/SourceBadge";
import { QuickContactForm } from "../components/QuickContactForm";
import { INVOICE_ACTIONS_COL } from "../utils/invoiceTableLayout";
import { invoiceBulkNeedsSelection, bulkApiErrorDetail } from "../utils/invoiceBulkActions";
import { nowIssueDateTime } from "../utils/invoiceIssueNow";
import { FxPicker } from "../components/FxPicker";
import { TimeInput } from "../components/TimeInput";
import { fmtDate, fmtMoney, formatTrAmount } from "../utils/money";
import { computeLine, emptyLine, hydrateLine, invoiceMoneyTotals, lineFromProduct } from "../utils/documentLines";
import { cachedList, invoiceTypeFilter } from "../utils/dataSync";
import { WITHHOLDING_OPTIONS } from "../utils/invoiceWithholding";
import { useInfiniteRows } from "../hooks/useInfiniteRows";
import { InvoiceGibBar } from "../components/InvoiceGibBar";
import { isEinvoiceConfigured, supportsEDispatch } from "../utils/einvoiceIntegrator";
import { findRetailContact, invoiceFormPatchForRetail, retailContactCreatePayload } from "../utils/barcodeSale";

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
  FileCheck2, CheckCircle, XCircle, Trash2, Pencil, CalendarClock, Truck, RefreshCw, PackagePlus, Loader2 } from "lucide-react";
import { notifyDataChanged, useDataRefresh } from "../utils/dataRefresh";

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
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [invoices, setInvoices] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [products, setProducts] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [filterType, setFilterType] = useState(initialType);
  const [showCancelled, setShowCancelled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [einvoiceSettings, setEinvoiceSettings] = useState(null);
  const [gibBusy, setGibBusy] = useState("");

  // Modals
  const [showNewModal, setShowNewModal] = useState(false);
  const [showAiImport, setShowAiImport] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const contactFilter = searchParams.get("contact_id") || "";
  const visibleInvoices = useMemo(
    () => applyInvoiceFilters(
      invoices.filter((inv) => !contactFilter || inv.contact_id === contactFilter),
      { ...filters, showCancelled },
    ),
    [invoices, contactFilter, filters, showCancelled],
  );
  const visibleTotal = useMemo(() => visibleInvoices.reduce((t, i) => t + (Number(i.local_total || ((i.currency || "TRY") === "TRY" ? i.grand_total : 0)) || Number(i.grand_total) || 0), 0), [visibleInvoices]);
  const listResetKey = useMemo(() => `${filterType}|${contactFilter || ""}|${showCancelled ? 1 : 0}|${JSON.stringify(filters)}`, [filterType, contactFilter, showCancelled, filters]);
  const { visible: pagedInvoices, hasMore: invoicesHasMore, sentinelRef: invoicesSentinelRef } = useInfiniteRows(visibleInvoices, { resetKey: listResetKey });

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
  const [selected, setSelected] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [installmentInv, setInstallmentInv] = useState(null);
  const [expandedInvId, setExpandedInvId] = useState(null);
  const [expandedItemsById, setExpandedItemsById] = useState({});
  const [expandLoadingId, setExpandLoadingId] = useState(null);
  const [lineMatchBusy, setLineMatchBusy] = useState("");
  const closeCtx = React.useCallback(() => setCtxMenu(null), []);
  const openCtxFromButton = (e, inv) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setCtxMenu({ x: Math.max(8, r.right - 256), y: r.bottom + 4, inv });
  };
  const invRowId = (inv) => inv?.id || inv?._id || inv?.invoice_number;
  const toggleSel = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectedInvoices = () => visibleInvoices.filter((inv) => selected.includes(invRowId(inv)));
  const visibleSelIds = useMemo(
    () => visibleInvoices.map((inv) => invRowId(inv)).filter(Boolean),
    [visibleInvoices],
  );
  const allVisibleSelected = visibleSelIds.length > 0 && visibleSelIds.every((id) => selected.includes(id));
  const someVisibleSelected = visibleSelIds.some((id) => selected.includes(id));
  const toggleSelectAllVisible = () => setSelected(allVisibleSelected ? [] : visibleSelIds);
  const itemsForInv = (inv) => {
    const id = invRowId(inv);
    if (Array.isArray(inv?.items) && inv.items.length) return inv.items;
    if (Array.isArray(expandedItemsById[id])) return expandedItemsById[id];
    return [];
  };
  const toggleInvLines = async (inv) => {
    const id = invRowId(inv);
    if (!id) return;
    if (expandedInvId === id) {
      setExpandedInvId(null);
      return;
    }
    setExpandedInvId(id);
    const have = (Array.isArray(inv.items) && inv.items.length) || Array.isArray(expandedItemsById[id]);
    if (have) return;
    setExpandLoadingId(id);
    try {
      const url = inv._is_quote ? `${API_URL}/quotes/${id}` : `${API_URL}/invoices/${id}`;
      const r = await axios.get(url);
      const items = Array.isArray(r.data?.items) ? r.data.items : [];
      setExpandedItemsById((prev) => ({ ...prev, [id]: items }));
    } catch {
      toast.error("Kalemler yüklenemedi.");
      setExpandedItemsById((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setExpandLoadingId(null);
    }
  };

  const applyMatchedInvoice = (invId, invoice) => {
    if (!invoice) return;
    const items = Array.isArray(invoice.items) ? invoice.items : [];
    setExpandedItemsById((prev) => ({ ...prev, [invId]: items }));
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

  const loadEinvoiceSettings = useCallback(async () => {
    const cid = activeCompany?.id || activeCompany?._id;
    if (!cid) return;
    try {
      const r = await axios.get(`${API_URL}/einvoice/settings`, { params: { company_id: cid } });
      setEinvoiceSettings(r.data || null);
    } catch {
      setEinvoiceSettings(null);
    }
  }, [activeCompany]);

  useEffect(() => { loadEinvoiceSettings(); }, [loadEinvoiceSettings]);

  const pullGibIncoming = async () => {
    const cid = activeCompany?.id || activeCompany?._id;
    if (!cid) { toast.error("Firma seçin."); return; }
    setGibBusy("pull");
    try {
      const r = await axios.post(`${API_URL}/einvoice/incoming/sync`, null, { params: { company_id: cid, days: 14 } });
      toast.success(r.data?.message || "Gelen GİB kutusu çekildi.");
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
  const newParam = searchParams.get("new");
  const newContactParam = searchParams.get("contact_id");
  const newProjectParam = searchParams.get("project_id");
  const editParam = searchParams.get("edit");
  useEffect(() => {
    if (!newParam) return;
    if (newContactParam && contacts.length === 0) return;
    const c = contacts.find((x) => x.id === newContactParam);
    setFormData((fd) => ({
      ...fd,
      invoice_type: newParam === "purchase" ? "purchase" : "sales",
      e_type: newParam === "purchase" ? "paper" : (c?.is_e_invoice_user ? "e_invoice" : "e_archive"),
      contact_id: c?.id || fd.contact_id || "",
      contact_name: c?.name || fd.contact_name || "",
      shipping_address: c?.address || fd.shipping_address || "",
      city: c?.city || fd.city || "",
      customer_phone: c?.phone || fd.customer_phone || "",
      project_id: newProjectParam || fd.project_id || "",
    }));
    setShowNewModal(true);
    setSearchParams({}, { replace: true });
  }, [newParam, newContactParam, newProjectParam, contacts, setSearchParams]);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const cid = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
      const [invRows, cntRows, prodRows, bankRes, projRes, quoteRes] = await Promise.all([
        cachedList("invoices", cid, {
          filter: invoiceTypeFilter(filterType),
          // Proforma sekmesinde tekliflerle birleştiriyoruz; onCached yalnızca faturaları basmasın.
          onCached: filterType === "proforma" ? undefined : setInvoices,
        }),
        cachedList("contacts", cid, { onCached: setContacts }),
        cachedList("products", cid, { onCached: setProducts }),
        axios.get(`${API_URL}/banking/accounts?company_id=${cid}`),
        axios.get(`${API_URL}/projects?company_id=${cid}`),
        filterType === "proforma"
          ? axios.get(`${API_URL}/quotes`, { params: { company_id: cid, summary: 1 } }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
      ]);
      const quoteRows = filterType === "proforma" ? (quoteRes.data || []).map(quoteAsInvoiceRow) : [];
      setInvoices([...quoteRows, ...(invRows || [])]);
      setContacts(cntRows);
      setProducts(prodRows);
      setProjects(projRes.data);
      setBankAccounts(bankRes.data);
      if (bankRes.data.length > 0) setPaymentAccount(bankRes.data[0].id || bankRes.data[0]._id);
    } catch (err) {
      toast.error("Veriler yüklenirken hata oluştu.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeCompany, filterType]);
  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { setSelected([]); }, [listResetKey]);
  const refreshInvoicesSilent = useCallback(() => loadData({ silent: true }), [loadData]);
  useDataRefresh(refreshInvoicesSilent, { companyId, scopes: ["cash", "invoices", "contacts"] });

  const handleScanAddItem = (code) => {
    const c = String(code || "").trim();
    const prod = products.find((p) => p.barcode === c || p.sku === c || (p.variants || []).some((v) => v.barcode === c));
    if (!prod) { toast.error(`Barkod eşleşmedi: ${c}`); return; }
    const pid = prod.id || prod._id;
    const existing = formData.items.findIndex((it) => it.product_id === pid);
    if (existing >= 0) {
      const items = formData.items.map((it, i) => (i === existing ? computeLine({ ...it, quantity: Number(it.quantity || 0) + 1 }, "quantity") : it));
      setFormData({ ...formData, items });
      toast.success(`${prod.name} miktarı +1`);
      return;
    }
    const emptyIdx = formData.items.findIndex((it) => !it.product_id && !it.name && !it.product_name);
    const v = (prod.variants || []).find((x) => x.barcode === c || x.sku === c);
    const price = v?.price || v?.sale_price || buyPrice(prod, formData.invoice_type);
    const priceIncl = formData.invoice_type !== "purchase" && !!prod.price_includes_vat;
    const line = computeLine({
      ...lineFromProduct(prod, { invoiceType: formData.invoice_type }),
      name: v ? `${prod.name} - ${v.name}` : prod.name,
      product_name: v ? `${prod.name} - ${v.name}` : prod.name,
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
    toast.success(`${prod.name} eklendi`);
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
    setEditingInvoice(inv);
    setGdMode(inv.general_discount_rate ? "percent" : "amount");
    setFormData((fd) => ({
      ...fd,
      invoice_type: inv.invoice_type || "sales",
      e_type: inv.e_type || "paper",
      status: "draft",
      contact_id: inv.contact_id || "",
      contact_name: inv.contact_name || "",
      shipping_address: inv.shipping_address || inv.address || "",
      city: inv.city || "",
      customer_phone: inv.customer_phone || "",
      issue_date: (inv.issue_date || "").slice(0, 10),
      issue_time: (inv.issue_time || "").slice(0, 8) || nowIssueDateTime().issue_time,
      due_date: (inv.due_date || "").slice(0, 10),
      notes: inv.notes || "",
      withholding_rate: inv.withholding_rate || 0,
      withholding_code: inv.withholding_code || "",
      price_mode: inv.price_mode || "excl",
      general_discount_rate: inv.general_discount_rate || 0,
      general_discount_amount: inv.general_discount_amount || 0,
      currency: inv.currency || "TRY",
      fx_rate: inv.fx_rate || 1,
      fx_source: inv.fx_source || "try",
      trade_kind: inv.trade_kind || "",
      incoterm: inv.incoterm || "",
      country: inv.country || "",
      customs_office: inv.customs_office || "",
      project_id: inv.project_id || "",
      regime_code: inv.regime_code || "",
      declaration_no: inv.declaration_no || "",
      declaration_date: inv.declaration_date || "",
      dab_no: inv.dab_no || "",
      bl_awb: inv.bl_awb || "",
      certificate: inv.certificate || "",
      trade_file_number: inv.trade_file_number || "",
      items: (inv.items || []).map((it) => hydrateLine({ ...it, is_service: it.is_service || !it.product_id })),
    }));
    setShowNewModal(true);
  }, []);

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
          return next;
        }, { replace: true });
      } catch {
        if (!cancelled) toast.error("Taslak fatura açılamadı.");
      }
    };
    openFromId();
    return () => { cancelled = true; };
    // One-shot deep link from teklif → fatura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam]);

  const handleDeleteInvoice = async (inv) => {
    const isDisp = inv.invoice_type === "dispatch" || inv.e_type === "e_dispatch";
    const kind = isDisp ? (inv.status === "draft" ? "taslak irsaliye" : "irsaliye") : (inv.status === "draft" ? "taslak fatura" : "kağıt fatura");
    if (!window.confirm(`${inv.invoice_number} numaralı ${kind} çöp kutusuna taşınsın mı?`)) return;
    try { const r = await axios.delete(`${API_URL}/invoices/${inv.id}`); toast.success(r.data.message); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
  };
  const handleCancelInvoice = async (inv) => {
    const isDisp = inv.invoice_type === "dispatch" || inv.e_type === "e_dispatch";
    if (!window.confirm(isDisp
      ? `${inv.invoice_number} numaralı e-irsaliye iptal edilsin mi?\nKayıt iptal edilir; bağlı sipariş irsaliye bağı kopar.`
      : `${inv.invoice_number} numaralı e-fatura iptal edilsin mi?\nCari bakiyesi ve stok etkileri geri alınır; bağlı siparişler silinebilir hale gelir. İptal kaydı listeden gizlenir.`)) return;
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
        const company_id = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
        const r = await axios.post(`${API_URL}/contacts`, retailContactCreatePayload(company_id));
        contact = r.data;
        setContacts((prev) => [contact, ...prev]);
      }
      setFormData((fd) => ({ ...fd, ...invoiceFormPatchForRetail(contact, fd) }));
      toast.success("Perakende (carisiz) seçildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Perakende cari oluşturulamadı.");
    }
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
      const payload = {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
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
      if (editingInvoice) {
        const { company_id, invoice_type, gib_status, ...upd } = payload;
        await axios.put(`${API_URL}/invoices/${editingInvoice.id}`, { ...upd, invoice_type });
        if (payload.status === "approved") await axios.post(`${API_URL}/invoices/${editingInvoice.id}/approve`);
        toast.success("Taslak fatura güncellendi.");
        setEditingInvoice(null);
      } else {
      await axios.post(`${API_URL}/invoices`, payload);
      toast.success(payload.status === "draft" ? "Fatura taslak olarak kaydedildi." : "Fatura başarıyla oluşturuldu ve cariye işlendi.");
      }
      setShowNewModal(false);
      loadData();
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
      const res = await axios.post(`${API_URL}/invoices/${invId}/send-to-gib`, body);
      if (!opts.silentToast) toast.success(res.data.message);
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

  const handleIssueFromMenu = (inv, eType) => {
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

  const downloadInvoiceXmlBulk = async (list) => {
    const ids = [...new Set(list.map((o) => o.id || o._id).filter(Boolean))];
    if (!ids.length) { toast.error("Seçili faturalarda e-belge yok."); return; }
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        let r;
        try {
          r = await axios.get(`${API_URL}/e-invoice/${id}/xml`, { responseType: "blob" });
        } catch (firstErr) {
          r = await axios.get(`${API_URL}/invoices/${id}/xml`, { responseType: "blob" });
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
      } catch {
        fail++;
      }
    }
    toast[fail && !ok ? "error" : fail ? "error" : "success"](`${ok} XML indirildi${fail ? `, ${fail} hata` : ""}.`);
  };

  const bulk = async (action) => {
    if (invoiceBulkNeedsSelection(action) && !selected.length) {
      toast.error("Fatura seçin.");
      return;
    }
    const list = selectedInvoices();

    if (action === "refresh") {
      setBulkBusy(true);
      try {
        const targets = list.length ? list : visibleInvoices.filter((inv) => inv.gib_uuid || inv.gib_tracking_id).slice(0, 40);
        if (!targets.length) {
          toast.info("Güncellenecek GİB belgesi yok.");
          return;
        }
        let ok = 0;
        for (const inv of targets) {
          try {
            await refreshInvoiceGibStatus(API_URL, inv);
            ok++;
          } catch { /* devam */ }
        }
        await loadData({ silent: true });
        toast.success(`${ok} belgenin GİB durumu güncellendi.`);
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
      const issuable = list.filter((inv) => canIssueInvoice(inv) && !isIncomingPurchaseInvoice(inv));
      if (!issuable.length) {
        toast.info("Seçili faturalarda e-belge gönderilecek uygun kayıt yok.");
        return;
      }
      setEFaturaJob({ mode: "send", invoices: issuable });
      return;
    }
    if (action === "xml") {
      await downloadInvoiceXmlBulk(list);
      return;
    }
    if (action === "invoice_date") {
      const date = window.prompt("Yeni fatura tarihi (YYYY-AA-GG)", new Date().toISOString().slice(0, 10));
      if (!date) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error("Tarih YYYY-AA-GG olmalı."); return; }
      let ok = 0, fail = 0, firstErr = "";
      for (const inv of list) {
        try {
          await axios.put(`${API_URL}/invoices/${inv.id || inv._id}`, { issue_date: date });
          ok++;
        } catch (err) {
          fail++;
          if (!firstErr) firstErr = bulkApiErrorDetail(err);
        }
      }
      toast[fail ? "error" : "success"](`${ok} faturanın tarihi güncellendi${fail ? `, ${fail} değiştirilemedi${firstErr ? `: ${firstErr}` : ""}` : ""}.`);
      loadData();
      return;
    }
    if (action === "invoice_link") {
      const ready = list.filter((inv) => {
        const c = contacts.find((x) => x.id === inv.contact_id);
        return inv.id && (inv.contact_email || c?.email);
      });
      if (!ready.length) { toast.error("E-posta adresi olan fatura seçin."); return; }
      let ok = 0, fail = 0;
      for (const inv of ready) {
        try {
          const c = contacts.find((x) => x.id === inv.contact_id) || {};
          const to = inv.contact_email || c.email;
          const fd = new FormData();
          const link = `${window.location.origin}/api/invoices/${inv.id || inv._id}/pdf`;
          fd.append("company_id", companyId);
          fd.append("to", to);
          fd.append("subject", `Faturanız ${inv.invoice_number}`);
          fd.append("body", `Sayın ${inv.contact_name || ""},\n\n${inv.invoice_number} numaralı faturanız: ${link}`);
          fd.append("context", "invoice");
          fd.append("ref_id", inv.id || inv._id);
          fd.append("contact_id", inv.contact_id || "");
          fd.append("contact_name", inv.contact_name || "");
          await axios.post(`${API_URL}/comm/mail/send`, fd);
          ok++;
        } catch { fail++; }
      }
      toast[fail ? "error" : "success"](`${ok} fatura linki gönderildi${fail ? `, ${fail} hata` : ""}.`);
      return;
    }
    if (action === "delete") {
      const deletable = list.filter((inv) => canDeleteInvoice(inv));
      if (!deletable.length) { toast.error("Silinebilir (taslak/kağıt) fatura seçin."); return; }
      if (!canDeleteInv) { toast.error("Silme yetkiniz yok."); return; }
      if (!window.confirm(`${deletable.length} fatura çöp kutusuna taşınsın mı?`)) return;
      setBulkBusy(true);
      let ok = 0, fail = 0;
      for (const inv of deletable) {
        try {
          await axios.delete(`${API_URL}/invoices/${inv.id || inv._id}`);
          ok++;
        } catch { fail++; }
      }
      setBulkBusy(false);
      toast[fail ? "error" : "success"](`${ok} fatura silindi${fail ? `, ${fail} hata` : ""}.`);
      setSelected([]);
      loadData();
      return;
    }
    if (action === "cancel") {
      const open = list.filter((inv) => canCancelInvoice(inv));
      if (!open.length) { toast.info("İptal edilebilir fatura yok."); return; }
      if (!window.confirm(`${open.length} fatura iptal edilsin mi?`)) return;
    }

    setBulkBusy(true);
    let ok = 0, fail = 0, skipped = 0, firstErr = "";
    for (const inv of list) {
      try {
        if (action === "approve") {
          if (inv.status !== "draft" || isIncomingPurchaseInvoice(inv)) { skipped++; continue; }
          await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/approve`);
        } else if (action === "cancel") {
          if (!canCancelInvoice(inv)) { skipped++; continue; }
          await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/cancel`, {});
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
    if (!ok && !fail) toast.info(skipped ? "Seçili faturalarda bu işlem için uygun kayıt yok." : "İşlenecek fatura yok.");
    else toast[fail ? "error" : "success"](`${ok} fatura işlendi${fail ? `, ${fail} hata${firstErr ? `: ${firstErr}` : ""}` : ""}${skipped ? `, ${skipped} atlandı` : ""}.`);
    setSelected([]);
    loadData();
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
        count={visibleInvoices.length}
        total={visibleTotal}
        hidePay={filterType === "dispatch"}
        rows={visibleInvoices}
        selectedCount={selected.length}
        bulkBusy={bulkBusy}
        onBulkAction={bulk}
      />

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        {contactFilter && (
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border-b border-emerald-100 text-xs" data-testid="contact-filter-chip">
            <span className="text-emerald-800">Cari filtresi: <b>{contacts.find((c) => c.id === contactFilter)?.name || invoices.find((i) => i.contact_id === contactFilter)?.contact_name || contactFilter}</b> ({invoices.filter((i) => i.contact_id === contactFilter).length} fatura)</span>
            <button onClick={() => navigate("/invoices")} className="ml-auto px-2 py-0.5 rounded-full bg-white border border-emerald-200 text-emerald-700 font-semibold hover:bg-emerald-100" data-testid="clear-contact-filter-btn">Filtreyi Kaldır</button>
          </div>
        )}
        <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-50/70 border-b border-slate-100 text-[11px] text-slate-500" data-testid="ctx-hint">
          <MousePointerClick className="w-3.5 h-3.5 text-emerald-600" /> İpucu: Satış faturasını satırdaki <b>⋮</b> menüden E-Fatura / E-Arşiv / Kağıt olarak kesebilirsiniz. GİB'den gelen alış e-faturaları kesilmez; <b>Onayla</b> veya <b>Reddet</b> kullanılır. Boş alana sağ tık hızlı menüyü açar.
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
                    checked={allVisibleSelected}
                    ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
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
                pagedInvoices.map((inv) => {
                  const rowId = invRowId(inv);
                  const linesOpen = expandedInvId === rowId;
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
                            <SourceBadge channel={inv.source_channel} testId={`inv-source-${inv.invoice_number}`} />
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded uppercase" data-testid={`inv-etype-badge-${inv.invoice_number}`}>
                              {invoiceETypeLabel(inv)}
                            </span>
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
                        inv.payment_status === "paid"
                          ? "bg-emerald-100 text-emerald-800"
                          : inv.payment_status === "partially_paid"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-rose-100 text-rose-800"
                      }`}>
                        {inv.payment_status === "paid" ? "Ödendi" : inv.payment_status === "partially_paid" ? "Kısmi Ödendi" : "Cariye işlendi"}
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
                          return (
                            <div
                              className="flex flex-wrap items-center justify-center gap-1.5"
                              data-testid={`inv-actions-${inv.invoice_number}`}
                            >
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
                                  if (shouldUseIntegratorPdf("invoice", inv)) setPrintInv(inv);
                                  else setPreviewInvoice(inv);
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
                        return (
                      <div className="grid grid-cols-[repeat(8,1.75rem)] gap-1 justify-center justify-items-center items-center mx-auto" data-testid={`inv-actions-${inv.invoice_number}`}>
                        {inv.status === "draft" ? (
                          <button onClick={async () => { if (!window.confirm(`${inv.invoice_number} onaylansın mı? Cari bakiyesi ve stok işlenecek.`)) return; try { const r = await axios.post(`${API_URL}/invoices/${inv.id}/approve`); toast.success(r.data.message); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "Onaylanamadı."); } }} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Taslağı onayla (bakiye + stok işlenir)" data-testid={`approve-inv-btn-${inv.invoice_number}`}><CheckCircle className="w-4 h-4" /></button>
                        ) : <span className="w-7 h-7" aria-hidden="true" />}
                        <button
                          onClick={() => setPreviewInvoice(inv)}
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
                          <button onClick={() => handleConvertDispatch(inv)} disabled={!!inv.converted_invoice_id} className="p-1.5 text-fuchsia-600 hover:text-fuchsia-800 hover:bg-fuchsia-50 rounded-lg transition disabled:opacity-30" title={inv.converted_invoice_id ? "Faturalandı" : (inv.invoice_ref_number || inv.invoice_id) ? "Mevcut faturaya bağla" : "İrsaliyeyi Faturaya Dönüştür"} data-testid={`dispatch-convert-btn-${inv.invoice_number}`}><FileCheck2 className="w-4 h-4" /></button>
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
                        );
                      })()}
                    </td>
                  </tr>
                  {linesOpen && (
                    <tr className="bg-slate-50/80" data-testid={`inv-lines-row-${inv.invoice_number}`}>
                      <td colSpan={8} className="px-4 py-3 border-t border-slate-100">
                        {linesLoading ? (
                          <div className="text-[11px] text-slate-400 pl-6">Kalemler yükleniyor…</div>
                        ) : lineItems.length === 0 ? (
                          <div className="text-[11px] text-slate-400 pl-6" data-testid={`inv-lines-empty-${inv.invoice_number}`}>Bu belgede kalem yok.</div>
                        ) : (
                          <div className="pl-6 space-y-2 overflow-x-auto">
                            {canMatchIncomingProducts(inv) && unmatchedIncomingLineCount(lineItems) > 0 && (
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
                            )}
                            <table className="w-full text-[11px] text-slate-600" data-testid={`inv-lines-table-${inv.invoice_number}`}>
                              <thead>
                                <tr className="text-slate-400 uppercase text-[10px]">
                                  <th className="py-1 pr-3 text-left font-semibold">Ürün / Hizmet</th>
                                  <th className="py-1 px-2 text-center font-semibold w-20">Miktar</th>
                                  <th className="py-1 px-2 text-right font-semibold w-28">Birim</th>
                                  <th className="py-1 px-2 text-center font-semibold w-14">KDV</th>
                                  <th className="py-1 px-2 text-right font-semibold w-28">Tutar</th>
                                  {canMatchIncomingProducts(inv) && (
                                    <th className="py-1 pl-2 text-left font-semibold w-64">Stok Kartı</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {lineItems.map((it, i) => (
                                  <tr key={i} data-testid={`inv-line-${inv.invoice_number}-${i}`}>
                                    <td className="py-1.5 pr-3 font-medium text-slate-800">{it.name || it.description || "—"}{it.sku ? <span className="ml-1.5 font-mono text-[10px] text-slate-400">{it.sku}</span> : null}</td>
                                    <td className="py-1.5 px-2 text-center whitespace-nowrap">{it.quantity} {it.unit || ""}</td>
                                    <td className="py-1.5 px-2 text-right whitespace-nowrap">{fmtMoney(it.unit_price, inv.currency || "TRY")}</td>
                                    <td className="py-1.5 px-2 text-center">%{it.vat_rate ?? 0}</td>
                                    <td className="py-1.5 px-2 text-right font-semibold text-slate-900 whitespace-nowrap">{fmtMoney(it.total_incl ?? it.total, inv.currency || "TRY")}</td>
                                    {canMatchIncomingProducts(inv) && (
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
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
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
        {invoicesHasMore && (
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
        onPreview={(inv) => {
          // GİB'e iletilmiş e-belge: yerel şablon yerine entegratör PDF (İşNet)
          if (shouldUseIntegratorPdf("invoice", inv)) {
            setPrintInv(inv);
            return;
          }
          setPreviewInvoice(inv);
        }}
        onPrint={setPrintInv}
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
      {eFaturaJob && (
        <ElektronikFaturaOnayModal
          mode={eFaturaJob.mode || "send"}
          invoice={eFaturaJob.invoice || null}
          invoices={eFaturaJob.invoices || (eFaturaJob.invoice ? [eFaturaJob.invoice] : [])}
          contacts={contacts}
          companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}
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
            const { eType, scenario, alias, withholding, returnRef, exemption, stampNow } = payload;

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
              if (!invId || !canIssueInvoice(inv) || isIncomingPurchaseInvoice(inv)) {
                skipped++;
                if (invId) ctx?.setItem?.(invId, { status: "skipped", detail: "Gönderime uygun değil" });
                continue;
              }
              ctx?.setItem?.(invId, { status: "running", detail: "Hazırlanıyor…" });
              try {
                if (alias && inv.contact_id && docs.length === 1) {
                  try {
                    await axios.put(`${API_URL}/contacts/${inv.contact_id}`, {
                      e_invoice_alias: alias,
                      is_e_invoice_user: eType === "e_invoice",
                    });
                  } catch { /* gönderim yine denenecek */ }
                }
                const patch = {};
                if (stampNow && docs.length === 1) {
                  Object.assign(patch, nowIssueDateTime());
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
                  await axios.put(`${API_URL}/invoices/${invId}`, patch);
                }
                ctx?.setStep?.("send", "active", docs.length > 1 ? `${inv.invoice_number || invId}` : "");
                ctx?.setItem?.(invId, { status: "running", detail: "GİB’e gönderiliyor…" });
                const sent = await handleSendToGib(invId, eType, {
                  scenario,
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
      {installmentInv && <InstallmentPlanModal doc={installmentInv} kind="invoice" accounts={bankAccounts} companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setInstallmentInv(null)} onChanged={loadData} />}
      {printInv && printInv.e_type === "expense_slip" && (
        <ExpenseSlipPrint doc={printInv} company={activeCompany} onClose={() => setPrintInv(null)} />
      )}
      {printInv && printInv.e_type !== "expense_slip" && (
        <PrintDocument docType="invoice" doc={printInv} company={activeCompany} onClose={() => setPrintInv(null)} onEditTemplate={() => setEditTpl(true)} />
      )}
      {editTpl && <PrintTemplateEditor companyId={activeCompany?.id || "comp_nexus_main_01"} docType="invoice" onClose={() => setEditTpl(false)} />}
      {notifyInvoice && (() => {
        const c = contacts.find(cnt => cnt.id === notifyInvoice.contact_id) || {};
        const overdue = notifyInvoice.payment_status !== 'paid';
        return (
          <QuickMessageModal
            companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}
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
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-7xl w-full p-6 sm:p-8 space-y-5 shadow-2xl border border-slate-200 max-h-[94vh] overflow-y-auto" data-testid="new-invoice-modal">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{editingInvoice ? `Taslak Düzenle · ${editingInvoice.invoice_number}` : "Yeni Fatura Düzenle"}</h2>
                <p className="text-xs text-slate-500">E-Fatura & E-Arşiv Standartlarına Uygun</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {editingInvoice && (
                  <InvoiceCopyButton
                    invoice={editingInvoice}
                    onPickMode={(mode) => invoiceCopy.openPick(editingInvoice, mode)}
                    onCopied={onInvoiceCopied}
                  />
                )}
                <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleCreateInvoice} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Fatura Türü</label>
                  <select
                    value={formData.invoice_type}
                    onChange={(e) => setFormData({ ...formData, invoice_type: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                    data-testid="inv-type-select"
                  >
                    <option value="sales">Satış Faturası</option>
                    <option value="purchase">Alış Faturası</option>
                    <option value="proforma">Proforma Fatura</option>
                    <option value="return">İade Faturası</option>
                    <option value="dispatch">İrsaliye (Sevk)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">E-Belge Türü</label>
                  <select
                    value={formData.e_type}
                    onChange={(e) => setFormData({ ...formData, e_type: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                    data-testid="inv-etype-select"
                  >
                    <option value="e_invoice">E-Fatura (GİB Portal)</option>
                    <option value="e_archive">E-Arşiv Fatura</option>
                    <option value="e_export">e-İhracat</option>
                    <option value="e_dispatch">E-İrsaliye</option>
                    <option value="paper">Kağıt Fatura (Matbu)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Dış Ticaret</label>
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
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                    data-testid="inv-trade-kind"
                  >
                    <option value="">Yurt içi</option>
                    <option value="export">İhracat</option>
                    <option value="import">İthalat</option>
                  </select>
                </div>
                <div>
                  <FxPicker companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} date={formData.issue_date} currency={formData.currency} rate={formData.fx_rate} source={formData.fx_source} onChange={(p) => setFormData({ ...formData, ...p })} testId="inv" rateTestId="inv-fx-rate" />
                </div>
              </div>
              {(formData.trade_kind === "export" || formData.trade_kind === "import") && (
                <div className="space-y-3 bg-sky-50 border border-sky-100 rounded-xl p-3" data-testid="inv-trade-row">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div><label className="block font-semibold text-slate-700 mb-1">Teslim şekli</label><select value={formData.incoterm || ""} onChange={(e) => setFormData({ ...formData, incoterm: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-incoterm">{["", "EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"].map((x) => <option key={x || "yok"} value={x}>{x || "Seçin"}</option>)}</select></div>
                    <div><label className="block font-semibold text-slate-700 mb-1">Ülke</label><input value={formData.country || ""} onChange={(e) => setFormData({ ...formData, country: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-country" /></div>
                    <div><label className="block font-semibold text-slate-700 mb-1">Gümrük idaresi</label><input value={formData.customs_office || ""} onChange={(e) => setFormData({ ...formData, customs_office: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-customs" /></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div><label className="block font-semibold text-slate-700 mb-1">Rejim</label><input value={formData.regime_code || ""} onChange={(e) => setFormData({ ...formData, regime_code: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" placeholder="4000 / 1000" data-testid="inv-regime" /></div>
                    <div><label className="block font-semibold text-slate-700 mb-1">Beyanname no</label><input value={formData.declaration_no || ""} onChange={(e) => setFormData({ ...formData, declaration_no: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-declaration" /></div>
                    <div><label className="block font-semibold text-slate-700 mb-1">Beyanname tarihi</label><input type="date" value={formData.declaration_date || ""} onChange={(e) => setFormData({ ...formData, declaration_date: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-declaration-date" /></div>
                    {formData.trade_kind === "export" && <div><label className="block font-semibold text-slate-700 mb-1">DAB no</label><input value={formData.dab_no || ""} onChange={(e) => setFormData({ ...formData, dab_no: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-dab" /></div>}
                    <div><label className="block font-semibold text-slate-700 mb-1">Konşimento / AWB</label><input value={formData.bl_awb || ""} onChange={(e) => setFormData({ ...formData, bl_awb: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-bl" /></div>
                    <div><label className="block font-semibold text-slate-700 mb-1">Menşe belgesi</label><input value={formData.certificate || ""} onChange={(e) => setFormData({ ...formData, certificate: e.target.value })} className="w-full bg-white border border-slate-200 rounded-lg p-2" placeholder="ATR, EUR.1…" data-testid="inv-certificate" /></div>
                  </div>
                  {formData.trade_file_number && <div className="text-[11px] text-sky-800 font-semibold" data-testid="inv-trade-file">Gümrük dosyası: {formData.trade_file_number}</div>}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3" data-testid="inv-scenario-row">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Tevkifat (Hizmet Faturası)</label>
                    <select value={formData.withholding_rate ? `${formData.withholding_rate}|${formData.withholding_code}` : ""} onChange={(e) => { const [r, c] = e.target.value.split("|"); setFormData({ ...formData, withholding_rate: Number(r || 0), withholding_code: c || "" }); }} className="w-full bg-white border border-slate-200 rounded-lg p-2 font-medium" data-testid="inv-withholding-select">
                      {WITHHOLDING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Satır fiyatları</label>
                    <p className="text-[11px] text-slate-500 leading-snug bg-white border border-slate-200 rounded-lg p-2" data-testid="inv-line-price-hint">
                      KDV’siz / KDV’li birim fiyat, iskonto ve KDV oranı her satırda ayrı düzenlenir; tutarlar otomatik hesaplanır.
                    </p>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Kayıt Durumu</label>
                    <div className="flex rounded-lg border border-slate-300 overflow-hidden text-[11px] font-bold">
                      {[["draft", "Taslak"], ["approved", "Onaylı (cariye işle)"]].map(([m, l]) => <button type="button" key={m} onClick={() => setFormData({ ...formData, status: m })} className={`flex-1 py-2 ${(formData.status || "draft") === m ? (m === "draft" ? "bg-amber-500 text-white" : "bg-emerald-600 text-white") : "bg-white text-slate-500"}`} data-testid={`inv-status-${m}`}>{l}</button>)}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="flex items-center justify-between font-semibold text-slate-700 mb-1 gap-2 flex-wrap">
                    <span>Cari Seçin</span>
                    <button type="button" onClick={() => setQuickContact((v) => !v)} className="text-emerald-700 hover:underline font-semibold" data-testid="inv-new-contact-btn">+ Yeni cari ekle</button>
                  </label>
                  <SearchSelect
                    value={formData.contact_id}
                    valueLabel={formData.contact_name || ""}
                    options={contacts}
                    placeholder="Cari ara ve seç..."
                    getLabel={(c) => c.name}
                    getSub={(c) => `${c.type === 'customer' ? 'Müşteri' : c.type === 'supplier' ? 'Tedarikçi' : 'Müşteri & Tedarikçi'} • VKN ${c.tax_number_or_id}`}
                    onChange={(id, c) => setFormData({
                      ...formData,
                      contact_id: id,
                      contact_name: c?.name || "",
                      shipping_address: c?.address || formData.shipping_address || "",
                      city: c?.city || formData.city || "",
                      customer_phone: c?.phone || formData.customer_phone || "",
                      e_type: c && formData.invoice_type === "sales" && !["paper", "e_export", "e_dispatch"].includes(formData.e_type) ? (c.is_e_invoice_user ? "e_invoice" : "e_archive") : formData.e_type,
                    })}
                    testId="inv-contact-select"
                    leadingAction={formData.invoice_type !== "purchase" ? {
                      label: "Perakende (carisiz)",
                      sub: "Cari seçmeden peşin satış — e-arşiv",
                      testId: "inv-retail-contact-option",
                      icon: <Store className="w-4 h-4 shrink-0 text-rose-700" />,
                      onSelect: pickRetailContact,
                    } : null}
                  />
                  {formData.invoice_type !== "purchase" && !formData.contact_id && (
                    <button
                      type="button"
                      onClick={pickRetailContact}
                      className="mt-1.5 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-800 hover:bg-rose-100"
                      data-testid="inv-retail-contact-btn"
                    >
                      <Store className="w-3.5 h-3.5" /> Perakende (carisiz) satış
                    </button>
                  )}
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Proje (opsiyonel)</label>
                  <select value={formData.project_id || ""} onChange={(e) => { const id = e.target.value; const p = projects.find((x) => x.id === id); setFormData({ ...formData, project_id: id, project_number: p?.project_number || "" }); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium" data-testid="inv-project-select">
                    <option value="">— Projesiz —</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.project_number} · {p.name}</option>)}
                  </select>
                </div>
                {quickContact && (
                  <div className="sm:col-span-3">
                    <QuickContactForm companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} defaultType={formData.invoice_type === "purchase" ? "supplier" : "customer"} onCancel={() => setQuickContact(false)}
                      onCreated={(c) => { setContacts((prev) => [c, ...prev]); setFormData((fd) => ({ ...fd, contact_id: c.id, contact_name: c.name, shipping_address: c.address || "", city: c.city || "", customer_phone: c.phone || "", e_type: fd.invoice_type === "sales" && fd.e_type !== "paper" ? (c.is_e_invoice_user ? "e_invoice" : "e_archive") : fd.e_type })); setQuickContact(false); }} />
                  </div>
                )}
                <div className="sm:col-span-3">
                  <GibContactLookup companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onSelect={(c, eType) => { setContacts((prev) => prev.some((x) => x.id === c.id) ? prev : [c, ...prev]); setFormData((f) => ({ ...f, contact_id: c.id, contact_name: c.name, shipping_address: c.address || f.shipping_address || "", city: c.city || f.city || "", customer_phone: c.phone || f.customer_phone || "", e_type: f.invoice_type === "sales" ? eType : f.e_type })); }} />
                </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Düzenleme Tarihi</label>
                  <input
                    type="date"
                    value={formData.issue_date}
                    onChange={(e) => setFormData({ ...formData, issue_date: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                    data-testid="inv-issue-date"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Düzenleme Saati</label>
                  <div className="flex gap-1.5">
                    <TimeInput
                      text24
                      step={1}
                      value={(formData.issue_time || "").slice(0, 8) || ""}
                      onChange={(e) => setFormData({ ...formData, issue_time: e.target.value })}
                      className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-lg p-2"
                      data-testid="inv-issue-time"
                    />
                    <button
                      type="button"
                      title="Şimdiki tarih ve saat"
                      onClick={() => setFormData({ ...formData, ...nowIssueDateTime() })}
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-sky-200 bg-sky-50 text-sky-800 font-semibold hover:bg-sky-100"
                      data-testid="inv-now-btn"
                    >
                      <CalendarClock className="w-3.5 h-3.5" />
                      Şimdi
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Vade Tarihi</label>
                  <input
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                    data-testid="inv-due-date"
                  />
                </div>
                <div className="sm:col-span-2">
                  <FxPicker companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} date={formData.issue_date} currency={formData.currency} rate={formData.fx_rate} source={formData.fx_source} onChange={(p) => setFormData({ ...formData, ...p })} testId="inv-fx" />
                </div>
              </div>

              {/* Items Section */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">Fatura Kalemleri</span>
                </div>
                <div className="flex justify-end"><ScanButton size="sm" onScan={handleScanAddItem} continuous title="Barkodla Kalem Ekle" label="Barkodla Ekle (kamera)" /></div>
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
              </div>

              {/* Totals Summary */}
              <div className="bg-slate-100 p-3 rounded-xl flex flex-col items-end space-y-1 text-slate-700">
                <div className="flex justify-between w-80">
                  <span>Mal / Hizmet Toplamı:</span>
                  <span className="font-semibold">{money(totals.itemsSum)}</span>
                </div>
                {totals.lineDiscount > 0 && <div className="flex justify-between w-80 text-rose-600"><span>Satır İskontoları:</span><span>-{money(totals.lineDiscount)}</span></div>}
                <div className="flex items-center justify-between w-80 gap-2" data-testid="general-discount-row">
                  <span>Genel İskonto:</span>
                  <div className="flex items-center gap-1">
                    <div className="flex rounded-lg border border-slate-300 overflow-hidden text-[10px] font-bold">
                      <button type="button" onClick={() => setGdMode("percent")} className={`px-2 py-1 ${gdMode === "percent" ? "bg-slate-900 text-white" : "bg-white text-slate-500"}`} data-testid="gd-mode-percent">%</button>
                      <button type="button" onClick={() => setGdMode("amount")} className={`px-2 py-1 ${gdMode === "amount" ? "bg-slate-900 text-white" : "bg-white text-slate-500"}`} data-testid="gd-mode-amount">₺</button>
                    </div>
                    <input type="number" min="0" value={gdMode === "percent" ? (formData.general_discount_rate || "") : (formData.general_discount_amount || "")} onChange={(e) => setFormData({ ...formData, [gdMode === "percent" ? "general_discount_rate" : "general_discount_amount"]: e.target.value })} placeholder="0" className="w-20 bg-white border border-rose-200 rounded-lg p-1 text-right text-rose-700 font-semibold" data-testid="general-discount-input" />
                    <span className="text-rose-600 font-semibold w-24 text-right">-{money(totals.gd)}</span>
                  </div>
                </div>
                <div className="flex justify-between w-80 border-t border-slate-300 pt-1">
                  <span>Ara Toplam (İskontolu):</span>
                  <span className="font-semibold">{money(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between w-80">
                  <span>Toplam KDV:</span>
                  <span className="font-semibold" data-testid="inv-vat-total">{money(totals.vat)}</span>
                </div>
                {totals.withholding > 0 && <div className="flex justify-between w-80 text-indigo-700" data-testid="withholding-row"><span>Tevkifat ({WITHHOLDING.find(([v]) => v.startsWith(`${formData.withholding_rate}|`))?.[1]?.split(" – ")[0]} KDV):</span><span>-{money(totals.withholding)}</span></div>}
                <div className="flex justify-between w-80 text-sm font-bold text-slate-900 pt-1 border-t border-slate-300">
                  <span>{totals.withholding > 0 ? "Ödenecek Tutar:" : "Genel Toplam:"}</span>
                  <span className="text-emerald-700" data-testid="inv-grand-total">{fmtMoney(totals.grandTotal, formData.currency || "TRY")}</span>
                </div>
                {(formData.currency || "TRY") !== "TRY" && Number(formData.fx_rate) > 0 && (
                  <div className="flex justify-between w-80 text-slate-500" data-testid="inv-try-equivalent">
                    <span>TL karşılığı (kur {Number(formData.fx_rate).toLocaleString("tr-TR")}):</span>
                    <span className="font-semibold">{fmtMoney(totals.grandTotal * Number(formData.fx_rate), "TRY")}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-100"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold shadow-md shadow-emerald-600/20"
                  data-testid="save-invoice-btn"
                >
                  {(formData.status || "draft") === "draft" ? "Taslak Olarak Kaydet" : "Faturayı Kaydet & Onayla"}
                </button>
              </div>
            </form>
          </div>
        </div>
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
              {!isIncomingPurchaseInvoice(previewInvoice) && previewInvoice.invoice_type !== "dispatch" && (
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
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900 text-sm"
                  data-testid="payment-amount-input"
                />
                {(paymentModalInvoice.currency || "TRY") !== "TRY" && Number(paymentModalInvoice.fx_rate) > 0 && (
                  <div className="text-[11px] text-slate-500 mt-1">TL karşılığı ≈ {fmtMoney((Number(paymentAmount) || 0) * Number(paymentModalInvoice.fx_rate), "TRY")} (kur {Number(paymentModalInvoice.fx_rate).toLocaleString("tr-TR")})</div>
                )}
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{paymentModalInvoice.invoice_type === "sales" ? "Kasa / Banka / POS / Ortak (tahsilat)" : "Kasa / Banka / Kart / Ortak"}</label>
                <PaymentTargetSelect companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} accounts={bankAccounts} value={paymentAccount} onChange={setPaymentAccount} testId="payment-account-select" collectableOnly={paymentModalInvoice.invoice_type === "sales"} />
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

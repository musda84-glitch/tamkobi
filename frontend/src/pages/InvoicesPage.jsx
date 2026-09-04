import React, { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import {
  FileText,
  Plus,
  Send,
  Eye,
  CheckCircle2,
  Clock,
  Printer,
  Download,
  Filter,
  DollarSign,
  X,
  CreditCard,
  Building2,
  Sparkles,
  QrCode,
  MessageSquare,
  MoreVertical,
  MousePointerClick,
  FileCheck2
} from "lucide-react";
import { InvoiceContextMenu, E_TYPE_LABELS } from "../components/InvoiceContextMenu";
import { InstallmentPlanModal } from "../components/InstallmentPlanModal";
import { PaymentTargetSelect, splitPaymentTarget } from "../components/PaymentTargetSelect";
import { GibContactLookup } from "../components/GibContactLookup";
import { BarcodeRenderer } from "../components/BarcodeRenderer";
import { QuickMessageModal, TEMPLATES } from "../components/QuickMessageModal";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PrintDocument, PrintTemplateEditor } from "../components/PrintDocument";
import { SearchSelect } from "../components/SearchSelect";
import { AiInvoiceImportModal } from "../components/AiInvoiceImportModal";
import { InvoiceToolbar, applyInvoiceFilters, DEFAULT_FILTERS } from "../components/InvoiceToolbar";
import { SourceBadge } from "../components/SourceBadge";

export default function InvoicesPage() {
  const { activeCompany } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [filterType, setFilterType] = useState("all");
  const [loading, setLoading] = useState(true);

  // Modals
  const [showNewModal, setShowNewModal] = useState(false);
  const [showAiImport, setShowAiImport] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contactFilter = searchParams.get("contact_id") || "";
  const visibleInvoices = useMemo(() => applyInvoiceFilters(invoices.filter((inv) => !contactFilter || inv.contact_id === contactFilter), filters), [invoices, contactFilter, filters]);
  const visibleTotal = useMemo(() => visibleInvoices.reduce((t, i) => t + (Number(i.grand_total) || 0), 0), [visibleInvoices]);
  const [printInv, setPrintInv] = useState(null);
  const [editTpl, setEditTpl] = useState(false);
  const [notifyInvoice, setNotifyInvoice] = useState(null);
  const [paymentModalInvoice, setPaymentModalInvoice] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [ctxMenu, setCtxMenu] = useState(null);
  const [installmentInv, setInstallmentInv] = useState(null);
  const closeCtx = React.useCallback(() => setCtxMenu(null), []);
  const openCtx = (e, inv) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, inv }); };
  const openCtxFromButton = (e, inv) => { const r = e.currentTarget.getBoundingClientRect(); setCtxMenu({ x: r.left - 240, y: r.bottom + 4, inv }); };
  const handleConvertDispatch = async (inv) => {
    if (!window.confirm(`${inv.invoice_number} irsaliyesinden satış faturası oluşturulsun mu?`)) return;
    try { const r = await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/convert-to-invoice`, {}); toast.success(r.data.message); loadData(); }
    catch (err) { toast.error(err.response?.data?.detail || "Dönüştürülemedi."); }
  };
  const handleCreateDispatch = async (inv) => {
    try { const r = await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/create-dispatch`); toast[r.data.status === "exists" ? "info" : "success"](r.data.message); loadData(); }
    catch (err) { toast.error(err.response?.data?.detail || "İrsaliye oluşturulamadı."); }
  };
  const openPayment = (inv) => { setPaymentModalInvoice(inv); setPaymentAmount(inv.grand_total - (inv.paid_amount || 0)); };

  // New Invoice Form
  const [formData, setFormData] = useState({
    invoice_type: "sales",
    e_type: "e_archive",
    contact_id: "",
    contact_name: "",
    issue_date: new Date().toISOString().split("T")[0],
    due_date: new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
    items: [
      { product_id: "", name: "", quantity: 1, unit: "Adet", unit_price: 0, vat_rate: 20, total: 0 }
    ],
    notes: "Teşekkür ederiz.",
    general_discount_rate: 0,
    general_discount_amount: 0
  });
  const [gdMode, setGdMode] = useState("percent");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [invRes, cntRes, prodRes, bankRes] = await Promise.all([
        axios.get(`${API_URL}/invoices?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}&type=${filterType}`),
        axios.get(`${API_URL}/contacts?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`),
        axios.get(`${API_URL}/products?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`),
        axios.get(`${API_URL}/banking/accounts?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`)
      ]);
      setInvoices(invRes.data);
      setContacts(cntRes.data);
      setProducts(prodRes.data);
      setBankAccounts(bankRes.data);
      if (bankRes.data.length > 0) setPaymentAccount(bankRes.data[0].id || bankRes.data[0]._id);
    } catch (err) {
      toast.error("Veriler yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, [activeCompany, filterType]);
  useEffect(() => { loadData(); }, [loadData]);

  const handleAddItem = () => {
    setFormData({
      ...formData,
      items: [
        ...formData.items,
        { product_id: "", name: "", quantity: 1, unit: "Adet", unit_price: 0, vat_rate: 20, total: 0 }
      ]
    });
  };

  const handleItemProductSelect = (index, productId) => {
    const prod = products.find(p => (p.id === productId || p._id === productId));
    const items = [...formData.items];
    if (prod) {
      const price = formData.invoice_type === "sales" ? prod.sale_price : prod.purchase_price;
      items[index] = {
        product_id: prod.id || prod._id,
        name: prod.name,
        quantity: 1,
        unit: prod.unit || "Adet",
        unit_price: price,
        vat_rate: prod.vat_rate || 20,
        total: price
      };
    }
    setFormData({ ...formData, items });
  };

  const handleItemChange = (index, field, val) => {
    const items = [...formData.items];
    items[index][field] = val;
    if (field === "quantity" || field === "unit_price" || field === "discount_rate") {
      items[index].total = Number(items[index].quantity || 0) * Number(items[index].unit_price || 0) * (1 - Number(items[index].discount_rate || 0) / 100);
    }
    setFormData({ ...formData, items });
  };

  const handleRemoveItem = (index) => {
    if (formData.items.length <= 1) return;
    const items = formData.items.filter((_, i) => i !== index);
    setFormData({ ...formData, items });
  };

  const calculateTotals = () => {
    const itemsSum = formData.items.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const lineDiscount = formData.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0) * (Number(item.discount_rate || 0) / 100), 0);
    const gdRaw = gdMode === "percent" ? itemsSum * Number(formData.general_discount_rate || 0) / 100 : Number(formData.general_discount_amount || 0);
    const gd = Math.min(Math.max(gdRaw, 0), itemsSum);
    const factor = itemsSum ? (itemsSum - gd) / itemsSum : 1;
    const subtotal = itemsSum - gd;
    const vat = formData.items.reduce((sum, item) => sum + (Number(item.total || 0) * factor * (Number(item.vat_rate || 20) / 100)), 0);
    return { itemsSum, lineDiscount, gd, subtotal, vat, grandTotal: subtotal + vat };
  };

  const handleCreateInvoice = async (e) => {
    e.preventDefault();
    if (!formData.contact_id) {
      toast.error("Lütfen bir cari seçiniz.");
      return;
    }
    try {
      const t = calculateTotals();
      const payload = {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        ...formData,
        general_discount_amount: t.gd,
        general_discount_rate: gdMode === "percent" ? Number(formData.general_discount_rate || 0) : 0,
        status: "approved"
      };
      await axios.post(`${API_URL}/invoices`, payload);
      toast.success("Fatura başarıyla oluşturuldu ve cariye işlendi.");
      setShowNewModal(false);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail ? (typeof err.response.data.detail === "string" ? err.response.data.detail : "Eksik alan: " + err.response.data.detail.map(d => d.loc?.slice(-1)[0]).join(", ")) : "Fatura kaydedilemedi.");
    }
  };

  const handleSendToGib = async (invId, eType) => {
    try {
      const res = await axios.post(`${API_URL}/invoices/${invId}/send-to-gib`, eType ? { e_type: eType } : {});
      toast.success(res.data.message);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Fatura kesilemedi.");
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
      setPaymentModalInvoice(null);
      setPaymentAmount("");
      loadData();
    } catch (err) {
      toast.error("Ödeme kaydedilemedi.");
    }
  };

  const totals = calculateTotals();

  return (
    <div className="space-y-6" data-testid="invoices-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Ön Muhasebe & E-Dönüşüm</h1>
          <p className="text-xs sm:text-sm text-slate-500">Satış, Alış, E-Fatura, E-Arşiv ve GİB Portal Entegrasyonu</p>
        </div>
        <div className="flex gap-2 self-start">
        <button onClick={() => setShowAiImport(true)} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-violet-600/20 transition" data-testid="ai-import-btn"><Sparkles className="w-4 h-4" /><span>PDF'den Aktar (AI)</span></button>
        <button
          onClick={() => { if (filterType === "dispatch") setFormData((fd) => ({ ...fd, invoice_type: "dispatch", e_type: "e_dispatch" })); setShowNewModal(true); }}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-600/20 transition self-start sm:self-auto"
          data-testid="create-new-invoice-btn"
        >
          <Plus className="w-4 h-4" />
          <span>{filterType === "dispatch" ? "Yeni İrsaliye" : "Yeni Fatura Kes"}</span>
        </button>
        </div>
      </div>
      {showAiImport && <AiInvoiceImportModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} contacts={contacts} onClose={() => setShowAiImport(false)} onDone={() => loadData()} />}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 text-xs overflow-x-auto">
        {[
          { id: "all", label: "Tüm Faturalar" },
          { id: "sales", label: "Satış Faturaları" },
          { id: "purchase", label: "Alış Faturaları" },
          { id: "proforma", label: "Proforma & Teklif" },
          { id: "return", label: "İade Faturaları" },
          { id: "dispatch", label: "İrsaliyeler" }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilterType(tab.id)}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              filterType === tab.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
            data-testid={`filter-tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <InvoiceToolbar f={filters} setF={setFilters} count={visibleInvoices.length} total={visibleTotal} />

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        {contactFilter && (
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border-b border-emerald-100 text-xs" data-testid="contact-filter-chip">
            <span className="text-emerald-800">Cari filtresi: <b>{contacts.find((c) => c.id === contactFilter)?.name || invoices.find((i) => i.contact_id === contactFilter)?.contact_name || contactFilter}</b> ({invoices.filter((i) => i.contact_id === contactFilter).length} fatura)</span>
            <button onClick={() => navigate("/invoices")} className="ml-auto px-2 py-0.5 rounded-full bg-white border border-emerald-200 text-emerald-700 font-semibold hover:bg-emerald-100" data-testid="clear-contact-filter-btn">Filtreyi Kaldır</button>
          </div>
        )}
        <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-50/70 border-b border-slate-100 text-[11px] text-slate-500" data-testid="ctx-hint">
          <MousePointerClick className="w-3.5 h-3.5 text-emerald-600" /> İpucu: Bir fatura satırına <b>sağ tıklayarak</b> E-Fatura / E-Arşiv / Kağıt olarak kesebilir, yazdırabilir veya tahsilat ekleyebilirsiniz.
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-4 py-3">{filterType === "dispatch" ? "İrsaliye No" : "Fatura No"} / Tür / Kaynak</th>
                <th className="px-4 py-3">Cari (Müşteri / Tedarikçi)</th>
                <th className="px-4 py-3">Tarih / Vade</th>
                <th className="px-4 py-3">GİB Durumu</th>
                <th className="px-4 py-3 text-right">Tutar</th>
                <th className="px-4 py-3 text-right">{filterType === "dispatch" ? "İrsaliye Durumu" : "Ödeme Durumu"}</th>
                <th className="px-4 py-3 text-center">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleInvoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400" data-testid="inv-empty">
                    {invoices.length === 0 ? "Kayıtlı fatura bulunamadı." : "Filtreye uyan fatura yok."}
                  </td>
                </tr>
              ) : (
                visibleInvoices.map((inv) => (
                  <tr key={inv.id || inv._id || inv.invoice_number} onContextMenu={(e) => openCtx(e, inv)} className={`hover:bg-slate-50/70 transition cursor-context-menu ${ctxMenu?.inv?.invoice_number === inv.invoice_number ? "bg-emerald-50/60" : ""}`} data-testid={`invoice-row-${inv.invoice_number}`}>
                    <td className="px-4 py-3 font-medium">
                      <div className="text-slate-900 font-mono font-semibold">{inv.invoice_number}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                          inv.invoice_type === 'sales' ? 'bg-blue-50 text-blue-700' : inv.invoice_type === 'dispatch' ? 'bg-fuchsia-50 text-fuchsia-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {inv.invoice_type === 'sales' ? 'Satış' : inv.invoice_type === 'dispatch' ? 'İrsaliye' : 'Alış'}
                        </span>
                        <SourceBadge channel={inv.source_channel} testId={`inv-source-${inv.invoice_number}`} />
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded uppercase" data-testid={`inv-etype-badge-${inv.invoice_number}`}>
                          {E_TYPE_LABELS[inv.e_type] || 'İrsaliye'}
                        </span>
                        {inv.installment_plan && <button onClick={() => setInstallmentInv(inv)} className="text-[10px] bg-violet-50 text-violet-700 px-1.5 py-0.2 rounded font-semibold hover:bg-violet-100" data-testid={`inv-installment-badge-${inv.invoice_number}`}>{inv.installment_plan.paid_count}/{inv.installment_plan.count} Taksit</button>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => inv.contact_id && navigate(`/contacts?contact_id=${inv.contact_id}`)} className="font-semibold text-slate-900 hover:text-emerald-700 hover:underline text-left" data-testid={`inv-contact-link-${inv.invoice_number}`}>{inv.contact_name}</button>
                      <div className="text-[11px] text-slate-400">VKN/TCKN: {inv.contact_tax_id || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{inv.issue_date}</div>
                      <div className="text-[11px] text-slate-400">Vade: {inv.due_date || 'Peşin'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                        {inv.gib_status || 'Taslak'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-bold text-slate-900">{inv.grand_total?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</div>
                      <div className="text-[10px] text-slate-400">{inv.invoice_type === 'dispatch' ? "KDV'siz (Sevk)" : 'KDV Dahil'}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {inv.invoice_type === 'dispatch' ? (
                        <span className={`inline-block text-[11px] px-2 py-0.5 rounded-md font-semibold ${inv.converted_invoice_id ? 'bg-emerald-100 text-emerald-800' : 'bg-fuchsia-100 text-fuchsia-800'}`} data-testid={`dispatch-status-${inv.invoice_number}`}>
                          {inv.converted_invoice_id ? `Faturalandı · ${inv.converted_invoice_number}` : inv.order_number ? `Sipariş ${inv.order_number}` : inv.invoice_ref_number ? `Fatura ${inv.invoice_ref_number}` : 'Faturalanmadı'}
                        </span>
                      ) : (
                      <span className={`inline-block text-[11px] px-2 py-0.5 rounded-md font-semibold ${
                        inv.payment_status === 'paid'
                          ? 'bg-emerald-100 text-emerald-800'
                          : inv.payment_status === 'partially_paid'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}>
                        {inv.payment_status === 'paid' ? 'Ödendi' : inv.payment_status === 'partially_paid' ? 'Kısmi Ödendi' : 'Ödenmedi'}
                      </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center w-[220px] min-w-[220px]">
                      <div className="grid grid-cols-6 gap-1 justify-items-center items-center">
                        <button
                          onClick={() => setPreviewInvoice(inv)}
                          className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                          title="Faturayı Görüntüle / Yazdır"
                          data-testid={`preview-inv-btn-${inv.invoice_number}`}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => setPrintInv(inv)} className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition" title="Şablonlu Yazdır / Form Düzenle" data-testid={`print-inv-btn-${inv.invoice_number}`}><Printer className="w-4 h-4" /></button>
                        <button
                          onClick={() => setNotifyInvoice(inv)}
                          className="p-1.5 text-slate-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition"
                          title={inv.payment_status === 'paid' ? "Fatura Bildirimi Gönder (SMS/E-posta)" : "Tahsilat Hatırlatması Gönder (SMS/E-posta)"}
                          data-testid={`notify-inv-btn-${inv.invoice_number}`}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                        {inv.gib_status !== 'Başarıyla İletildi (GİB Onaylı)' && inv.gib_status !== 'Kağıt Fatura (Matbu)' ? (
                          <button
                            onClick={() => handleSendToGib(inv.id || inv._id)}
                            className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                            title="GİB Portalına Gönder & İmzala"
                            data-testid={`send-gib-btn-${inv.invoice_number}`}
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        ) : <span className="p-1.5 w-7 h-7 inline-block" aria-hidden="true" />}
                        <button onClick={(e) => openCtxFromButton(e, inv)} className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition" title="Fatura kesim & diğer işlemler" data-testid={`inv-more-btn-${inv.invoice_number}`}><MoreVertical className="w-4 h-4" /></button>
                        {inv.invoice_type === 'dispatch' ? (
                          <button onClick={() => handleConvertDispatch(inv)} disabled={!!inv.converted_invoice_id} className="p-1.5 text-fuchsia-600 hover:text-fuchsia-800 hover:bg-fuchsia-50 rounded-lg transition disabled:opacity-30" title={inv.converted_invoice_id ? "Faturalandı" : "İrsaliyeyi Faturaya Dönüştür"} data-testid={`dispatch-convert-btn-${inv.invoice_number}`}><FileCheck2 className="w-4 h-4" /></button>
                        ) : inv.payment_status !== 'paid' ? (
                          <button
                            onClick={() => openPayment(inv)}
                            className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition"
                            title="Tahsilat / Ödeme Ekle"
                            data-testid={`payment-btn-${inv.invoice_number}`}
                          >
                            <DollarSign className="w-4 h-4" />
                          </button>
                        ) : <span className="p-1.5 w-7 h-7 inline-block" aria-hidden="true" />}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <InvoiceContextMenu menu={ctxMenu} onClose={closeCtx} onIssue={(inv, eType) => handleSendToGib(inv.id || inv._id, eType)} onPreview={setPreviewInvoice} onPrint={setPrintInv} onNotify={setNotifyInvoice} onPayment={openPayment} onDispatch={handleCreateDispatch} onInstallments={setInstallmentInv} />
      {installmentInv && <InstallmentPlanModal doc={installmentInv} kind="invoice" accounts={bankAccounts} companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setInstallmentInv(null)} onChanged={loadData} />}
      {printInv && <PrintDocument docType="invoice" doc={printInv} company={activeCompany} onClose={() => setPrintInv(null)} onEditTemplate={() => setEditTpl(true)} />}
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
            onClose={() => setNotifyInvoice(null)}
          />
        );
      })()}

      {/* NEW INVOICE MODAL */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 space-y-5 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto" data-testid="new-invoice-modal">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Yeni Fatura Düzenle</h2>
                <p className="text-xs text-slate-500">E-Fatura & E-Arşiv Standartlarına Uygun</p>
              </div>
              <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
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
                    <option value="e_dispatch">E-İrsaliye</option>
                    <option value="paper">Kağıt Fatura (Matbu)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Cari Seçin</label>
                  <SearchSelect
                    value={formData.contact_id}
                    options={contacts}
                    placeholder="Cari ara ve seç..."
                    getLabel={(c) => c.name}
                    getSub={(c) => `${c.type === 'customer' ? 'Müşteri' : c.type === 'supplier' ? 'Tedarikçi' : 'Müşteri & Tedarikçi'} • VKN ${c.tax_number_or_id}`}
                    onChange={(id, c) => setFormData({ ...formData, contact_id: id, contact_name: c?.name || "", e_type: c && formData.invoice_type === "sales" && formData.e_type !== "paper" ? (c.is_e_invoice_user ? "e_invoice" : "e_archive") : formData.e_type })}
                    testId="inv-contact-select"
                  />
                </div>
                <div className="sm:col-span-3">
                  <GibContactLookup companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onSelect={(c, eType) => { setContacts((prev) => prev.some((x) => x.id === c.id) ? prev : [c, ...prev]); setFormData((f) => ({ ...f, contact_id: c.id, contact_name: c.name, e_type: f.invoice_type === "sales" ? eType : f.e_type })); }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Düzenleme Tarihi</label>
                  <input
                    type="date"
                    value={formData.issue_date}
                    onChange={(e) => setFormData({ ...formData, issue_date: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Vade Tarihi</label>
                  <input
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
              </div>

              {/* Items Section */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">Fatura Kalemleri</span>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="text-emerald-600 hover:text-emerald-700 font-semibold flex items-center gap-1"
                    data-testid="add-invoice-item-btn"
                  >
                    <Plus className="w-3.5 h-3.5" /> Kalem Ekle
                  </button>
                </div>

                <div className="grid grid-cols-12 gap-2 px-2.5 text-[10px] uppercase font-semibold text-slate-400">
                  <div className="col-span-3">Ürün / Hizmet</div><div className="col-span-2 text-center">Miktar</div><div className="col-span-1 text-center text-rose-500">İskonto %</div><div className="col-span-2 text-right">Birim Fiyat</div><div className="col-span-1">KDV</div><div className="col-span-2 text-right">Tutar</div><div className="col-span-1"></div>
                </div>
                {formData.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
                    <div className="col-span-3">
                      <SearchSelect
                        value={item.product_id}
                        options={products}
                        placeholder="Ürün ara (ad / SKU / barkod)..."
                        getLabel={(p) => p.name}
                        getSub={(p) => `SKU ${p.sku} • ${p.barcode} • Stok ${p.stock_quantity} • ${(p.sale_price || 0).toLocaleString('tr-TR')} ₺`}
                        getImage={(p) => p.image_url}
                        onChange={(id) => handleItemProductSelect(idx, id)}
                        testId={`inv-item-product-${idx}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        min="1"
                        placeholder="Miktar"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded p-1.5 text-center"
                      />
                    </div>
                    <div className="col-span-1">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        placeholder="İsk. %"
                        title="İskonto %"
                        value={item.discount_rate || ""}
                        onChange={(e) => handleItemChange(idx, "discount_rate", e.target.value)}
                        className="w-full bg-white border border-rose-200 rounded p-1.5 text-center text-rose-700"
                        data-testid={`inv-item-discount-${idx}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        placeholder="Birim Fiyat"
                        value={item.unit_price}
                        onChange={(e) => handleItemChange(idx, "unit_price", e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded p-1.5 text-right"
                      />
                    </div>
                    <div className="col-span-1">
                      <select
                        value={item.vat_rate}
                        onChange={(e) => handleItemChange(idx, "vat_rate", e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded p-1.5"
                      >
                        <option value="20">%20</option>
                        <option value="10">%10</option>
                        <option value="1">%1</option>
                        <option value="0">%0</option>
                      </select>
                    </div>
                    <div className="col-span-2 text-right font-bold text-slate-800">
                      {item.total?.toLocaleString('tr-TR')} ₺
                    </div>
                    <div className="col-span-1 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals Summary */}
              <div className="bg-slate-100 p-3 rounded-xl flex flex-col items-end space-y-1 text-slate-700">
                <div className="flex justify-between w-80">
                  <span>Mal / Hizmet Toplamı:</span>
                  <span className="font-semibold">{totals.itemsSum.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
                </div>
                {totals.lineDiscount > 0 && <div className="flex justify-between w-80 text-rose-600"><span>Satır İskontoları:</span><span>-{totals.lineDiscount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span></div>}
                <div className="flex items-center justify-between w-80 gap-2" data-testid="general-discount-row">
                  <span>Genel İskonto:</span>
                  <div className="flex items-center gap-1">
                    <div className="flex rounded-lg border border-slate-300 overflow-hidden text-[10px] font-bold">
                      <button type="button" onClick={() => setGdMode("percent")} className={`px-2 py-1 ${gdMode === "percent" ? "bg-slate-900 text-white" : "bg-white text-slate-500"}`} data-testid="gd-mode-percent">%</button>
                      <button type="button" onClick={() => setGdMode("amount")} className={`px-2 py-1 ${gdMode === "amount" ? "bg-slate-900 text-white" : "bg-white text-slate-500"}`} data-testid="gd-mode-amount">₺</button>
                    </div>
                    <input type="number" min="0" value={gdMode === "percent" ? (formData.general_discount_rate || "") : (formData.general_discount_amount || "")} onChange={(e) => setFormData({ ...formData, [gdMode === "percent" ? "general_discount_rate" : "general_discount_amount"]: e.target.value })} placeholder="0" className="w-20 bg-white border border-rose-200 rounded-lg p-1 text-right text-rose-700 font-semibold" data-testid="general-discount-input" />
                    <span className="text-rose-600 font-semibold w-24 text-right">-{totals.gd.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
                  </div>
                </div>
                <div className="flex justify-between w-80 border-t border-slate-300 pt-1">
                  <span>Ara Toplam (İskontolu):</span>
                  <span className="font-semibold">{totals.subtotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
                </div>
                <div className="flex justify-between w-80">
                  <span>Toplam KDV:</span>
                  <span className="font-semibold">{totals.vat.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
                </div>
                <div className="flex justify-between w-80 text-sm font-bold text-slate-900 pt-1 border-t border-slate-300">
                  <span>Genel Toplam:</span>
                  <span className="text-emerald-700">{totals.grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
                </div>
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
                  Faturayı Kaydet & Onayla
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
                  <div className="text-xl font-bold text-slate-900">{activeCompany?.name || "Nexus Teknoloji A.Ş."}</div>
                  <div className="text-xs text-slate-500 max-w-sm mt-1">{activeCompany?.address || "İstanbul, Türkiye"}</div>
                  <div className="text-xs text-slate-600 mt-1">Vergi Dairesi: {activeCompany?.tax_office || "Kadıköy"} • VKN: {activeCompany?.tax_number || "6320984412"}</div>
                </div>
                <div className="text-right">
                  <div className="inline-block px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded">
                    {previewInvoice.e_type === 'e_invoice' ? 'E-FATURA' : previewInvoice.e_type === 'paper' ? 'FATURA' : previewInvoice.e_type === 'e_dispatch' ? 'E-İRSALİYE' : 'E-ARŞİV FATURA'}
                  </div>
                  <div className="font-mono text-xs font-bold mt-2 text-slate-900">{previewInvoice.invoice_number}</div>
                  <div className="text-xs text-slate-500">Tarih: {previewInvoice.issue_date}</div>
                </div>
              </div>

              {/* Customer Info */}
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex justify-between items-start text-xs">
                <div>
                  <div className="text-slate-400 font-semibold uppercase text-[10px]">SAYIN (ALICI)</div>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">{previewInvoice.contact_name}</div>
                  <div className="text-slate-600 mt-1">VKN / TCKN: {previewInvoice.contact_tax_id || 'Belirtilmedi'}</div>
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
                    <th className="py-2 text-right">Birim Fiyat</th>
                    <th className="py-2 text-center">KDV</th>
                    <th className="py-2 text-right">Toplam</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previewInvoice.items?.map((it, i) => (
                    <tr key={i}>
                      <td className="py-2.5 font-medium text-slate-900">{it.name}</td>
                      <td className="py-2.5 text-center">{it.quantity} {it.unit}</td>
                      <td className="py-2.5 text-right">{it.unit_price?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</td>
                      <td className="py-2.5 text-center">%{it.vat_rate}</td>
                      <td className="py-2.5 text-right font-semibold">{it.total?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals & Barcode */}
              <div className="flex justify-between items-end border-t pt-4">
                <div className="space-y-2">
                  <BarcodeRenderer code={previewInvoice.invoice_number || "NX202600000104"} width={160} height={40} />
                  <div className="text-[10px] text-slate-400">Bu belge 5070 sayılı kanun uyarınca elektronik imzalanmıştır.</div>
                </div>
                <div className="w-64 space-y-1.5 text-xs text-right">
                  <div className="flex justify-between text-slate-600">
                    <span>Mal Hizmet Toplamı:</span>
                    <span>{previewInvoice.subtotal?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Hesaplanan KDV (%20):</span>
                    <span>{previewInvoice.vat_total?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-900 pt-1.5 border-t border-slate-300">
                    <span>Ödenecek Tutar:</span>
                    <span className="text-emerald-700">{previewInvoice.grand_total?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
                  </div>
                </div>
              </div>
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
                <label className="block font-semibold text-slate-700 mb-1">Tahsilat/Ödeme Tutarı (₺)</label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900 text-sm"
                  data-testid="payment-amount-input"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Kasa / Banka / POS / Ortak Seçin</label>
                <PaymentTargetSelect companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} accounts={bankAccounts} value={paymentAccount} onChange={setPaymentAccount} testId="payment-account-select" />
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

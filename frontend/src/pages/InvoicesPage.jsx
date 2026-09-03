import React, { useState, useEffect } from "react";
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
  MessageSquare
} from "lucide-react";
import { BarcodeRenderer } from "../components/BarcodeRenderer";
import { QuickMessageModal, TEMPLATES } from "../components/QuickMessageModal";
import { useNavigate } from "react-router-dom";
import { SearchSelect } from "../components/SearchSelect";

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
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const navigate = useNavigate();
  const [notifyInvoice, setNotifyInvoice] = useState(null);
  const [paymentModalInvoice, setPaymentModalInvoice] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAccount, setPaymentAccount] = useState("");

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
    notes: "Teşekkür ederiz."
  });

  useEffect(() => {
    loadData();
  }, [activeCompany, filterType]);

  const loadData = async () => {
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
  };

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
    if (field === "quantity" || field === "unit_price") {
      items[index].total = Number(items[index].quantity || 0) * Number(items[index].unit_price || 0);
    }
    setFormData({ ...formData, items });
  };

  const handleRemoveItem = (index) => {
    if (formData.items.length <= 1) return;
    const items = formData.items.filter((_, i) => i !== index);
    setFormData({ ...formData, items });
  };

  const calculateTotals = () => {
    const subtotal = formData.items.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const vat = formData.items.reduce((sum, item) => sum + (Number(item.total || 0) * (Number(item.vat_rate || 20) / 100)), 0);
    return { subtotal, vat, grandTotal: subtotal + vat };
  };

  const handleCreateInvoice = async (e) => {
    e.preventDefault();
    if (!formData.contact_id) {
      toast.error("Lütfen bir cari seçiniz.");
      return;
    }
    try {
      const payload = {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        ...formData,
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

  const handleSendToGib = async (invId) => {
    try {
      const res = await axios.post(`${API_URL}/invoices/${invId}/send-to-gib`);
      toast.success(res.data.message);
      loadData();
    } catch (err) {
      toast.error("GİB'e gönderim başarısız.");
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
        account_id: paymentAccount
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
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-600/20 transition self-start sm:self-auto"
          data-testid="create-new-invoice-btn"
        >
          <Plus className="w-4 h-4" />
          <span>Yeni Fatura Kes</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 text-xs overflow-x-auto">
        {[
          { id: "all", label: "Tüm Faturalar" },
          { id: "sales", label: "Satış Faturaları" },
          { id: "purchase", label: "Alış Faturaları" },
          { id: "proforma", label: "Proforma & Teklif" },
          { id: "return", label: "İade Faturaları" }
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

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-4 py-3">Fatura No / Tür</th>
                <th className="px-4 py-3">Cari (Müşteri / Tedarikçi)</th>
                <th className="px-4 py-3">Tarih / Vade</th>
                <th className="px-4 py-3">GİB Durumu</th>
                <th className="px-4 py-3 text-right">Tutar</th>
                <th className="px-4 py-3 text-right">Ödeme Durumu</th>
                <th className="px-4 py-3 text-center">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Kayıtlı fatura bulunamadı.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id || inv._id || inv.invoice_number} className="hover:bg-slate-50/70 transition" data-testid={`invoice-row-${inv.invoice_number}`}>
                    <td className="px-4 py-3 font-medium">
                      <div className="text-slate-900 font-mono font-semibold">{inv.invoice_number}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                          inv.invoice_type === 'sales' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {inv.invoice_type === 'sales' ? 'Satış' : 'Alış'}
                        </span>
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded uppercase">
                          {inv.e_type === 'e_invoice' ? 'E-Fatura' : inv.e_type === 'e_archive' ? 'E-Arşiv' : inv.e_type === 'paper' ? 'Kağıt' : 'İrsaliye'}
                        </span>
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
                      <div className="text-[10px] text-slate-400">KDV Dahil</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-block text-[11px] px-2 py-0.5 rounded-md font-semibold ${
                        inv.payment_status === 'paid'
                          ? 'bg-emerald-100 text-emerald-800'
                          : inv.payment_status === 'partially_paid'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}>
                        {inv.payment_status === 'paid' ? 'Ödendi' : inv.payment_status === 'partially_paid' ? 'Kısmi Ödendi' : 'Ödenmedi'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setPreviewInvoice(inv)}
                          className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                          title="Faturayı Görüntüle / Yazdır"
                          data-testid={`preview-inv-btn-${inv.invoice_number}`}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setNotifyInvoice(inv)}
                          className="p-1.5 text-slate-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition"
                          title={inv.payment_status === 'paid' ? "Fatura Bildirimi Gönder (SMS/E-posta)" : "Tahsilat Hatırlatması Gönder (SMS/E-posta)"}
                          data-testid={`notify-inv-btn-${inv.invoice_number}`}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                        {inv.gib_status !== 'Başarıyla İletildi (GİB Onaylı)' && (
                          <button
                            onClick={() => handleSendToGib(inv.id || inv._id)}
                            className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                            title="GİB Portalına Gönder & İmzala"
                            data-testid={`send-gib-btn-${inv.invoice_number}`}
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                        {inv.payment_status !== 'paid' && (
                          <button
                            onClick={() => {
                              setPaymentModalInvoice(inv);
                              setPaymentAmount(inv.grand_total - (inv.paid_amount || 0));
                            }}
                            className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                            title="Tahsilat / Ödeme Ekle"
                            data-testid={`payment-btn-${inv.invoice_number}`}
                          >
                            <DollarSign className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                    onChange={(id, c) => setFormData({ ...formData, contact_id: id, contact_name: c?.name || "" })}
                    testId="inv-contact-select"
                  />
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

                {formData.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
                    <div className="col-span-4">
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
                <div className="flex justify-between w-48">
                  <span>Ara Toplam:</span>
                  <span className="font-semibold">{totals.subtotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
                </div>
                <div className="flex justify-between w-48">
                  <span>Toplam KDV:</span>
                  <span className="font-semibold">{totals.vat.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
                </div>
                <div className="flex justify-between w-48 text-sm font-bold text-slate-900 pt-1 border-t border-slate-300">
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
                <label className="block font-semibold text-slate-700 mb-1">Hesap / Kasa Seçin</label>
                <select
                  value={paymentAccount}
                  onChange={(e) => setPaymentAccount(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="payment-account-select"
                >
                  {bankAccounts.map(b => (
                    <option key={b.id || b._id} value={b.id || b._id}>
                      {b.bank_name} - {b.account_name} ({b.current_balance?.toLocaleString('tr-TR')} ₺)
                    </option>
                  ))}
                </select>
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

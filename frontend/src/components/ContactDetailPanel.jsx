
import React, { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, FileText, Wallet, ShoppingCart, MessageSquare, Send, Loader2, Navigation, Phone, Mail, FileSignature, Ruler, Pencil, Trash2, Lock, Eye, CalendarClock, Layers, ArrowUpRight, ArrowDownLeft, Info, ScrollText, Briefcase, Printer, MoreVertical, Link2 } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { mapsLink } from "./ContactLocationModal";
import { workMapsLink } from "../utils/mapsLink";
import { PrintDocument, PrintTemplateEditor } from "./PrintDocument";
import { ReceiptPrint } from "./ReceiptPrint";
import { QuoteEditModal } from "./QuoteEditModal";
import { SurveyDetailModal } from "./SurveyDetailModal";
import { ProjectTrackingModal, TrackingBadge } from "./ProjectTrackingModal";
import { ContactTermsModal } from "./ContactTermsModal";
import { InvoiceContextMenu, isIncomingPurchaseInvoice, canDeleteInvoice } from "./InvoiceContextMenu";
import InvoiceActionPanel from "./InvoiceActionPanel";
import { useEscape } from "../utils/useEscape";
import { SortableHeader, useSortableColumns, useSortedRows } from "./SortableColumns";
import { InstallmentPlanModal, InstallmentRows } from "./InstallmentPlanModal";
import { collectableAccounts, PaymentTargetSelect, splitPaymentTarget } from "./PaymentTargetSelect";
import { statusTr, channelTr, E_TYPE_TR } from "../utils/labels";
import { useNavigate } from "react-router-dom";
import { DocumentLineEditor } from "./DocumentLineEditor";
import { documentLineTotals, fmtMoney, hydrateLine } from "../utils/documentLines";
import { orderFooterTotals } from "../utils/orderMoney";
import { notifyDataChanged, useDataRefresh } from "../utils/dataRefresh";
import { ContactForm } from "./ContactForm";
import { resolveImageUrl } from "../utils/imageUrl";
import { formatTrAmount } from "../utils/money";
import { orderEditBlockedReason, orderLinesLocked as orderChannelLocked } from "../utils/orderEdit";

const fmt = (n) => formatTrAmount((n || 0));
const TABS = [["invoices", "Faturalar", FileText], ["payments", "Ödemeler", Wallet], ["cheques", "Çek ve Senetler", ScrollText], ["orders", "Siparişler", ShoppingCart], ["quotes", "Teklifler", FileSignature], ["projects", "Projeler", Briefcase], ["surveys", "Keşifler", Ruler], ["comm", "İletişim", MessageSquare], ["mail_status", "E-posta Durumu", Mail], ["whatsapp", "WhatsApp", Phone], ["installments", "Taksitler", CalendarClock]];

const MAIL_KIND = {
  manual: "Mesaj", contact: "Cari", invoice: "Fatura", order: "Sipariş", cargo: "Kargo", quote: "Teklif", quote_approval: "Teklif",
  statement: "Hesap ekstresi", dispatch: "İrsaliye", project: "Proje", project_tracking: "Proje takibi", survey: "Keşif",
  campaign: "Kampanya", installment: "Taksit", b2b_reset: "B2B şifre",
};

function mailDeliveryBadge(m) {
  if (m.status === "failed") return { text: "Ulaşmadı", cls: "text-rose-700 bg-rose-50" };
  if (m.opened_at) return { text: "Okundu", cls: "text-sky-700 bg-sky-50" };
  return { text: "Gönderildi", cls: "text-emerald-700 bg-emerald-50" };
}

const ORDER_STATUS_OPTIONS = [["pending", "Beklemede"], ["approved", "Onaylandı"], ["preparing", "Hazırlanıyor"], ["shipped", "Kargolandı"], ["completed", "Tamamlandı"], ["returned", "İade Edildi"], ["partially_returned", "Kısmi İade"]];

function chequeReceipt(ch) {
  const kind = ch.instrument === "promissory" ? "Senet" : "Çek";
  const dir = ch.direction === "received" ? "Alınan" : "Verilen";
  return {
    id: ch.id,
    type: ch.direction === "received" ? "inflow" : "outflow",
    date: ch.issue_date || ch.due_date || "",
    account_name: ch.bank_name || "Çek Portföyü",
    category: `${dir} ${kind}`,
    description: `${ch.number || "Çek"} · vade ${ch.due_date || "—"}${ch.serial_no ? ` · seri ${ch.serial_no}` : ""}`,
    amount: ch.amount,
    contact_name: ch.contact_name,
  };
}

export const ContactDetailPanel = ({ contactId, onClose, onMessage }) => {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("invoices");
  const [busy, setBusy] = useState(null);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [orderDetail, setOrderDetail] = useState(null);
  const [editOrder, setEditOrder] = useState(null);
  const [orderProducts, setOrderProducts] = useState([]);
  const [printDoc, setPrintDoc] = useState(null);
  const [editTpl, setEditTpl] = useState(null);
  const navigate = useNavigate();
  const { activeCompany } = useAuth();

  useEscape(onClose);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const load = useCallback(async () => {
    try { const r = await axios.get(`${API_URL}/contacts/${contactId}/overview`); setData(r.data); }
    catch { toast.error("Cari detayı yüklenemedi."); onCloseRef.current(); }
  }, [contactId]);
  useEffect(() => { load(); }, [load]);
  useDataRefresh(load, { companyId: data?.contact?.company_id, scopes: ["cash", "contacts", "invoices", "orders"] });

  const convertQuote = async (q) => { try { const r = await axios.post(`${API_URL}/quotes/${q.id}/convert-to-invoice`, {}); toast.success(r.data.message); load(); } catch (err) { toast.error(err.response?.data?.detail || "Dönüştürülemedi."); } };
  const convertQuoteToProject = async (q) => { try { const r = await axios.post(`${API_URL}/quotes/${q.id}/convert-to-project`); toast.success(r.data.message); load(); } catch (err) { toast.error(err.response?.data?.detail || "Dönüştürülemedi."); } };
  const convertSurvey = async (sv) => { try { const r = await axios.post(`${API_URL}/surveys/${sv.id}/convert-to-quote`); toast.success(r.data.message); load(); } catch (err) { toast.error(err.response?.data?.detail || "Dönüştürülemedi."); } };

  const changeOrderStatus = async (o, status) => {
    if (!status || status === o.order_status) return;
    try {
      const r = await axios.put(`${API_URL}/orders/${o.id}/status`, { status });
      toast.success(r.data.message || "Sipariş durumu güncellendi.");
      await notifyDataChanged({ companyId: data?.contact?.company_id, scopes: ["orders", "invoices"] });
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Durum güncellenemedi."); }
  };
  const deleteContactOrder = async (o) => {
    if (o.is_invoiced || o.invoice_id) { toast.error("Faturalanmış sipariş silinemez."); return; }
    if (!window.confirm(`${o.order_number} silinsin mi?`)) return;
    try {
      const r = await axios.delete(`${API_URL}/orders/${o.id}`);
      toast.success(r.data.message || "Sipariş silindi.");
      await notifyDataChanged({ companyId: data?.contact?.company_id, scopes: ["orders"] });
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
  };
  const openEditOrder = (o) => {
    const reason = orderEditBlockedReason(o);
    if (reason) { toast.error(reason); return; }
    setEditOrder({
      id: o.id,
      order_number: o.order_number,
      notes: o.notes || "",
      customer_order_number: o.customer_order_number || "",
      items: (o.items || []).map((it) => hydrateLine(it)),
      linesLocked: orderChannelLocked(o),
    });
    if (!orderChannelLocked(o) && orderProducts.length === 0 && data?.contact?.company_id) {
      axios.get(`${API_URL}/products?company_id=${data.contact.company_id}&lite=1`).then((r) => setOrderProducts(r.data || [])).catch(() => {});
    }
  };
  const saveEditOrder = async () => {
    if (!editOrder) return;
    const items = (editOrder.items || []).filter((it) => (it.product_name || it.name) && Number(it.quantity) > 0);
    if (!editOrder.linesLocked && items.length === 0) { toast.error("Siparişte en az bir kalem olmalı."); return; }
    try {
      const payload = { notes: editOrder.notes, customer_order_number: editOrder.customer_order_number };
      if (!editOrder.linesLocked) payload.items = items;
      const r = await axios.put(`${API_URL}/orders/${editOrder.id}`, payload);
      toast.success(r.data.message || "Sipariş güncellendi.");
      setEditOrder(null);
      await notifyDataChanged({ companyId: data?.contact?.company_id, scopes: ["orders"] });
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Sipariş güncellenemedi."); }
  };

  const [editInv, setEditInv] = useState(null);
  const [editQuote, setEditQuote] = useState(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [invCtx, setInvCtx] = useState(null);
  const colState = useSortableColumns();
  const sortedInvoices = useSortedRows(data?.invoices || [], colState.sort);
  const closeInvCtx = React.useCallback(() => setInvCtx(null), []);
  // Fatura işlemleri ⋮ düğmesinden açılır (sağ tık hızlı menüye ayrıldı).
  const openInvCtxFromButton = (e, inv) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setInvCtx({ x: Math.max(8, r.right - 256), y: r.bottom + 4, inv });
  };
  const [balancePlan, setBalancePlan] = useState(false);
  const [insts, setInsts] = useState([]);
  const contactCompanyId = data?.contact?.company_id;
  const loadInsts = useCallback(() => { if (contactCompanyId) axios.get(`${API_URL}/installments?company_id=${contactCompanyId}&contact_id=${contactId}`).then((r) => setInsts(r.data)).catch(() => {}); }, [contactCompanyId, contactId]);
  useEffect(() => { loadInsts(); }, [loadInsts]);
  useEffect(() => { if (tab === "installments" && contactCompanyId) { loadInsts(); axios.get(`${API_URL}/banking/accounts?company_id=${contactCompanyId}`).then((r) => setAccounts(r.data)).catch(() => {}); } }, [tab, contactCompanyId, loadInsts]);
  const [surveyDetail, setSurveyDetail] = useState(null);
  const [trackingProject, setTrackingProject] = useState(null);
  const [editPay, setEditPay] = useState(null);
  const isLockedTx = (p) => p.source === "bank_sync" || p.source === "partner" || p.source === "cheque" || p.virtual;
  const lockedTxLabel = (p) => (p.source === "partner" ? "Ortak" : p.source === "cheque" || p.virtual ? "Çek" : "Banka");
  const lockedTxTitle = (p) => (p.source === "cheque" || p.virtual ? "Çek/senet kaydından geldi — Çek/Senet modülünden yönetilir" : "Banka entegrasyonu / ortaklar hesabından geldi — düzenlenemez");
  const deletePay = async (p) => {
    const chequeId = p.cheque_id;
    const label = p.type === "inflow" ? "tahsilat" : "ödeme";
    if (chequeId) {
      if (!window.confirm(`${fmt(p.amount)} ₺ çek/senet kaydı silinsin mi? Cari bakiyesi geri alınır.`)) return;
      try {
        const r = await axios.delete(`${API_URL}/cheques/${chequeId}`);
        toast.success(r.data.message || "Silindi.");
        await notifyDataChanged({ companyId: c.company_id, scopes: ["cash", "contacts"] });
        load();
      } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
      return;
    }
    if (p.source === "bank_sync" || p.source === "partner") {
      toast.error(lockedTxTitle(p));
      return;
    }
    if (!window.confirm(`${fmt(p.amount)} ₺ tutarındaki ${label} silinsin mi? Bakiyeler geri alınır.`)) return;
    try { const r = await axios.delete(`${API_URL}/banking/transactions/${p.id}`); toast.success(r.data.message); await notifyDataChanged({ companyId: c.company_id, scopes: ["cash", "contacts"] }); load(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
  };
  const openEditPay = async (p) => {
    if (p.cheque_id) {
      try {
        const r = await axios.get(`${API_URL}/cheques/${p.cheque_id}`);
        const ch = r.data || {};
        setEditPay({
          id: ch.id || p.cheque_id,
          cheque: true,
          type: ch.direction === "issued" ? "outflow" : "inflow",
          amount: ch.amount,
          date: ch.due_date || ch.issue_date || p.date,
          description: ch.notes || p.description || "",
          serial_no: ch.serial_no || "",
          bank_name: ch.bank_name || "",
        });
      } catch (err) { toast.error(err.response?.data?.detail || "Çek/senet yüklenemedi."); }
      return;
    }
    if (p.source === "bank_sync" || p.source === "partner") {
      toast.error(lockedTxTitle(p));
      return;
    }
    try { const r = await axios.get(`${API_URL}/banking/accounts?company_id=${c.company_id}`); setAccounts(r.data); setEditPay({ ...p, cheque: false }); } catch { toast.error("Hesaplar yüklenemedi."); }
  };
  const savePayEdit = async (e) => {
    e.preventDefault();
    try {
      if (editPay.cheque) {
        await axios.put(`${API_URL}/cheques/${editPay.id}`, {
          amount: Number(editPay.amount),
          due_date: editPay.date,
          notes: editPay.description,
          serial_no: editPay.serial_no,
          bank_name: editPay.bank_name,
        });
      } else {
        await axios.put(`${API_URL}/banking/transactions/${editPay.id}`, { amount: Number(editPay.amount), date: editPay.date, description: editPay.description, account_id: editPay.account_id });
      }
      toast.success("Güncellendi.");
      setEditPay(null);
      await notifyDataChanged({ companyId: c.company_id, scopes: ["cash", "contacts"] });
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };
  const [payForm, setPayForm] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const openPay = async () => {
    try {
      const r = await axios.get(`${API_URL}/banking/accounts?company_id=${c.company_id}`);
      setAccounts(r.data);
      const isIn = (c.balance || 0) >= 0;
      const pool = isIn ? collectableAccounts(r.data) : r.data;
      setPayForm({ amount: Math.max(0, c.balance || 0).toFixed(2), account_id: pool[0]?.id || "", description: isIn ? "Cari tahsilat" : "Cari ödeme", type: isIn ? "inflow" : "outflow", method: "cash", instrument: "cheque", due_date: new Date().toISOString().slice(0, 10), serial_no: "", bank_name: "", slip: "debit" });
    } catch { toast.error("Hesaplar yüklenemedi."); }
  };
  const savePay = async (e) => {
    e.preventDefault();
    try {
      const amount = Number(payForm.amount);
      if (!(amount > 0)) { toast.error("Tutar sıfırdan büyük olmalı."); return; }
      if (payForm.method === "ledger") {
        await axios.post(`${API_URL}/contacts/${c.id}/ledger-slip`, {
          kind: payForm.slip === "credit" ? "credit" : "debit",
          amount,
          description: payForm.description,
        });
        toast.success(payForm.slip === "credit" ? "Alacak fişi kaydedildi." : "Borç fişi kaydedildi.");
      } else if (payForm.method === "cheque" || payForm.method === "promissory") {
        await axios.post(`${API_URL}/cheques`, {
          company_id: c.company_id,
          contact_id: c.id,
          instrument: payForm.method === "promissory" ? "promissory" : "cheque",
          direction: payForm.type === "inflow" ? "received" : "issued",
          amount,
          due_date: payForm.due_date,
          serial_no: payForm.serial_no,
          bank_name: payForm.bank_name,
          notes: payForm.description,
        });
        toast.success(payForm.method === "promissory" ? "Senet kaydedildi." : "Çek kaydedildi.");
      } else {
        const target = splitPaymentTarget(payForm.account_id);
        if (target.partner_id) {
          await axios.post(`${API_URL}/contacts/${c.id}/record-payment`, { partner_id: target.partner_id, type: payForm.type, amount, description: payForm.description });
        } else {
          const acc = accounts.find((a) => a.id === payForm.account_id);
          await axios.post(`${API_URL}/banking/transactions`, { company_id: c.company_id, account_id: payForm.account_id, account_name: acc?.account_name, type: payForm.type, category: payForm.type === "inflow" ? "Cari Tahsilat" : "Cari Ödeme", amount, currency: "TRY", description: `${c.name}: ${payForm.description}`, contact_id: c.id, contact_name: c.name, source: "manual" });
        }
        toast.success(payForm.type === "inflow" ? "Tahsilat kaydedildi." : "Ödeme kaydedildi.");
      }
      setPayForm(null); await notifyDataChanged({ companyId: c.company_id, scopes: ["cash", "contacts"] }); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); }
  };
  const [waMsg, setWaMsg] = useState("");
  const [waPhone, setWaPhone] = useState("");
  const saveInvoiceEdit = async () => {
    try { await axios.put(`${API_URL}/invoices/${editInv.id}`, editInv.status === "draft" ? { e_type: editInv.e_type, due_date: editInv.due_date, notes: editInv.notes, items: editInv.items } : { due_date: editInv.due_date, notes: editInv.notes }); toast.success("Fatura güncellendi."); setEditInv(null); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };
  const sendWa = async (openLink) => {
    if (!waMsg.trim()) { toast.error("Mesaj boş olamaz."); return; }
    try {
      const phone = waPhone || c.phone;
      if (waPhone && waPhone !== c.phone) await axios.put(`${API_URL}/contacts/${c.id}`, { phone: waPhone });
      const r = await axios.post(`${API_URL}/comm/whatsapp/${openLink ? "send" : "logs"}`, { company_id: c.company_id, contact_id: c.id, contact_name: c.name, phone, message: waMsg, direction: "outbound" });
      if (openLink && r.data.status !== "sent") window.open(r.data.wa_link, "_blank");
      toast.success(r.data.message_info || "Görüşme kaydedildi."); setWaMsg(""); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Gönderilemedi."); }
  };
  const sendToGib = async (inv, eType) => {
    setBusy(inv.id);
    try { const r = await axios.post(`${API_URL}/invoices/${inv.id}/send-to-gib`, { e_type: eType || inv.e_type }); toast.success(r.data.message || "E-Fatura GİB'e gönderildi."); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Gönderilemedi."); } finally { setBusy(null); }
  };
  const acceptIncoming = async (inv) => {
    if (!window.confirm(`${inv.invoice_number} gelen e-faturası onaylansın mı?`)) return;
    setBusy(inv.id);
    try { const r = await axios.post(`${API_URL}/invoices/${inv.id}/accept-incoming`); toast.success(r.data.message); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Onaylanamadı."); } finally { setBusy(null); }
  };
  const rejectIncoming = async (inv) => {
    const reason = window.prompt(`${inv.invoice_number} reddedilsin mi? İsteğe bağlı neden:`, "") ?? null;
    if (reason === null) return;
    setBusy(inv.id);
    try { const r = await axios.post(`${API_URL}/invoices/${inv.id}/reject-incoming`, { reason }); toast.success(r.data.message); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Reddedilemedi."); } finally { setBusy(null); }
  };

  const deleteInvoice = async (inv) => {
    const kind = inv.status === "draft" ? "taslak fatura" : "kağıt fatura";
    if (!window.confirm(`${inv.invoice_number} numaralı ${kind} çöp kutusuna taşınsın mı?`)) return;
    try {
      const r = await axios.delete(`${API_URL}/invoices/${inv.id}`);
      toast.success(r.data.message || "Fatura silindi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    }
  };

  const cancelInvoice = async (inv) => {
    if (!window.confirm(`${inv.invoice_number} numaralı fatura iptal edilsin mi?\nCari bakiyesi ve stok etkileri geri alınır; kayıt listede kalır.`)) return;
    try {
      const r = await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/cancel`, {});
      toast.success(r.data.message || "Fatura iptal edildi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İptal edilemedi.");
    }
  };
  const issueExpenseSlip = async (inv) => {
    if (!window.confirm(`${inv.invoice_number} için gider pusulası kesilsin mi?\nAynı cari ve kalemlerle alış pusulası oluşur.`)) return;
    try {
      const r = await axios.post(`${API_URL}/invoices/${inv.id || inv._id}/expense-slip`);
      toast.success(r.data.message || "Gider pusulası kesildi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gider pusulası kesilemedi.");
    }
  };

  if (!data) return <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center"><Loader2 className="w-6 h-6 text-white animate-spin" /></div>;
  const { contact: c, summary: s } = data;
  const bal = Number(c.balance) || 0;
  const invoiced = Number(s.total_invoiced) || 0;
  const paid = Number(s.total_paid) || 0;
  const open = Number(s.open_amount) || 0;
  const summaryDiverge = Math.abs(Math.abs(bal) - Math.abs(open)) > 0.5;
  const summaryCards = [
    { key: "balance", label: "Cari hesap", hint: bal > 0 ? "Müşteri size borçlu" : bal < 0 ? "Siz bu cariye borçlusunuz" : "Hesap denk — borç yok", badge: bal > 0 ? "Alacak" : bal < 0 ? "Borç" : "Kapalı", value: bal, cls: bal > 0 ? "text-emerald-700" : bal < 0 ? "text-rose-700" : "text-slate-800", title: "Satış, alış ve kasa/banka hareketlerinin net bakiyesi. Artı = alacak, eksi = borç." },
    { key: "invoiced", label: "Satış faturaları", hint: "Onaylı satışların toplamı", badge: null, value: invoiced, cls: "text-slate-900", title: "Taslaklar hariç kesilmiş satış faturalarının tutarı." },
    { key: "paid", label: "Tahsil edilen", hint: "Bu faturalara yazılan tahsilat", badge: null, value: paid, cls: "text-emerald-700", title: "Satış faturalarına işlenmiş tahsilat. Kasa hareketi faturaya bağlanmadıysa cari hesaba yansır, buraya yansımaz." },
    { key: "open", label: "Kalan alacak", hint: "Fatura − tahsilat", badge: open > 0 ? "Açık" : "Kapalı", value: open, cls: open > 0 ? "text-rose-700" : "text-slate-800", title: "Satış faturası toplamı eksi tahsilat. Cari hesaptan farklı olabilir (alış faturası veya bağlanmamış ödeme)." },
    { key: "cheques", label: "Çek / senet", hint: "Açık alınan − verilen", badge: (Number(c.cheque_bond_balance) || 0) !== 0 ? "Portföy" : null, value: Number(c.cheque_bond_balance) || 0, cls: "text-indigo-700", title: "Açık alınan çek/senet eksi açık verilen. Tahsil, ciro veya ödeme sonrası düşer." },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6" onClick={onClose}>
      <div className="bg-white w-full max-w-[min(1680px,calc(100vw-2rem))] h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()} data-testid="contact-detail-panel">
        <div className="px-6 py-4 border-b flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {c.logo_url ? <div className="w-12 h-12 rounded-xl border border-slate-200 bg-white overflow-hidden shrink-0" data-testid="detail-contact-logo"><img src={resolveImageUrl(c.logo_url)} alt="" className="w-full h-full object-contain" /></div> : null}
            <div className="min-w-0">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${c.type === "customer" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{c.type === "customer" ? "Müşteri" : c.type === "supplier" ? "Tedarikçi" : "Müşteri & Tedarikçi"}</span>
            <h2 className="text-lg font-bold text-slate-900 mt-1">{c.name}</h2>
            <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1 mt-1">
              <span>VKN/TCKN: {c.tax_number_or_id}</span>
              {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {c.phone}</span>}
              {c.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {c.email}</span>}
              {mapsLink(c) && <a href={mapsLink(c)} target="_blank" rel="noreferrer" className="text-rose-600 font-semibold flex items-center gap-1 hover:underline"><Navigation className="w-3 h-3" /> Konum</a>}
            </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button type="button" onClick={() => setEditContactOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg text-xs font-semibold transition" title="Cari bilgilerini düzenle" data-testid="detail-edit-contact-btn"><Pencil className="w-3.5 h-3.5" /> Cariyi Düzenle</button>
            <button onClick={() => navigate(`/invoices?new=sales&contact_id=${c.id}`)} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition" title="Bu cariye satış faturası kes" data-testid="detail-sell-btn"><ArrowUpRight className="w-3.5 h-3.5" /> Satış Yap</button>
            <button onClick={() => navigate(`/invoices?new=purchase&contact_id=${c.id}`)} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg text-xs font-semibold transition" title="Bu cariden alış faturası gir" data-testid="detail-buy-btn"><ArrowDownLeft className="w-3.5 h-3.5" /> Alış Yap</button>
            <button onClick={openPay} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition" data-testid="detail-collect-btn"><Wallet className="w-3.5 h-3.5" /> Tahsilat</button>
            <span className="w-px h-6 bg-slate-200 mx-1" aria-hidden="true" />
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5" data-testid="detail-icon-actions">
              <button onClick={() => onMessage?.(c)} className="p-1.5 rounded-md text-slate-600 hover:bg-white hover:text-indigo-600 transition" title="SMS / E-posta / WhatsApp mesajı" data-testid="detail-message-btn"><MessageSquare className="w-4 h-4" /></button>
              <button onClick={async () => { try { const r = await axios.post(`${API_URL}/contacts/${c.id}/b2b-access`, { enabled: true, base_url: window.location.origin, discount: c.b2b_discount || 0 }); await navigator.clipboard?.writeText(r.data.link).catch(() => {}); toast.success(`B2B portal linki kopyalandı: ${r.data.link}`); window.open(r.data.link, "_blank"); load(); } catch (err) { toast.error(err.response?.data?.detail || "B2B erişimi oluşturulamadı."); } }} className={`p-1.5 rounded-md transition hover:bg-white ${c.b2b_enabled ? "text-blue-600" : "text-slate-600 hover:text-blue-600"}`} title={c.b2b_enabled ? "B2B portal linki (aktif)" : "Müşteriye B2B sipariş portalı linki ver"} data-testid="detail-b2b-access-btn"><ShoppingCart className="w-4 h-4" /></button>
              <button onClick={() => setTermsOpen(true)} className="relative p-1.5 rounded-md text-slate-600 hover:bg-white hover:text-slate-900 transition" title={`Vade uygula${c.payment_term_days ? ` (${c.payment_term_days} gün)` : ""}`} data-testid="detail-terms-btn"><CalendarClock className="w-4 h-4" />{c.payment_term_days ? <span className="absolute -top-1 -right-1 text-[8px] bg-slate-900 text-white rounded-full px-1 leading-3">{c.payment_term_days}</span> : null}</button>
              <button onClick={() => setBalancePlan(true)} disabled={!c.balance} className="p-1.5 rounded-md text-slate-600 hover:bg-white hover:text-violet-600 transition disabled:opacity-30" title="Açık bakiyeyi taksitlendir" data-testid="detail-balance-installments-btn"><Layers className="w-4 h-4" /></button>
            </div>
            <button onClick={onClose} className="ml-1 text-slate-400 hover:text-slate-700 flex items-center gap-1" title="Kapat (Esc)" data-testid="close-contact-detail-btn"><kbd className="text-[9px] border rounded px-1 text-slate-400">ESC</kbd><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="px-6 py-3 bg-slate-50 border-b text-xs space-y-2" data-testid="contact-summary-strip">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {summaryCards.map((card) => (
              <div key={card.key} className="bg-white border border-slate-200 rounded-xl p-2.5" title={card.title} data-testid={`detail-summary-${card.key}`}>
                <div className="flex items-center justify-between gap-1">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{card.label}</div>
                  <Info className="w-3 h-3 text-slate-300 shrink-0" aria-hidden="true" />
                </div>
                <div className={`font-bold text-sm mt-0.5 ${card.cls}`}>{fmt(card.value)} ₺{card.badge ? <span className="ml-1.5 text-[10px] font-semibold text-slate-400">{card.badge}</span> : null}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{card.hint}</div>
              </div>
            ))}
          </div>
          {summaryDiverge && (
            <p className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5" data-testid="contact-summary-note">
              <b>Cari hesap</b> alış faturası ve kasa hareketlerini de içerir; <b>kalan alacak</b> yalnızca satış faturaları − tahsilattır. Bu yüzden iki tutar aynı olmayabilir.
            </p>
          )}
        </div>

        <div className="flex items-center gap-0.5 px-4 border-b overflow-x-auto shrink-0" data-testid="contact-detail-tabs">
          {TABS.map(([k, l, Icon]) => {
            const count = k === "invoices" ? data.invoices.length
              : k === "payments" ? data.payments.length
              : k === "orders" ? data.orders.length
              : k === "quotes" ? (data.quotes || []).length
              : k === "projects" ? (data.projects || []).length
              : k === "surveys" ? (data.surveys || []).length
              : k === "installments" ? insts.filter((i) => i.status !== "paid").length
              : k === "cheques" ? (data.cheques || []).length
              : k === "whatsapp" ? data.communications.filter((m) => m.channel === "whatsapp").length
              : k === "mail_status" ? (data.email_deliveries || []).length
              : k === "comm" ? data.communications.length
              : 0;
            return (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-2.5 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap shrink-0 ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`} data-testid={`detail-tab-${k}`}>
              <Icon className="w-3.5 h-3.5" /> {l} <span className="text-slate-400">({count})</span>
            </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6 text-xs">
          {tab === "invoices" && data.invoices.some((i) => i.status === "draft") && (() => { const drafts = data.invoices.filter((i) => i.status === "draft"); const appr = data.invoices.filter((i) => i.status !== "draft"); return (
            <div className="mb-3 flex flex-wrap gap-2" data-testid="detail-inv-summary">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5"><span className="text-emerald-700 font-semibold">{appr.length} onaylı fatura</span> · <b>{fmt(appr.reduce((a, i) => a + Number(i.grand_total || 0), 0))} ₺</b> <span className="text-emerald-700/70">(bakiyeye işlendi)</span></div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5"><span className="text-amber-800 font-semibold">{drafts.length} taslak</span> · <b>{fmt(drafts.reduce((a, i) => a + Number(i.grand_total || 0), 0))} ₺</b> <span className="text-amber-800/70">(bakiyeye işlenmez — onaylandığında işlenir)</span></div>
            </div>); })()}
          {tab === "invoices" && (
            <table className="w-full text-left">
              <SortableHeader {...colState} />
              <tbody className="divide-y divide-slate-100">
                {data.invoices.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-400">Fatura yok.</td></tr>}
                {sortedInvoices.map((inv) => { const incoming = isIncomingPurchaseInvoice(inv); const cells = {
                    number: <td key="number" className="py-2 font-mono font-semibold text-slate-900"><button onClick={() => setEditInv({ ...inv })} className={`hover:underline ${inv.status === "draft" ? "text-emerald-700" : "text-slate-900"}`} title={inv.status === "draft" ? "Taslağı düzenle" : "Faturayı düzenle (vade / not)"} data-testid={`detail-inv-edit-${inv.invoice_number}`}>{inv.invoice_number}</button></td>,
                    date: <td key="date" className="py-2 text-slate-500">{inv.issue_date}</td>,
                    type: <td key="type" className="py-2"><span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase">{inv.invoice_type === "sales" ? "Satış" : inv.invoice_type === "purchase" ? "Alış" : inv.invoice_type === "dispatch" ? "İrsaliye" : inv.invoice_type}</span> <span className="text-slate-400">{E_TYPE_TR[inv.e_type] || inv.e_type}</span></td>,
                    amount: <td key="amount" className={`py-2 text-right font-bold ${inv.status === "draft" ? "text-slate-400" : ""}`}>{fmt(inv.grand_total)} ₺{inv.status === "draft" && <div className="text-[9px] font-semibold text-amber-700 uppercase tracking-wide" data-testid={`detail-inv-draft-${inv.invoice_number}`}>Taslak · bakiye dışı</div>}</td>,
                    gib: <td key="gib" className="py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${inv.status === "draft" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{inv.gib_status || "Taslak"}</span></td>,
                    payment: <td key="payment" className="py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${inv.payment_status === "paid" ? "bg-emerald-100 text-emerald-800" : inv.payment_status === "partially_paid" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>{inv.payment_status === "paid" ? "Ödendi" : inv.payment_status === "partially_paid" ? "Kısmi" : "Cariye işlendi"}</span></td>,
                  }; return (
                  <tr key={inv.id} className={`${invCtx?.inv?.id === inv.id ? "bg-emerald-50/60" : "hover:bg-slate-50"} ${inv.status === "draft" ? "border-l-2 border-amber-400 bg-amber-50/30" : ""}`} data-testid={`detail-inv-${inv.invoice_number}`}>
                    {colState.cols.map((k) => cells[k])}
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <button onClick={() => setEditInv({ ...inv })} className="p-1.5 text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition" title={inv.status === "draft" ? "Taslağı düzenle" : "Faturayı düzenle (vade / not)"} data-testid={`detail-inv-edit-btn-${inv.invoice_number}`}><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setPrintDoc(inv)} className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition" title="Görüntüle / Şablonlu Yazdır" data-testid={`detail-inv-print-${inv.invoice_number}`}><Printer className="w-4 h-4" /></button>
                        {onMessage ? (
                          <button onClick={() => onMessage(c)} className="p-1.5 text-slate-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition" title="SMS / E-posta gönder" data-testid={`detail-inv-notify-${inv.invoice_number}`}><MessageSquare className="w-4 h-4" /></button>
                        ) : <span className="w-7 h-7" aria-hidden="true" />}
                        {inv.status === "draft" && !incoming ? (
                          <button onClick={() => sendToGib(inv, inv.e_type)} disabled={busy === inv.id} className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition disabled:opacity-40" title={`${E_TYPE_TR[inv.e_type] || inv.e_type} olarak kes — başka tür için ⋮`} data-testid={`detail-gib-btn-${inv.invoice_number}`}>{busy === inv.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button>
                        ) : busy === inv.id ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <span className="w-7 h-7" aria-hidden="true" />}
                                                {canDeleteInvoice(inv) && (
                          <button onClick={() => deleteInvoice(inv)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition" title={inv.status === "draft" ? "Taslağı sil" : "Kağıt faturayı sil"} data-testid={`detail-inv-delete-${inv.invoice_number}`}><Trash2 className="w-4 h-4" /></button>
                        )}
<button type="button" onClick={(e) => openInvCtxFromButton(e, inv)} className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition" title={incoming ? "Gelen e-fatura işlemleri" : "Fatura kesim & diğer işlemler"} data-testid={`detail-inv-more-${inv.invoice_number}`}><MoreVertical className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
          )}
          {tab === "installments" && (
            <div className="space-y-3" data-testid="detail-installments">
              <div className="flex items-center justify-between text-xs"><span className="text-slate-500">{insts.filter((i) => i.status !== "paid").length} bekleyen • {insts.filter((i) => i.is_overdue).length} vadesi geçen • Kalan <b className="text-slate-900">{fmt(insts.filter((i) => i.status !== "paid").reduce((s, i) => s + i.amount - (i.paid_amount || 0), 0))} ₺</b></span><button onClick={() => setBalancePlan(true)} disabled={!c.balance} className="px-3 py-1.5 border border-violet-200 text-violet-700 rounded-lg font-semibold hover:bg-violet-50 disabled:opacity-40" data-testid="detail-inst-new-plan">+ Bakiyeyi Taksitlendir</button></div>
              {insts.length === 0 && <div className="text-center text-xs text-slate-400 py-8">Bu cariye ait taksit yok. Fatura satırındaki ⋮ menüden "Taksitlendir" veya "Bakiyeyi Taksitlendir" ile plan oluşturun.</div>}
              {Object.entries(insts.reduce((acc, r) => { const k = r.invoice_id || "bal"; (acc[k] = acc[k] || []).push(r); return acc; }, {})).map(([k, list]) => (
                <div key={k} className="border border-slate-200 rounded-xl p-3 space-y-2" data-testid={`detail-inst-group-${list[0].invoice_number}`}>
                  <div className="flex items-center gap-2 text-xs"><span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${list[0].direction === "receivable" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{list[0].direction === "receivable" ? "ALACAK" : "BORÇ"}</span><span className="font-mono font-bold">{list[0].invoice_number}</span><span className="text-slate-400">{list.filter((r) => r.status === "paid").length}/{list[0].total_count} ödendi</span></div>
                  <InstallmentRows rows={list} accounts={accounts} companyId={c.company_id} onPaid={() => { loadInsts(); load(); }} />
                </div>
              ))}
            </div>
          )}
          {tab === "cheques" && (
            <table className="w-full text-left" data-testid="detail-cheques">
              <thead className="text-slate-500 uppercase text-[10px] font-semibold border-b"><tr><th className="py-2">No</th><th className="py-2">Yön</th><th className="py-2">Vade</th><th className="py-2">Durum</th><th className="py-2 text-right">Tutar</th><th className="py-2"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {!(data.cheques || []).length && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Bu cariye ait çek/senet yok. <button onClick={() => navigate("/cheques")} className="text-teal-700 underline">Çek / Senet modülü</button></td></tr>}
                {(data.cheques || []).map((ch) => (
                  <tr key={ch.id} data-testid={`detail-cheque-${ch.number}`}>
                    <td className="py-2 font-mono font-semibold">{ch.number}</td>
                    <td className="py-2">{ch.direction === "received" ? "Alınan" : "Verilen"} {ch.instrument === "promissory" ? "senet" : "çek"}</td>
                    <td className="py-2 font-mono">{ch.due_date}</td>
                    <td className="py-2"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100">{ch.status_label || ch.status}</span></td>
                    <td className="py-2 text-right font-bold">{fmt(ch.amount)} ₺</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => setReceipt(chequeReceipt(ch))} className="px-2 py-1 border rounded-md text-[10px] font-semibold hover:bg-slate-50" data-testid={`detail-cheque-receipt-${ch.number}`}>Makbuz</button>
                        <button type="button" onClick={() => openEditPay({ cheque_id: ch.id, amount: ch.amount, type: ch.direction === "received" ? "inflow" : "outflow" })} className="inline-flex items-center gap-1 px-2 py-1 border rounded-md text-[10px] font-semibold text-slate-700 hover:bg-slate-50" data-testid={`detail-cheque-edit-${ch.number}`}><Pencil className="w-3 h-3" /> Düzenle</button>
                        <button type="button" onClick={() => deletePay({ cheque_id: ch.id, amount: ch.amount, type: ch.direction === "received" ? "inflow" : "outflow" })} className="inline-flex items-center gap-1 px-2 py-1 border border-rose-200 rounded-md text-[10px] font-semibold text-rose-600 hover:bg-rose-50" data-testid={`detail-cheque-delete-${ch.number}`}><Trash2 className="w-3 h-3" /> Sil</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "payments" && (
            <table className="w-full text-left">
              <thead className="text-slate-500 uppercase text-[10px] font-semibold border-b"><tr><th className="py-2">Tarih</th><th className="py-2">Hesap</th><th className="py-2">Açıklama</th><th className="py-2 text-right">Tutar</th><th className="py-2"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.payments.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-400">Ödeme hareketi yok.</td></tr>}
                {data.payments.map((p) => (
                  <tr key={p.id} data-testid={`detail-pay-${p.id}`}>
                    <td className="py-2 font-mono text-slate-500">{p.date}</td>
                    <td className="py-2 font-semibold">{p.account_name} {isLockedTx(p) && <span className="inline-flex items-center gap-0.5 text-[9px] text-slate-400 font-semibold ml-1" title={lockedTxTitle(p)}><Lock className="w-2.5 h-2.5" /> {lockedTxLabel(p)}</span>}</td>
                    <td className="py-2 text-slate-600">{p.category} • {p.description}</td>
                    <td className={`py-2 text-right font-bold ${p.type === "inflow" ? "text-emerald-600" : "text-rose-600"}`}>{p.type === "inflow" ? "+" : "-"}{fmt(p.amount)} ₺</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => setReceipt(p)} className="px-2 py-1 border rounded-md text-[10px] font-semibold hover:bg-slate-50" data-testid={`receipt-btn-${p.id}`}>Makbuz</button>
                        <button type="button" onClick={() => openEditPay(p)} className="inline-flex items-center gap-1 px-2 py-1 border rounded-md text-[10px] font-semibold text-slate-700 hover:bg-slate-50" data-testid={`pay-edit-btn-${p.id}`}><Pencil className="w-3 h-3" /> Düzenle</button>
                        <button type="button" onClick={() => deletePay(p)} className="inline-flex items-center gap-1 px-2 py-1 border border-rose-200 rounded-md text-[10px] font-semibold text-rose-600 hover:bg-rose-50" data-testid={`pay-delete-btn-${p.id}`}><Trash2 className="w-3 h-3" /> Sil</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "orders" && (
            <table className="w-full text-left">
              <thead className="text-slate-500 uppercase text-[10px] font-semibold border-b"><tr><th className="py-2">Sipariş</th><th className="py-2">Kanal</th><th className="py-2">Durum</th><th className="py-2">Kargo</th><th className="py-2 text-right">Tutar</th><th className="py-2"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.orders.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Sipariş yok.</td></tr>}
                {data.orders.map((o) => {
                  const marketplace = orderChannelLocked(o);
                  const canDelete = !o.is_invoiced && !o.invoice_id;
                  return (
                    <tr key={o.id} data-testid={`detail-order-${o.order_number}`}>
                      <td className="py-2 font-mono font-semibold">{o.order_number}</td>
                      <td className="py-2 text-slate-500">{channelTr(o.channel)}</td>
                      <td className="py-2">
                        {marketplace ? (
                          <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-semibold" title="Durum pazaryerinden güncellenir">{statusTr(o.order_status)}</span>
                        ) : (
                          <select value={o.order_status || "pending"} onChange={(e) => changeOrderStatus(o, e.target.value)} className="bg-slate-100 border border-slate-200 rounded p-1 text-[11px] font-semibold" data-testid={`detail-order-status-${o.order_number}`}>
                            {ORDER_STATUS_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            {o.order_status && !ORDER_STATUS_OPTIONS.some(([k]) => k === o.order_status) && <option value={o.order_status}>{statusTr(o.order_status)}</option>}
                          </select>
                        )}
                      </td>
                      <td className="py-2 font-mono text-slate-500">{o.cargo_tracking_number || "—"}</td>
                      <td className="py-2 text-right font-bold">{fmt(o.grand_total ?? o.total_amount)} ₺</td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => openEditOrder(o)} className="inline-flex items-center gap-1 px-2 py-1 border rounded-md text-[10px] font-semibold hover:bg-slate-50" data-testid={`detail-order-edit-${o.order_number}`}><Pencil className="w-3 h-3" /> Düzenle</button>
                          {canDelete && <button type="button" onClick={() => deleteContactOrder(o)} className="inline-flex items-center gap-1 px-2 py-1 border border-rose-200 rounded-md text-[10px] font-semibold text-rose-600 hover:bg-rose-50" data-testid={`detail-order-delete-${o.order_number}`}><Trash2 className="w-3 h-3" /> Sil</button>}
                          <button type="button" onClick={() => setPrintDoc(o)} className="px-2 py-1 border rounded-md text-[10px] font-semibold" title="Sipariş Yazdır" data-testid={`detail-order-print-${o.order_number}`}>Yazdır</button>
                          <button type="button" onClick={() => setOrderDetail(o)} className="px-2 py-1 bg-slate-900 text-white rounded-md text-[10px] font-semibold" data-testid={`detail-order-btn-${o.order_number}`}>Detay</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {tab === "quotes" && (
            <table className="w-full text-left">
              <thead className="text-slate-500 uppercase text-[10px] font-semibold border-b"><tr><th className="py-2">Teklif</th><th className="py-2">Başlık</th><th className="py-2">Tarih</th><th className="py-2 text-right">Tutar</th><th className="py-2">Durum</th><th className="py-2"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(data.quotes || []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Teklif yok. <button onClick={() => navigate("/quotes")} className="text-emerald-700 underline">Teklif oluştur</button></td></tr>}
                {(data.quotes || []).map((q) => <tr key={q.id} data-testid={`detail-quote-${q.quote_number}`}><td className="py-2 font-mono font-semibold"><button onClick={() => setEditQuote(q)} className="hover:underline text-emerald-700" data-testid={`detail-quote-open-${q.quote_number}`}>{q.quote_number}</button></td><td className="py-2">{q.title}</td><td className="py-2 text-slate-500">{q.issue_date}</td><td className="py-2 text-right font-bold">{fmt(q.grand_total)} ₺</td><td className="py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${q.status === "accepted" ? "bg-emerald-50 text-emerald-700" : q.status === "rejected" ? "bg-rose-50 text-rose-700" : q.status === "sent" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{statusTr(q.status)}{q.approval?.status === "pending" && q.status === "sent" ? " • Onay bekliyor" : ""}</span></td><td className="py-2 text-right"><div className="flex justify-end gap-1"><button onClick={() => setEditQuote(q)} className="inline-flex items-center gap-1 px-2 py-1 border rounded-md text-[10px] font-semibold hover:bg-slate-50" data-testid={`detail-quote-edit-${q.quote_number}`}><Pencil className="w-3 h-3" /> Düzenle</button><button onClick={() => setPrintDoc({ ...q, _docType: "quote" })} className="px-2 py-1 border rounded-md text-[10px] font-semibold">Yazdır</button>{!q.project_id && <button onClick={() => convertQuoteToProject(q)} className="px-2 py-1 bg-slate-900 text-white rounded-md text-[10px] font-semibold" data-testid={`detail-quote-to-project-${q.quote_number}`}>Projeye Çevir</button>}{!q.invoice_id && <button onClick={() => convertQuote(q)} className="px-2 py-1 bg-emerald-600 text-white rounded-md text-[10px] font-semibold" data-testid={`detail-quote-convert-${q.quote_number}`}>Faturaya Çevir</button>}</div></td></tr>)}
              </tbody>
            </table>
          )}
          {tab === "projects" && (
            <table className="w-full text-left">
              <thead className="text-slate-500 uppercase text-[10px] font-semibold border-b"><tr><th className="py-2">Proje</th><th className="py-2">Ad</th><th className="py-2">Durum</th><th className="py-2 text-right">Bütçe</th><th className="py-2"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(data.projects || []).length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Proje yok. <button onClick={() => navigate("/projects")} className="text-emerald-700 underline">Proje oluştur</button></td></tr>}
                {[...(data.projects || [])].sort((a, b) => Number(b.status === "completed") - Number(a.status === "completed")).map((p) => (
                  <tr key={p.id} className={p.status === "completed" ? "bg-emerald-50/40" : ""} data-testid={`detail-project-${p.project_number}`}>
                    <td className="py-2 font-mono font-semibold">{p.project_number}</td>
                    <td className="py-2">{p.name}</td>
                    <td className="py-2"><div className="flex flex-col gap-0.5 items-start"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${p.status === "completed" ? "bg-emerald-50 text-emerald-700" : p.status === "active" ? "bg-blue-50 text-blue-700" : p.status === "on_hold" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`} data-testid={`detail-project-status-${p.project_number}`}>{statusTr(p.status)}</span><TrackingBadge project={p} /></div></td>
                    <td className="py-2 text-right font-bold">{fmt(p.budget)} ₺</td>
                    <td className="py-2 text-right"><button onClick={() => setTrackingProject(p)} className="inline-flex items-center gap-1 px-2 py-1 border border-emerald-200 text-emerald-700 bg-emerald-50 rounded-md text-[10px] font-semibold" data-testid={`detail-project-track-${p.project_number}`}><Link2 className="w-3 h-3" /> Takip Linki</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "surveys" && (
            <table className="w-full text-left">
              <thead className="text-slate-500 uppercase text-[10px] font-semibold border-b"><tr><th className="py-2">Keşif</th><th className="py-2">Tarih</th><th className="py-2">Adres</th><th className="py-2">Durum</th><th className="py-2"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(data.surveys || []).length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Keşif yok. <button onClick={() => navigate("/surveys")} className="text-emerald-700 underline">Keşif planla</button></td></tr>}
                {(data.surveys || []).map((sv) => <tr key={sv.id} data-testid={`detail-survey-${sv.survey_number}`}><td className="py-2 font-mono font-semibold"><button onClick={() => setSurveyDetail(sv)} className="hover:underline" data-testid={`detail-survey-open-${sv.survey_number}`}>{sv.survey_number}</button></td><td className="py-2 text-slate-500">{sv.survey_date}</td><td className="py-2">{sv.address} {workMapsLink(sv) ? <a href={workMapsLink(sv)} target="_blank" rel="noreferrer" className="text-rose-600 font-semibold" data-testid={`detail-survey-maps-${sv.survey_number}`}>• Konuma Git</a> : null}</td><td className="py-2"><span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-semibold">{statusTr(sv.status)}</span></td><td className="py-2 text-right"><div className="flex justify-end gap-1"><button onClick={() => setSurveyDetail(sv)} className="inline-flex items-center gap-1 px-2 py-1 border rounded-md text-[10px] font-semibold hover:bg-slate-50" data-testid={`detail-survey-view-${sv.survey_number}`}><Eye className="w-3 h-3" /> Detay</button>{!sv.quote_id && <button onClick={() => convertSurvey(sv)} className="px-2 py-1 bg-emerald-600 text-white rounded-md text-[10px] font-semibold">Teklife Çevir</button>}</div></td></tr>)}
              </tbody>
            </table>
          )}
          {tab === "whatsapp" && (
            <div className="space-y-3" data-testid="detail-whatsapp-tab">
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-green-600" /><b>WhatsApp numarası</b><input value={waPhone || c.phone || ""} onChange={(e) => setWaPhone(e.target.value)} placeholder="05XX XXX XX XX" className="bg-white border border-green-200 rounded-lg p-1.5 font-mono w-44" data-testid="detail-wa-phone" /><span className="text-[10px] text-slate-500">(değiştirirseniz cari telefonu güncellenir; gelen mesajlar bu numaraya göre eşlenir)</span></div>
                <textarea value={waMsg} onChange={(e) => setWaMsg(e.target.value)} rows={3} placeholder="Mesaj yazın..." className="w-full bg-white border border-green-200 rounded-lg p-2" data-testid="detail-wa-message" />
                <div className="flex justify-end gap-2"><button onClick={() => sendWa(false)} className="px-3 py-1.5 border rounded-lg font-semibold" data-testid="detail-wa-log-btn">Görüşme Kaydet</button><button onClick={() => sendWa(true)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg font-semibold" data-testid="detail-wa-send-btn">WhatsApp'ta Gönder</button></div>
              </div>
              {data.communications.filter((m) => m.channel === "whatsapp").length === 0 && <div className="py-4 text-center text-slate-400">WhatsApp görüşmesi yok.</div>}
              {data.communications.filter((m) => m.channel === "whatsapp").map((m) => <div key={m.id} className={`max-w-[80%] rounded-2xl px-3 py-2 ${m.direction === "inbound" ? "bg-slate-100 mr-auto" : "bg-green-100 ml-auto"}`} data-testid={`detail-wa-msg-${m.id}`}><p className="text-slate-800">{m.message}</p><div className="text-[10px] text-slate-400 text-right">{new Date(m.created_at).toLocaleString("tr-TR")} • {statusTr(m.status)}</div></div>)}
            </div>
          )}
          {tab === "mail_status" && (
            <div className="space-y-2" data-testid="email-delivery-list">
              <p className="text-[11px] text-slate-500">Son 90 gündeki fatura, sipariş, teklif, ekstre ve diğer e-posta gönderileri. Okundu bilgisi, alıcı iletiyi görseller açıkken açınca kaydedilir.</p>
              {(data.email_deliveries || []).length === 0 && <div className="py-6 text-center text-slate-400">Son 90 günde e-posta gönderimi yok.</div>}
              {(data.email_deliveries || []).length > 0 && (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2">Tarih</th>
                        <th className="text-left font-semibold px-3 py-2">Tür</th>
                        <th className="text-left font-semibold px-3 py-2">Konu</th>
                        <th className="text-left font-semibold px-3 py-2">Alıcı</th>
                        <th className="text-left font-semibold px-3 py-2">Durum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(data.email_deliveries || []).map((m) => {
                        const badge = mailDeliveryBadge(m);
                        const to = Array.isArray(m.to) ? m.to.join(", ") : (m.to || "");
                        return (
                          <tr key={m.id} data-testid={`email-delivery-${m.id}`}>
                            <td className="px-3 py-2 whitespace-nowrap text-slate-500">{m.created_at ? new Date(m.created_at).toLocaleString("tr-TR") : ""}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{MAIL_KIND[m.context] || m.context || "Mesaj"}</td>
                            <td className="px-3 py-2 font-semibold text-slate-800 max-w-[220px] truncate" title={m.subject}>{m.subject || "(Konu yok)"}</td>
                            <td className="px-3 py-2 text-slate-600 max-w-[180px] truncate" title={to}>{to}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className={`inline-flex px-2 py-0.5 rounded-md font-bold ${badge.cls}`} data-testid={`email-delivery-status-${m.id}`}>{badge.text}</span>
                              {m.opened_at && <div className="text-[10px] text-slate-400 mt-0.5">{new Date(m.opened_at).toLocaleString("tr-TR")}{m.open_count > 1 ? ` · ${m.open_count} kez` : ""}</div>}
                              {m.status === "failed" && m.error && <div className="text-[10px] text-rose-500 mt-0.5 max-w-[200px] truncate" title={m.error}>{m.error}</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {tab === "comm" && (
            <div className="space-y-2">
              {data.communications.length === 0 && <div className="py-6 text-center text-slate-400">İletişim geçmişi yok.</div>}
              {data.communications.map((m) => (
                <div key={m.id} className="border border-slate-200 rounded-xl p-3 flex gap-3">
                  <div className={`p-1.5 rounded-lg h-fit ${m.channel === "sms" ? "bg-indigo-50 text-indigo-600" : m.channel === "whatsapp" ? "bg-green-50 text-green-600" : "bg-emerald-50 text-emerald-600"}`}>{m.channel === "sms" ? <MessageSquare className="w-4 h-4" /> : m.channel === "whatsapp" ? <Phone className="w-4 h-4" /> : <Mail className="w-4 h-4" />}</div>
                  <div className="flex-1"><div className="flex justify-between"><b>{m.channel === "sms" ? `SMS → ${m.to}` : m.channel === "whatsapp" ? `WhatsApp ${m.direction === "inbound" ? "← " : "→ "}${m.to}` : m.subject}</b><span className="text-slate-400">{new Date(m.created_at).toLocaleString("tr-TR")}</span></div><p className="text-slate-600 mt-1">{m.message || m.body}</p><span className={`text-[10px] font-semibold ${m.status === "failed" ? "text-rose-600" : "text-emerald-600"}`}>{statusTr(m.status)}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
        {printDoc && <PrintDocument docType={printDoc._docType || (printDoc.order_number ? "order" : "invoice")} doc={printDoc} company={activeCompany} onClose={() => setPrintDoc(null)} onEditTemplate={() => setEditTpl(printDoc.order_number ? "order" : "invoice")} />}
        {editTpl && <PrintTemplateEditor companyId={c.company_id} docType={editTpl} onClose={() => setEditTpl(null)} />}
        {receipt && <ReceiptPrint tx={receipt} contact={c} company={activeCompany} onClose={() => setReceipt(null)} />}
        <InvoiceContextMenu menu={invCtx} onClose={closeInvCtx} onIssue={(inv, eType) => sendToGib(inv, eType)} onPreview={(inv) => setPrintDoc(inv)} onPrint={(inv) => setPrintDoc(inv)} onNotify={() => onMessage?.(c)} onPayment={() => openPay()} onAcceptIncoming={acceptIncoming} onRejectIncoming={rejectIncoming} onDelete={deleteInvoice} onCancel={cancelInvoice} onExpenseSlip={issueExpenseSlip} />
        {termsOpen && <ContactTermsModal contact={c} onClose={() => setTermsOpen(false)} onSaved={load} />}
        {balancePlan && <InstallmentPlanModal kind="balance" doc={{ id: c.id, contact_name: c.name, grand_total: Math.abs(c.balance || 0), invoice_number: "Açık Bakiye", direction: c.balance >= 0 ? "receivable" : "payable" }} accounts={accounts} companyId={c.company_id} onClose={() => setBalancePlan(false)} onChanged={() => { load(); loadInsts(); }} />}
        {editQuote && <QuoteEditModal quote={editQuote} onClose={() => setEditQuote(null)} onSaved={load} />}
        {surveyDetail && <SurveyDetailModal survey={surveyDetail} onClose={() => setSurveyDetail(null)} onChanged={load} />}
        {trackingProject && <ProjectTrackingModal project={trackingProject} contact={c} onClose={() => setTrackingProject(null)} onSent={load} />}
        {editPay && (
          <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setEditPay(null)}>
            <form onSubmit={savePayEdit} className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="pay-edit-modal">
              <div className="flex justify-between border-b pb-2"><h3 className="text-sm font-bold">{editPay.cheque ? "Çek / Senet Düzenle" : editPay.type === "inflow" ? "Tahsilat Düzenle" : "Ödeme Düzenle"}</h3><button type="button" onClick={() => setEditPay(null)} className="text-slate-400"><X className="w-5 h-5" /></button></div>
              <div><label className="block font-semibold mb-1">{editPay.cheque ? "Vade" : "Tarih"}</label><input type="date" value={editPay.date || ""} onChange={(e) => setEditPay({ ...editPay, date: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="pay-edit-date" /></div>
              {editPay.cheque ? (
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block font-semibold mb-1">Seri no</label><input value={editPay.serial_no || ""} onChange={(e) => setEditPay({ ...editPay, serial_no: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="pay-edit-serial" /></div>
                  <div><label className="block font-semibold mb-1">Banka</label><input value={editPay.bank_name || ""} onChange={(e) => setEditPay({ ...editPay, bank_name: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="pay-edit-bank" /></div>
                </div>
              ) : (
                <div><label className="block font-semibold mb-1">Kasa / Banka / Kart / Ortak</label><PaymentTargetSelect companyId={c.company_id} accounts={accounts} value={editPay.account_id} onChange={(v) => setEditPay({ ...editPay, account_id: v })} testId="pay-edit-account" collectableOnly={editPay.type === "inflow"} includePartners={false} /></div>
              )}
              <div><label className="block font-semibold mb-1">Tutar (₺)</label><input type="number" step="0.01" min="0.01" value={editPay.amount} onChange={(e) => setEditPay({ ...editPay, amount: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2 font-bold text-base" required data-testid="pay-edit-amount" /></div>
              <div><label className="block font-semibold mb-1">{editPay.cheque ? "Not" : "Açıklama"}</label><input value={editPay.description || ""} onChange={(e) => setEditPay({ ...editPay, description: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="pay-edit-desc" /></div>
              <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setEditPay(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="pay-edit-save">Kaydet</button></div>
            </form>
          </div>
        )}
        {payForm && (
          <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setPayForm(null)}>
            <form onSubmit={savePay} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="collect-modal">
              <div className="flex justify-between border-b pb-2"><h3 className="text-sm font-bold">Tahsilat / Ödeme — {c.name}</h3><button type="button" onClick={() => setPayForm(null)} className="text-slate-400"><X className="w-5 h-5" /></button></div>
              <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { const pool = collectableAccounts(accounts); setPayForm({ ...payForm, type: "inflow", account_id: pool.some((a) => a.id === payForm.account_id) ? payForm.account_id : (pool[0]?.id || "") }); }} className={`p-2 rounded-lg border font-semibold ${payForm.type === "inflow" ? "bg-emerald-600 text-white border-emerald-600" : ""}`} data-testid="collect-type-in">Tahsilat (Müşteriden)</button><button type="button" onClick={() => setPayForm({ ...payForm, type: "outflow" })} className={`p-2 rounded-lg border font-semibold ${payForm.type === "outflow" ? "bg-rose-600 text-white border-rose-600" : ""}`} data-testid="collect-type-out">Ödeme (Cariye)</button></div>
              <div className="grid grid-cols-2 gap-1.5">
                {[["cash", "Nakit / Hesap"], ["cheque", "Çek"], ["promissory", "Senet"], ["ledger", "Borç / Alacak Fişi"]].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setPayForm({ ...payForm, method: k })} className={`px-2 py-1.5 rounded-lg border font-semibold ${payForm.method === k ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600"}`} data-testid={`collect-method-${k}`}>{l}</button>
                ))}
              </div>
              {payForm.method === "ledger" ? (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setPayForm({ ...payForm, slip: "debit", description: payForm.description === "Cari tahsilat" || payForm.description === "Cari ödeme" ? "Borç fişi" : payForm.description })} className={`p-2 rounded-lg border font-semibold ${payForm.slip !== "credit" ? "bg-rose-50 border-rose-300 text-rose-800" : ""}`} data-testid="collect-slip-debit">Borç fişi</button>
                  <button type="button" onClick={() => setPayForm({ ...payForm, slip: "credit", description: payForm.description === "Cari tahsilat" || payForm.description === "Cari ödeme" ? "Alacak fişi" : payForm.description })} className={`p-2 rounded-lg border font-semibold ${payForm.slip === "credit" ? "bg-emerald-50 border-emerald-300 text-emerald-800" : ""}`} data-testid="collect-slip-credit">Alacak fişi</button>
                </div>
              ) : payForm.method === "cheque" || payForm.method === "promissory" ? (
                <div className="space-y-2">
                  <p className="text-[10px] text-slate-500">{payForm.type === "inflow" ? "Alınan" : "Verilen"} {payForm.method === "promissory" ? "senet" : "çek"} cariye işlenir; tahsil/ödeme vadesinde Çek ve Senetler sekmesinden yapılır.</p>
                  <div><label className="block font-semibold mb-1">Vade</label><input type="date" value={payForm.due_date || ""} onChange={(e) => setPayForm({ ...payForm, due_date: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="collect-due-date" /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="block font-semibold mb-1">Seri no</label><input value={payForm.serial_no || ""} onChange={(e) => setPayForm({ ...payForm, serial_no: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="collect-serial" /></div>
                    <div><label className="block font-semibold mb-1">Banka</label><input value={payForm.bank_name || ""} onChange={(e) => setPayForm({ ...payForm, bank_name: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="collect-bank" /></div>
                  </div>
                </div>
              ) : (
                <>
                  <div><label className="block font-semibold mb-1">{payForm.type === "inflow" ? "Kasa / Banka / POS / Ortak" : "Kasa / Banka / Kart / Ortak"}</label><PaymentTargetSelect companyId={c.company_id} accounts={accounts} value={payForm.account_id} onChange={(v) => setPayForm({ ...payForm, account_id: v })} testId="collect-account-select" collectableOnly={payForm.type === "inflow"} /></div>
                  {payForm.type === "inflow" && <p className="text-[10px] text-slate-400">Tahsilatta kredi kartı seçilemez; ortaklar hesabı kullanılabilir.</p>}
                </>
              )}
              {payForm.method === "ledger" && <p className="text-[10px] text-slate-500">Borç fişi cari borcunu artırır, alacak fişi düşürür. Kasa ve banka bakiyesi değişmez.</p>}
              <div><label className="block font-semibold mb-1">Tutar (₺)</label><input type="number" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2 font-bold text-base" required data-testid="collect-amount-input" /></div>
              <div><label className="block font-semibold mb-1">Açıklama</label><input value={payForm.description} onChange={(e) => setPayForm({ ...payForm, description: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" /></div>
              <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setPayForm(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="collect-save-btn">{payForm.method === "ledger" ? "Fişi Kaydet" : "Kaydet"}</button></div>
            </form>
          </div>
        )}
        {editInv && (
          <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setEditInv(null)}>
            <div className="bg-white rounded-2xl max-w-6xl w-full p-5 space-y-3 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="invoice-edit-modal">
              <div className="flex justify-between border-b pb-2"><h3 className="text-sm font-bold">{editInv.status === "draft" ? "Taslak Fatura Düzenle" : "Fatura Düzenle"} — {editInv.invoice_number}</h3><button onClick={() => setEditInv(null)} className="text-slate-400"><X className="w-5 h-5" /></button></div>
              {editInv.status !== "draft" && <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-800 flex items-center gap-1" data-testid="edit-inv-locked-note"><Lock className="w-3 h-3" /> Kesilmiş fatura: kalemler ve belge türü değiştirilemez; yalnızca vade ve not düzenlenebilir.</div>}
              <div className="grid grid-cols-3 gap-2">
                <div><label className="block font-semibold mb-1">Belge Türü</label><select disabled={editInv.status !== "draft"} value={editInv.e_type} onChange={(e) => setEditInv({ ...editInv, e_type: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="edit-inv-etype"><option value="e_invoice">E-Fatura</option><option value="e_archive">E-Arşiv</option><option value="e_export">e-İhracat</option><option value="paper">Kağıt Fatura</option><option value="e_dispatch">E-İrsaliye</option></select></div>
                <div><label className="block font-semibold mb-1">Vade</label><input type="date" value={editInv.due_date || ""} onChange={(e) => setEditInv({ ...editInv, due_date: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" /></div>
                <div><label className="block font-semibold mb-1">Not</label><input value={editInv.notes || ""} onChange={(e) => setEditInv({ ...editInv, notes: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" /></div>
              </div>
              <DocumentLineEditor
                items={(editInv.items || []).map(hydrateLine)}
                onChange={(items) => setEditInv({ ...editInv, items })}
                products={[]}
                kind="invoice"
                allowService
                disabled={editInv.status !== "draft"}
                testIdPrefix="edit-inv-item"
              />
              {(() => { const t = documentLineTotals(editInv.items || []); return (
              <div className="flex justify-between items-center border-t pt-2"><div className="text-right space-y-0.5"><div>KDV Hariç: <b>{fmtMoney(t.subtotal)} ₺</b></div><div>KDV: <b>{fmtMoney(t.vat)} ₺</b></div><div className="font-bold">Genel Toplam (KDV Dahil): {fmtMoney(t.grandTotal)} ₺</div></div><div className="flex gap-2"><button onClick={() => setEditInv(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={saveInvoiceEdit} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="edit-inv-save-btn">Kaydet</button></div></div>
              ); })()}
            </div>
          </div>
        )}
        {editOrder && (
          <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setEditOrder(null)}>
            <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-3 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="detail-order-edit-modal">
              <div className="flex justify-between border-b pb-2"><h3 className="text-sm font-bold">Sipariş Düzenle · {editOrder.order_number}</h3><button type="button" onClick={() => setEditOrder(null)} className="text-slate-400"><X className="w-5 h-5" /></button></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label className="block font-semibold mb-1">Müşteri sipariş no</label><input value={editOrder.customer_order_number} onChange={(e) => setEditOrder({ ...editOrder, customer_order_number: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="detail-order-edit-po" /></div>
                <div><label className="block font-semibold mb-1">Not</label><input value={editOrder.notes} onChange={(e) => setEditOrder({ ...editOrder, notes: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="detail-order-edit-notes" /></div>
              </div>
              {editOrder.linesLocked ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-800">Pazaryeri kalemleri değiştirilemez. Not ve müşteri sipariş numarası kaydedilir.</div>
              ) : (
                <DocumentLineEditor items={editOrder.items} onChange={(items) => setEditOrder({ ...editOrder, items })} products={orderProducts} kind="order" testIdPrefix="detail-order-line" />
              )}
              <div className="flex justify-end gap-2 border-t pt-2"><button type="button" onClick={() => setEditOrder(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="button" onClick={saveEditOrder} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="detail-order-edit-save">Kaydet</button></div>
            </div>
          </div>
        )}
        {orderDetail && (
          <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setOrderDetail(null)}>
            <div className="bg-white rounded-2xl max-w-5xl w-full p-5 space-y-3 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="order-detail-modal">
              <div className="flex justify-between items-start border-b pb-2"><div><h3 className="text-sm font-bold text-slate-900">Sipariş {orderDetail.order_number}</h3><p className="text-slate-500">{new Date(orderDetail.order_date).toLocaleString("tr-TR")} • {channelTr(orderDetail.channel)} • <b>{statusTr(orderDetail.order_status)}</b></p></div><button onClick={() => setOrderDetail(null)} className="text-slate-400"><X className="w-5 h-5" /></button></div>
              <div className="text-slate-600"><b>Teslimat:</b> {orderDetail.shipping_address}, {orderDetail.city} {orderDetail.customer_phone && `• ${orderDetail.customer_phone}`}</div>
              {orderDetail.cargo_tracking_number && <div className="text-slate-600"><b>Kargo:</b> {orderDetail.cargo_carrier} • <span className="font-mono">{orderDetail.cargo_tracking_number}</span></div>}
              <div className="overflow-x-auto"><table className="w-full min-w-[640px]"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="py-1 text-left">Stok adı</th><th className="py-1 text-right">Miktar</th><th className="py-1 text-right">KDV'siz</th><th className="py-1 text-right">KDV'li</th><th className="py-1 text-center">İsk %</th><th className="py-1 text-center">KDV</th><th className="py-1 text-right">Hariç</th><th className="py-1 text-right">Dahil</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{(orderDetail.items || []).map((it, i) => { const line = hydrateLine(it); return (<tr key={i}><td className="py-1.5"><div className="font-semibold">{line.product_name || line.name}</div><div className="font-mono text-slate-400">{it.sku}</div>{it.note ? <div className="text-slate-500 italic">{it.note}</div> : null}</td><td className="py-1.5 text-right">{line.quantity}</td><td className="py-1.5 text-right">{fmtMoney(line.unit_price)} ₺</td><td className="py-1.5 text-right">{fmtMoney(line.unit_price_incl)} ₺</td><td className="py-1.5 text-center">{line.discount_rate || 0}</td><td className="py-1.5 text-center">%{line.vat_rate}</td><td className="py-1.5 text-right">{fmtMoney(line.total)} ₺</td><td className="py-1.5 text-right font-bold">{fmtMoney(line.total_incl)} ₺</td></tr>); })}</tbody></table></div>
              {(() => {
                const t = documentLineTotals(orderDetail.items || []);
                const footer = orderFooterTotals(orderDetail, t);
                return (
              <div className="space-y-0.5 border-t pt-2"><div className="flex justify-between"><span>KDV Hariç</span><span>{fmtMoney(footer.subtotal)} ₺</span></div><div className="flex justify-between"><span>KDV</span><span>{fmtMoney(footer.vat)} ₺</span></div><div className="flex justify-between font-bold"><span>Genel Toplam (KDV Dahil)</span><span>{fmtMoney(footer.grandTotal)} ₺</span></div></div>
                );
              })()}
              <div className="flex justify-between text-slate-500"><span>Fatura: {orderDetail.is_invoiced ? "Kesildi" : "Kesilmedi"}</span></div>
              <InvoiceActionPanel
                orderId={orderDetail.id || orderDetail._id}
                invoiceId={orderDetail.invoice_id || null}
                companyId={activeCompany?.id || activeCompany?._id || orderDetail.company_id}
                alreadyIssued={Boolean(orderDetail.is_invoiced && orderDetail.einvoice_state === "sent")}
                defaultEType="e_invoice"
                defaultScenario="TICARI"
                onInvoiceCreated={() => { setOrderDetail(null); load(); }}
              />
            </div>
          </div>
        )}
      {editContactOpen && (
        <ContactForm
          companyId={c.company_id || activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}
          contact={c}
          onClose={() => setEditContactOpen(false)}
          onSaved={() => { setEditContactOpen(false); load(); }}
        />
      )}
      </div>
    </div>
  );
};

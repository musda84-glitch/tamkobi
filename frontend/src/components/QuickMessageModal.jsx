import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, MessageSquare, Mail, Send, Loader2, Paperclip } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export const TEMPLATES = {
  balance: (c) => `Sayın ${c.name}, ${new Date().toLocaleDateString("tr-TR")} tarihi itibarıyla cari hesap bakiyeniz ${Math.abs(c.balance || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺ ${c.balance > 0 ? "borç" : "alacak"} olarak görünmektedir. Bilgilerinize sunarız.`,
  invoice: (inv) => `Sayın ${inv.contact_name}, ${inv.invoice_number} numaralı ${inv.grand_total?.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺ tutarındaki faturanız düzenlenmiştir.${inv.due_date ? ` Son ödeme tarihi: ${inv.due_date}.` : ""} Teşekkür ederiz.`,
  reminder: (inv) => `Sayın ${inv.contact_name}, ${inv.invoice_number} numaralı faturanızın ${(inv.grand_total - (inv.paid_amount || 0)).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺ tutarındaki bakiyesi ödenmemiştir. Ödemenizi rica ederiz.`,
  order: (o) => `Sayın ${o.customer_name}, ${o.order_number} numaralı siparişiniz ${o.cargo_carrier || "kargo"} ile yola çıktı. Takip No: ${o.cargo_tracking_number || "-"}. İyi günler dileriz.`
};

export const QuickMessageModal = ({ companyId, recipient, defaultSubject = "", defaultMessage = "", context = "manual", refId = null, channel = "sms", onClose, onSent }) => {
  const [tab, setTab] = useState(channel);
  const [phone, setPhone] = useState(recipient.phone || "");
  const [email, setEmail] = useState(recipient.email || "");
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    if (!message.trim()) { toast.error("Mesaj boş olamaz."); return; }
    setSending(true);
    try {
      if (tab === "sms") {
        const r = await axios.post(`${API_URL}/comm/sms/send`, { company_id: companyId, phone, message, contact_id: recipient.contact_id, contact_name: recipient.name, context, ref_id: refId });
        toast.success(r.data.message);
      } else {
        const fd = new FormData();
        fd.append("company_id", companyId); fd.append("to", email); fd.append("subject", subject); fd.append("body", message);
        fd.append("context", context); fd.append("ref_id", refId || ""); fd.append("contact_id", recipient.contact_id || ""); fd.append("contact_name", recipient.name || "");
        files.forEach((f) => fd.append("files", f));
        const r = await axios.post(`${API_URL}/comm/mail/send`, fd, { withCredentials: true });
        toast.success(r.data.message);
      }
      onSent?.(); onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gönderim başarısız.");
    } finally { setSending(false); }
  };

  useEffect(() => { const esc = (e) => e.key === "Escape" && onClose(); document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [onClose]);
  const smsCount = Math.ceil(message.length / (/[çğıöşüÇĞİÖŞÜ]/.test(message) ? 70 : 160)) || 1;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200" onClick={(e) => e.stopPropagation()} data-testid="quick-message-modal">
        <div className="flex items-center justify-between border-b pb-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">Mesaj Gönder</h3>
            <p className="text-[11px] text-slate-500">{recipient.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <button type="button" onClick={() => setTab("sms")} className={`p-2 rounded-lg border font-semibold flex items-center justify-center gap-1.5 ${tab === "sms" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white"}`} data-testid="qm-tab-sms"><MessageSquare className="w-4 h-4" /> SMS (Netgsm)</button>
          <button type="button" onClick={() => setTab("email")} className={`p-2 rounded-lg border font-semibold flex items-center justify-center gap-1.5 ${tab === "email" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"}`} data-testid="qm-tab-email"><Mail className="w-4 h-4" /> E-posta</button>
        </div>
        <form onSubmit={send} className="space-y-3 text-xs">
          {tab === "sms" ? (
            <div><label className="block font-semibold mb-1">GSM Numarası</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05XX XXX XX XX" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono" required data-testid="qm-phone-input" /></div>
          ) : (<>
            <div><label className="block font-semibold mb-1">Alıcı E-posta</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" required data-testid="qm-email-input" /></div>
            <div><label className="block font-semibold mb-1">Konu</label><input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="qm-subject-input" /></div>
          </>)}
          <div>
            <label className="block font-semibold mb-1">Mesaj</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={tab === "sms" ? 4 : 7} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="qm-message-input" />
            {tab === "sms" && <p className="text-[10px] text-slate-400 mt-1">{message.length} karakter • ~{smsCount} SMS</p>}
          </div>
          {tab === "email" && (
            <label className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer"><Paperclip className="w-3.5 h-3.5" /> {files.length ? `${files.length} dosya eklendi` : "Dosya ekle"}<input type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} data-testid="qm-files-input" /></label>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
            <button type="submit" disabled={sending} className={`flex items-center gap-1.5 px-4 py-1.5 text-white rounded-lg font-semibold disabled:opacity-60 ${tab === "sms" ? "bg-indigo-600" : "bg-emerald-600"}`} data-testid="qm-send-btn">{sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Gönder</button>
          </div>
        </form>
      </div>
    </div>
  );
};

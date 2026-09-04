import React, { useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, Send, Mail, MessageSquare, Phone, Copy, Loader2, CheckCircle2, Clock, XCircle, Eye } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export const ApprovalBadge = ({ quote }) => {
  const ap = quote.approval;
  if (!ap) return null;
  const m = { accepted: ["bg-emerald-50 text-emerald-700", CheckCircle2, `Onaylandı${ap.responder_name ? " • " + ap.responder_name : ""}`], rejected: ["bg-rose-50 text-rose-700", XCircle, "Reddedildi"], pending: ["bg-amber-50 text-amber-700", Clock, `Onay bekliyor${ap.view_count ? " • görüntülendi" : ""}`] };
  const [cls, Icon, label] = m[ap.status] || m.pending;
  return <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`} title={ap.responded_at ? new Date(ap.responded_at).toLocaleString("tr-TR") : ""} data-testid={`approval-badge-${quote.quote_number}`}><Icon className="w-3 h-3" /> {label}</span>;
};

export const QuoteSendApprovalModal = ({ quote, contact, onClose, onSent }) => {
  useEscape(onClose);
  const [channels, setChannels] = useState({ sms: !!contact?.phone, email: false, whatsapp: !!contact?.phone });
  const [phone, setPhone] = useState(contact?.phone || "");
  const [email, setEmail] = useState(contact?.email || "");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const link = quote.approval?.link;
  const send = async () => {
    const list = Object.keys(channels).filter((k) => channels[k]);
    if (!list.length) { toast.error("En az bir kanal seçin."); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/quotes/${quote.id}/send-approval`, { channels: list, phone, email, base_url: window.location.origin });
      setRes(r.data); toast[r.data.status === "success" ? "success" : "error"](r.data.message); onSent?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Gönderilemedi."); } finally { setBusy(false); }
  };
  const copy = async (l) => { try { await navigator.clipboard.writeText(l); toast.success("Link kopyalandı."); } catch { toast.error("Kopyalanamadı."); } };
  const Ch = ({ k, icon: Icon, label, sub, ok }) => (
    <label className={`flex items-start gap-2 border-2 rounded-xl p-2.5 cursor-pointer transition ${channels[k] ? "border-emerald-600 bg-emerald-50" : "border-slate-200"} ${!ok ? "opacity-60" : ""}`}><input type="checkbox" checked={channels[k]} onChange={(e) => setChannels({ ...channels, [k]: e.target.checked })} className="mt-0.5 rounded" data-testid={`approval-ch-${k}`} /><span><span className="flex items-center gap-1 font-bold text-slate-900"><Icon className="w-3.5 h-3.5" /> {label}</span><span className="block text-[10px] text-slate-500">{sub}</span></span></label>
  );
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="quote-approval-modal">
        <div className="flex justify-between items-start border-b pb-2"><div><h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Send className="w-4 h-4 text-emerald-600" /> Onaya Gönder — {quote.quote_number}</h3><p className="text-slate-500">{quote.contact_name} • Müşteri linke tıklayıp tek tıkla onaylar/reddeder, sonuç teklife işlenir.</p></div><button onClick={onClose} className="text-slate-400" data-testid="approval-close"><X className="w-5 h-5" /></button></div>
        <div className="grid grid-cols-3 gap-2">
          <Ch k="sms" icon={MessageSquare} label="SMS" sub="Netgsm ile" ok={!!phone} />
          <Ch k="email" icon={Mail} label="E-posta" sub="Mail hesabı gerekir (Ayarlar)" ok={!!email} />
          <Ch k="whatsapp" icon={Phone} label="WhatsApp" sub="Cloud API / wa.me" ok={!!phone} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="block font-semibold mb-1">Telefon</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05XX…" className="w-full bg-slate-50 border rounded-lg p-2 font-mono" data-testid="approval-phone" /></div>
          <div><label className="block font-semibold mb-1">E-posta</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="musteri@firma.com" className="w-full bg-slate-50 border rounded-lg p-2" data-testid="approval-email" /></div>
        </div>
        {(res || link) && (
          <div className="bg-slate-50 border rounded-xl p-3 space-y-2" data-testid="approval-result">
            <div className="flex items-center gap-2"><span className="font-semibold text-slate-700">Onay linki:</span><a href={res?.link || link} target="_blank" rel="noreferrer" className="text-emerald-700 underline truncate flex-1 font-mono" data-testid="approval-link">{res?.link || link}</a><button onClick={() => copy(res?.link || link)} className="p-1 border rounded-md bg-white" title="Kopyala" data-testid="approval-copy"><Copy className="w-3.5 h-3.5" /></button><a href={res?.link || link} target="_blank" rel="noreferrer" className="p-1 border rounded-md bg-white" title="Önizle"><Eye className="w-3.5 h-3.5" /></a></div>
            {res && Object.entries(res.results).map(([k, v]) => <div key={k} className="flex items-center gap-2"><span className="w-16 font-bold uppercase text-slate-500">{k}</span><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${v.status === "sent" ? "bg-emerald-50 text-emerald-700" : v.status === "simulated" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{v.status === "sent" ? "Gönderildi" : v.status === "simulated" ? "SİMÜLE" : "Hata"}</span><span className="text-slate-500 truncate flex-1">{v.detail}</span>{v.wa_link && <a href={v.wa_link} target="_blank" rel="noreferrer" className="text-green-700 font-semibold underline">WhatsApp'ta aç</a>}</div>)}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t pt-2"><button onClick={onClose} className="px-3 py-1.5 border rounded-lg">Kapat</button><button onClick={send} disabled={busy} className="flex items-center gap-1 px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="approval-send">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {quote.approval?.sent_count ? "Tekrar Gönder" : "Gönder"}</button></div>
      </div>
    </div>
  );
};

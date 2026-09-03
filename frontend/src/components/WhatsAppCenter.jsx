import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { MessageCircle, ExternalLink, Send, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

export const WhatsAppCenter = ({ companyId, contacts }) => {
  const [logs, setLogs] = useState([]);
  const [form, setForm] = useState({ contact_id: "", phone: "", message: "", direction: "outbound" });
  const load = async () => { try { const r = await axios.get(`${API_URL}/comm/whatsapp/logs?company_id=${companyId}`); setLogs(r.data); } catch { toast.error("WhatsApp kayıtları yüklenemedi."); } };
  useEffect(() => { load(); }, [companyId]);

  const submit = async (e, openWa) => {
    e.preventDefault();
    const c = contacts.find((x) => x.id === form.contact_id);
    try {
      const url = form.direction === "outbound" && openWa ? `${API_URL}/comm/whatsapp/send` : `${API_URL}/comm/whatsapp/logs`;
      const r = await axios.post(url, { company_id: companyId, ...form, contact_id: c?.id, contact_name: c?.name });
      if (openWa && form.direction === "outbound" && r.data.status !== "sent") window.open(r.data.wa_link, "_blank");
      if (r.data.message_info) toast.info(r.data.message_info);
      toast.success(form.direction === "outbound" ? "Mesaj kaydedildi." : "Gelen görüşme kaydedildi."); setForm({ ...form, message: "" }); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5" data-testid="whatsapp-center">
      <form onSubmit={(e) => submit(e, true)} className="bg-white border border-green-200 rounded-2xl p-5 space-y-3 text-xs">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><MessageCircle className="w-4 h-4 text-green-600" /> WhatsApp Görüşmesi</h3>
        <p className="text-[10px] text-slate-500">Mesaj WhatsApp'ta (wa.me) açılır, görüşme cari kartının İletişim geçmişine kaydedilir. Müşteriden gelen mesajları da "Gelen" olarak kaydedebilirsiniz. (WhatsApp Business API bağlantısı için ayrıca anahtar gerekir.)</p>
        <select value={form.contact_id} onChange={(e) => { const c = contacts.find((x) => x.id === e.target.value); setForm({ ...form, contact_id: e.target.value, phone: c?.phone || form.phone }); }} className={inputCls} data-testid="wa-contact-select"><option value="">Cari seç</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="05XX XXX XX XX" className={`${inputCls} font-mono`} required data-testid="wa-phone-input" />
        <div className="grid grid-cols-2 gap-1">{[["outbound", "Giden", ArrowUpRight], ["inbound", "Gelen (Müşteriden)", ArrowDownLeft]].map(([k, l, Icon]) => <button key={k} type="button" onClick={() => setForm({ ...form, direction: k })} className={`p-2 rounded-lg border font-semibold flex items-center justify-center gap-1 ${form.direction === k ? "bg-green-600 text-white border-green-600" : ""}`} data-testid={`wa-dir-${k}`}><Icon className="w-3.5 h-3.5" /> {l}</button>)}</div>
        <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={4} placeholder="Mesaj / görüşme özeti" className={inputCls} required data-testid="wa-message-input" />
        <div className="flex gap-2">
          <button type="button" onClick={(e) => submit(e, false)} className="flex-1 px-3 py-2 border rounded-lg font-semibold hover:bg-slate-50" data-testid="wa-log-btn">Sadece Kaydet</button>
          {form.direction === "outbound" && <button type="submit" className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg font-semibold" data-testid="wa-send-btn"><Send className="w-3.5 h-3.5" /> WhatsApp'ta Aç</button>}
        </div>
      </form>
      <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b text-sm font-bold text-slate-900">WhatsApp Görüşme Geçmişi <span className="text-xs text-slate-400 font-medium">({logs.length})</span></div>
        <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
          {logs.length === 0 && <div className="p-8 text-center text-xs text-slate-400">Henüz görüşme yok.</div>}
          {logs.map((l) => (
            <div key={l.id} className="px-5 py-3 text-xs flex gap-3" data-testid={`wa-log-${l.id}`}>
              <div className={`p-1.5 rounded-lg h-fit ${l.direction === "inbound" ? "bg-slate-100 text-slate-600" : "bg-green-50 text-green-600"}`}>{l.direction === "inbound" ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}</div>
              <div className="flex-1"><div className="flex justify-between"><b>{l.contact_name || l.to} <span className="text-slate-400 font-mono font-normal">{l.to}</span></b><span className="text-slate-400">{new Date(l.created_at).toLocaleString("tr-TR")}</span></div><p className="text-slate-700 mt-0.5">{l.message}</p>{l.direction === "outbound" && <a href={l.wa_link} target="_blank" rel="noreferrer" className="text-green-700 font-semibold inline-flex items-center gap-1 mt-1"><ExternalLink className="w-3 h-3" /> WhatsApp'ta aç</a>}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

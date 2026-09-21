
import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Megaphone, Send, Loader2, Users } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

export const BulkCampaign = ({ companyId, contacts }) => {
  const [channel, setChannel] = useState("sms");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("Sayın {ad}, cari bakiyeniz {bakiye} olarak görünmektedir. Bilgilerinize sunarız.");
  const [busy, setBusy] = useState(false);

  const visible = contacts.filter((c) => filter === "all" || c.type === filter || c.type === "both").filter((c) => (channel === "sms" ? c.phone : c.email));
  const toggle = (id) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const selectAll = () => setSelected(visible.map((c) => c.id));

  const send = async (e) => {
    e.preventDefault();
    if (!selected.length) { toast.error("En az bir cari seçin."); return; }
    setBusy(true);
    try {
      if (channel === "sms") {
        const r = await axios.post(`${API_URL}/comm/sms/campaign`, { company_id: companyId, contact_ids: selected, message });
        toast.success(r.data.message);
      } else {
        let ok = 0, fail = 0;
        for (const id of selected) {
          const c = contacts.find((x) => x.id === id);
          const fd = new FormData();
          fd.append("company_id", companyId); fd.append("to", c.email); fd.append("subject", subject);
          fd.append("body", message.replace("{ad}", c.name).replace("{bakiye}", `${formatTrAmount((c.balance || 0))} ₺`));
          fd.append("context", "campaign"); fd.append("contact_id", c.id); fd.append("contact_name", c.name);
          try { await axios.post(`${API_URL}/comm/mail/send`, fd, { withCredentials: true }); ok++; } catch { fail++; }
        }
        toast[fail ? "warning" : "success"](`${ok} e-posta gönderildi${fail ? `, ${fail} başarısız` : ""}.`);
      }
      setSelected([]);
    } catch (err) { toast.error(err.response?.data?.detail || "Kampanya gönderilemedi."); } finally { setBusy(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5" data-testid="bulk-campaign">
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Users className="w-4 h-4 text-slate-500" /> Alıcılar <span className="text-xs text-slate-400 font-medium">({selected.length}/{visible.length} seçili)</span></h3>
          <div className="flex items-center gap-2 text-xs">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg p-1.5" data-testid="campaign-filter-select"><option value="all">Tümü</option><option value="customer">Müşteriler</option><option value="supplier">Tedarikçiler</option></select>
            <button onClick={selectAll} className="px-2.5 py-1.5 border rounded-lg font-semibold hover:bg-slate-50" data-testid="campaign-select-all-btn">Tümünü Seç</button>
            <button onClick={() => setSelected([])} className="px-2.5 py-1.5 border rounded-lg font-semibold hover:bg-slate-50">Temizle</button>
          </div>
        </div>
        <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-100">
          {visible.map((c) => (
            <label key={c.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50 cursor-pointer text-xs" data-testid={`campaign-contact-${c.id}`}>
              <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} className="accent-indigo-600" />
              <div className="flex-1"><div className="font-semibold text-slate-900">{c.name}</div><div className="text-slate-500 font-mono">{channel === "sms" ? c.phone : c.email}</div></div>
              <span className={`font-bold ${c.balance > 0 ? "text-emerald-600" : c.balance < 0 ? "text-rose-600" : "text-slate-500"}`}>{(c.balance || 0).toLocaleString("tr-TR")} ₺</span>
            </label>
          ))}
          {visible.length === 0 && <div className="px-5 py-8 text-center text-xs text-slate-400">Bu kanal için iletişim bilgisi olan cari bulunamadı.</div>}
        </div>
      </div>

      <form onSubmit={send} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm text-xs self-start">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Megaphone className="w-4 h-4 text-indigo-600" /> Toplu Kampanya</h3>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setChannel("sms")} className={`p-2 rounded-lg border font-semibold ${channel === "sms" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white"}`} data-testid="campaign-channel-sms">SMS</button>
          <button type="button" onClick={() => setChannel("email")} className={`p-2 rounded-lg border font-semibold ${channel === "email" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"}`} data-testid="campaign-channel-email">E-posta</button>
        </div>
        {channel === "email" && <div><label className="block font-semibold mb-1">Konu</label><input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} required data-testid="campaign-subject-input" /></div>}
        <div>
          <label className="block font-semibold mb-1">Mesaj Şablonu</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className={inputCls} required data-testid="campaign-message-input" />
          <p className="text-[10px] text-slate-400 mt-1">Değişkenler: <code>{"{ad}"}</code> cari adı, <code>{"{bakiye}"}</code> güncel bakiye</p>
        </div>
        <button type="submit" disabled={busy || !selected.length} className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 text-white rounded-lg font-semibold disabled:opacity-50 ${channel === "sms" ? "bg-indigo-600" : "bg-emerald-600"}`} data-testid="campaign-send-btn">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {selected.length} Alıcıya Gönder
        </button>
      </form>
    </div>
  );
};


import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { MessageSquare, Settings, Send, Loader2, Wallet, CheckCircle2, AlertCircle, FlaskConical, ShieldCheck } from "lucide-react";
import { contextTr } from "../utils/labels";
import { API_URL } from "../context/AuthContext";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

export const SmsCenter = ({ companyId, contacts }) => {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ usercode: "", password: "", msgheader: "", is_active: true });
  const [balance, setBalance] = useState(null);
  const [logs, setLogs] = useState([]);
  const [single, setSingle] = useState({ contact_id: "", phone: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([axios.get(`${API_URL}/comm/sms/settings?company_id=${companyId}`), axios.get(`${API_URL}/comm/sms/logs?company_id=${companyId}`)]);
      setSettings(s.data); setForm({ usercode: s.data.usercode || "", password: "", msgheader: s.data.msgheader || "", is_active: s.data.is_active ?? true }); setLogs(l.data);
    } catch { toast.error("SMS verileri yüklenemedi."); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const saveSettings = async (e) => {
    e.preventDefault();
    try {
      const saved = await axios.put(`${API_URL}/comm/sms/settings`, { company_id: companyId, ...form });
      setSettings(saved.data);
      toast.success("Netgsm ayarları kaydedildi. Bağlantıyı doğrulayın.");
      // Kaydet sonrası otomatik doğrula (şifre boşsa kayıtlı olan kullanılır)
      setVerifying(true);
      try {
        const v = await axios.post(`${API_URL}/comm/sms/verify`, { company_id: companyId });
        setSettings(v.data);
        if (v.data.verified) toast.success(v.data.verify_message || "Netgsm bağlantısı doğrulandı.");
        else toast.error(v.data.verify_message || v.data.verify?.message || "Netgsm doğrulanamadı.");
      } catch (err) {
        toast.error(err.response?.data?.detail || "Doğrulama yapılamadı.");
      } finally {
        setVerifying(false);
      }
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); }
  };

  const verifyConnection = async () => {
    setVerifying(true);
    try {
      const v = await axios.post(`${API_URL}/comm/sms/verify`, { company_id: companyId });
      setSettings(v.data);
      if (v.data.verified) toast.success(v.data.verify_message || "Netgsm bağlantısı doğrulandı.");
      else toast.error(v.data.verify_message || v.data.verify?.message || "Netgsm doğrulanamadı.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Doğrulama yapılamadı.");
    } finally {
      setVerifying(false);
    }
  };

  const checkBalance = async () => {
    try {
      const r = await axios.get(`${API_URL}/comm/sms/balance?company_id=${companyId}`);
      setBalance(r.data);
      if (!r.data.ok) toast.info(r.data.message || "Bakiye alınamadı.");
    } catch { toast.error("Bakiye sorgulanamadı."); }
  };

  const sendSingle = async (e) => {
    e.preventDefault();
    const c = contacts.find((x) => x.id === single.contact_id);
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/comm/sms/send`, { company_id: companyId, phone: single.phone, message: single.message, contact_id: c?.id, contact_name: c?.name, context: "manual" });
      if (r.data.status === "failed" || (r.data.failed > 0 && r.data.sent === 0)) {
        toast.error(r.data.error || r.data.message || "SMS gönderilemedi.");
      } else if (r.data.failed > 0) {
        toast.warning(r.data.message);
      } else {
        toast.success(r.data.message);
        setSingle({ ...single, message: "" });
      }
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Gönderilemedi."); } finally { setBusy(false); }
  };

  const configured = settings?.usercode && settings?.has_password;
  const connected = configured && settings?.verified && settings?.is_active;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5" data-testid="sms-center">
      <div className="space-y-5 lg:col-span-1">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Settings className="w-4 h-4 text-slate-500" /> Netgsm Ayarları</h3>
            {connected ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md px-2 py-0.5" data-testid="netgsm-status-connected"><CheckCircle2 className="w-3 h-3" /> BAĞLI</span>
            ) : configured ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-2 py-0.5" data-testid="netgsm-status-saved"><AlertCircle className="w-3 h-3" /> KAYITLI</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-slate-50 text-slate-600 border border-slate-200 rounded-md px-2 py-0.5" data-testid="netgsm-status-simulate"><FlaskConical className="w-3 h-3" /> SİMÜLE</span>
            )}
          </div>
          <form onSubmit={saveSettings} className="space-y-2 text-xs">
            <div><label className="block font-semibold mb-1">Kullanıcı Adı (usercode)</label><input value={form.usercode} onChange={(e) => setForm({ ...form, usercode: e.target.value })} className={`${inputCls} font-mono`} placeholder="850XXXXXXX" data-testid="netgsm-usercode-input" /></div>
            <div><label className="block font-semibold mb-1">API Şifresi {settings?.has_password && <span className="text-slate-400 font-normal">(kayıtlı — değiştirmek için girin)</span>}</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} data-testid="netgsm-password-input" autoComplete="new-password" /></div>
            <div>
              <label className="block font-semibold mb-1">Gönderici Başlığı (msgheader)</label>
              <input value={form.msgheader} onChange={(e) => setForm({ ...form, msgheader: e.target.value })} className={`${inputCls} uppercase`} placeholder="FIRMAADI" data-testid="netgsm-header-input" list="netgsm-approved-headers" />
              {(settings?.approved_headers || []).length > 0 && (
                <datalist id="netgsm-approved-headers">
                  {settings.approved_headers.map((h) => <option key={h} value={h} />)}
                </datalist>
              )}
              <p className="text-[10px] text-slate-400 mt-1">Netgsm’de onaylı başlıkla birebir aynı olmalı (boşluksuz, örn. MATEKLTD).</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /><span className="font-semibold">Aktif</span></label>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="submit" className="flex-1 min-w-[5.5rem] px-3 py-2 bg-slate-900 text-white rounded-lg font-semibold" data-testid="save-netgsm-btn">Kaydet</button>
              <button type="button" onClick={verifyConnection} disabled={verifying || !configured} className="flex items-center gap-1 px-3 py-2 border rounded-lg font-semibold hover:bg-slate-50 disabled:opacity-50" data-testid="netgsm-verify-btn">
                {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Doğrula
              </button>
              <button type="button" onClick={checkBalance} className="flex items-center gap-1 px-3 py-2 border rounded-lg font-semibold hover:bg-slate-50" data-testid="netgsm-balance-btn"><Wallet className="w-3.5 h-3.5" /> Bakiye</button>
            </div>
          </form>
          {settings?.verify_message && (
            <div className={`text-[11px] rounded-lg p-2 ${settings.verified ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`} data-testid="netgsm-verify-message">
              {settings.verify_message}
            </div>
          )}
          {balance && <div className={`text-[11px] rounded-lg p-2 ${balance.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`} data-testid="netgsm-balance-result">{balance.ok ? JSON.stringify(balance.data) : (balance.message || "Bakiye alınamadı")}</div>}
          <p className="text-[10px] text-slate-400">Netgsm panelinde API alt kullanıcısı oluşturup SMS API yetkisi verin; onaylı gönderici başlığınızı girin. «BAĞLI» yalnızca Doğrula başarılıysa görünür.</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-indigo-600" /> Hızlı SMS</h3>
          <form onSubmit={sendSingle} className="space-y-2 text-xs">
            <select value={single.contact_id} onChange={(e) => { const c = contacts.find((x) => x.id === e.target.value); setSingle({ ...single, contact_id: e.target.value, phone: c?.phone || single.phone }); }} className={inputCls} data-testid="sms-contact-select">
              <option value="">Cari seç (opsiyonel)</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input value={single.phone} onChange={(e) => setSingle({ ...single, phone: e.target.value })} placeholder="05XX XXX XX XX" className={`${inputCls} font-mono`} required data-testid="sms-phone-input" />
            <textarea value={single.message} onChange={(e) => setSingle({ ...single, message: e.target.value })} rows={3} placeholder="Mesajınız..." className={inputCls} required data-testid="sms-message-input" />
            <button type="submit" disabled={busy} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg font-semibold disabled:opacity-60" data-testid="sms-send-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} SMS Gönder</button>
          </form>
        </div>
      </div>

      <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 text-sm font-bold text-slate-900">SMS Gönderim Geçmişi <span className="text-slate-400 font-medium text-xs">({logs.length})</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b text-slate-500 uppercase font-semibold"><tr><th className="px-3 py-2 w-20">Tarih</th><th className="px-4 py-2">Alıcı</th><th className="px-4 py-2">Mesaj</th><th className="px-4 py-2">Kaynak</th><th className="px-4 py-2">Durum</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Henüz SMS gönderilmedi.</td></tr>}
              {logs.map((l) => (
                <tr key={l.id} data-testid={`sms-log-${l.id}`}>
                  <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap w-20 text-[10px] leading-tight align-top"><div>{new Date(l.created_at).toLocaleDateString("tr-TR")}</div><div className="text-slate-400">{new Date(l.created_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</div></td>
                  <td className="px-4 py-2 align-top whitespace-nowrap"><div className="font-semibold text-slate-900">{l.contact_name || "—"}</div><div className="font-mono text-slate-500">{l.to}</div></td>
                  <td className="px-4 py-2 whitespace-pre-wrap break-words align-top leading-relaxed" style={{ maxWidth: 360 }}>{l.message}</td>
                  <td className="px-4 py-2"><span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-semibold">{contextTr(l.context)}</span></td>
                  <td className="px-4 py-2 align-top">
                    {l.status === "sent" && <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-3 h-3" /> Gönderildi</span>}
                    {l.status === "simulated" && <span className="inline-flex items-center gap-1 text-amber-700 font-semibold"><FlaskConical className="w-3 h-3" /> Simüle</span>}
                    {l.status === "failed" && (
                      <div className="text-rose-700">
                        <span className="inline-flex items-center gap-1 font-semibold"><AlertCircle className="w-3 h-3" /> Hata</span>
                        {l.error && <div className="text-[10px] text-rose-600/90 mt-0.5 max-w-[220px] leading-snug" data-testid={`sms-log-error-${l.id}`}>{l.error}</div>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

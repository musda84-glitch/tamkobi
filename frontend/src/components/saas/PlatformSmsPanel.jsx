
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { MessageSquare, Save, Loader2, FlaskConical, Wallet, ShieldCheck, RefreshCw } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { Toggle, inputCls } from "./saasUi";

const errText = (e, fallback) => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string" && d.trim()) return d;
  return fallback;
};

export const PlatformSmsPanel = () => {
  const [d, setD] = useState(null);
  const [form, setForm] = useState({ provider: "netgsm", usercode: "", password: "", msgheader: "", is_active: false });
  const [busy, setBusy] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [balance, setBalance] = useState(null);
  const [logs, setLogs] = useState([]);

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        axios.get(`${API_URL}/system/sms`),
        axios.get(`${API_URL}/system/sms/logs`, { params: { limit: 40 } }),
      ]);
      setD(s.data);
      setForm({
        provider: s.data.provider || "netgsm",
        usercode: s.data.usercode || "",
        password: "",
        msgheader: s.data.msgheader || "",
        is_active: !!s.data.is_active,
      });
      setLogs(l.data?.items || []);
    } catch (e) {
      toast.error(errText(e, "SMS ayarları yüklenemedi."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const providers = d?.providers || [];
  const meta = useMemo(() => providers.find((p) => p.id === form.provider) || providers[0], [providers, form.provider]);

  const save = async (e) => {
    e?.preventDefault?.();
    setBusy("save");
    try {
      const payload = {
        provider: form.provider,
        usercode: form.usercode,
        msgheader: form.msgheader,
        is_active: form.is_active,
      };
      if (String(form.password || "").trim()) payload.password = form.password.trim();
      const r = await axios.put(`${API_URL}/system/sms`, payload);
      setD(r.data);
      setForm((f) => ({ ...f, password: "" }));
      toast.success("Platform SMS ayarları kaydedildi.");
    } catch (err) {
      toast.error(errText(err, "Kaydedilemedi."));
    } finally {
      setBusy("");
    }
  };

  const verify = async () => {
    setBusy("verify");
    try {
      const r = await axios.post(`${API_URL}/system/sms/verify`);
      setD(r.data);
      (r.data.verified ? toast.success : toast.error)(r.data.verify_message || (r.data.verified ? "Doğrulandı" : "Doğrulama başarısız"));
    } catch (err) {
      toast.error(errText(err, "Doğrulama yapılamadı."));
    } finally {
      setBusy("");
    }
  };

  const loadBalance = async () => {
    setBusy("balance");
    try {
      const r = await axios.get(`${API_URL}/system/sms/balance`);
      setBalance(r.data);
      toast.success(r.data?.message || "Bakiye alındı.");
    } catch (err) {
      toast.error(errText(err, "Bakiye alınamadı."));
    } finally {
      setBusy("");
    }
  };

  const sendTest = async () => {
    if (!testPhone.trim()) {
      toast.error("Test telefonu girin.");
      return;
    }
    setBusy("test");
    try {
      const r = await axios.post(`${API_URL}/system/sms/send-test`, { phone: testPhone.trim() });
      toast.success(r.data.message || "Test SMS gönderildi.");
      load();
    } catch (err) {
      toast.error(errText(err, "Test SMS gönderilemedi."));
    } finally {
      setBusy("");
    }
  };

  if (!d) return <div className="text-xs text-slate-400 p-4">Yükleniyor…</div>;

  return (
    <div className="space-y-4 text-xs max-w-3xl" data-testid="platform-sms-panel">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-600" /> Platform SMS Modülü
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Panel / ERP şifre sıfırlama ve sistem duyuru bilgilendirmeleri bu hesaptan gider.
              Şirket iletişim SMS’leri ayrıdır (Ayarlar → SMS).
            </p>
          </div>
          <label className="flex items-center gap-2">
            <Toggle on={!!form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} testId="platform-sms-active" />
            <span>Aktif</span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2" data-testid="platform-sms-providers">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setForm({ ...form, provider: p.id })}
              className={`px-3 py-2 rounded-xl border font-bold ${form.provider === p.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200"}`}
              data-testid={`platform-sms-provider-${p.id}`}
            >
              {p.name}
            </button>
          ))}
        </div>
        {meta?.help && <p className="text-[11px] text-slate-500 bg-slate-50 rounded-xl px-3 py-2">{meta.help}</p>}

        <div className={`text-[10px] rounded-lg px-3 py-2 ${d.verified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`} data-testid="platform-sms-verify-status">
          {d.verified ? `Bağlı · ${d.verify_message || "doğrulandı"}` : (d.verify_message || "Henüz doğrulanmadı — kaydedip Doğrula’ya basın.")}
          {d.password_unreadable ? " · Kayıtlı şifre okunamıyor; yeniden girin." : ""}
        </div>

        <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">{meta?.user_label || "Kullanıcı"}</label>
            <input value={form.usercode} onChange={(e) => setForm({ ...form, usercode: e.target.value })} className={inputCls} placeholder={meta?.user_placeholder || ""} data-testid="platform-sms-usercode" autoComplete="off" />
          </div>
          <div>
            <label className="block font-semibold mb-1">{meta?.pass_label || "API Şifresi"}{d.has_password ? " (kayıtlı)" : ""}</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} placeholder={d.has_password ? "Değiştirmek için yeni şifre" : "API şifresi"} data-testid="platform-sms-password" autoComplete="new-password" />
          </div>
          <div className="sm:col-span-2">
            <label className="block font-semibold mb-1">Gönderici başlığı (msgheader)</label>
            <input value={form.msgheader} onChange={(e) => setForm({ ...form, msgheader: e.target.value })} className={inputCls} placeholder="ORN. TAMKOBI" data-testid="platform-sms-header" />
            {meta?.header_hint && <p className="text-[10px] text-slate-400 mt-1">{meta.header_hint}</p>}
          </div>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <button type="submit" disabled={!!busy} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="platform-sms-save">
              {busy === "save" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Kaydet
            </button>
            <button type="button" onClick={verify} disabled={!!busy} className="px-4 py-2 border rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="platform-sms-verify">
              {busy === "verify" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Doğrula
            </button>
            <button type="button" onClick={loadBalance} disabled={!!busy} className="px-4 py-2 border rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="platform-sms-balance">
              {busy === "balance" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />} Bakiye
            </button>
            <button type="button" onClick={load} disabled={!!busy} className="px-3 py-2 border rounded-xl font-bold inline-flex items-center gap-1.5" data-testid="platform-sms-refresh">
              <RefreshCw className="w-3.5 h-3.5" /> Yenile
            </button>
          </div>
        </form>

        {balance && (
          <div className="text-[11px] bg-sky-50 text-sky-900 border border-sky-100 rounded-xl px-3 py-2" data-testid="platform-sms-balance-box">
            Bakiye: <b>{balance.balance ?? balance.amount ?? balance.message ?? JSON.stringify(balance)}</b>
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <div className="font-bold text-slate-800">Test SMS</div>
          <div className="flex flex-wrap gap-2">
            <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="05XXXXXXXXX" className={`${inputCls} max-w-[12rem]`} data-testid="platform-sms-test-phone" />
            <button type="button" onClick={sendTest} disabled={!!busy} className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="platform-sms-test-send">
              {busy === "test" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />} Gönder
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
        <h4 className="font-bold text-slate-900 text-sm">Son platform SMS kayıtları</h4>
        <div className="max-h-64 overflow-auto border rounded-xl" data-testid="platform-sms-logs">
          <table className="w-full text-left">
            <tbody className="divide-y">
              {!logs.length && <tr><td className="p-4 text-center text-slate-400">Kayıt yok.</td></tr>}
              {logs.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{row.created_at ? new Date(row.created_at).toLocaleString("tr-TR") : "—"}</td>
                  <td className="px-3 font-mono">{row.phone}</td>
                  <td className="px-3"><span className={`px-1.5 rounded text-[10px] font-bold ${row.status === "sent" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{row.status}</span></td>
                  <td className="px-3 text-slate-600 truncate max-w-[14rem]">{row.context}</td>
                  <td className="px-3 text-slate-500 truncate max-w-[16rem]">{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

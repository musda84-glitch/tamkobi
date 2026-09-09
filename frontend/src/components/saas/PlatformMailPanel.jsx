
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Mail, Server, Plus, Trash2, Loader2, Save, Shield, Send, PlugZap } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls, Toggle } from "./saasUi";

const cred = { withCredentials: true };

export const PlatformMailPanel = () => {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState("");
  const [srv, setSrv] = useState({ name: "", provider: "custom", smtp_host: "", smtp_port: 587, smtp_user: "", password: "" });
  const [box, setBox] = useState({ email: "", display_name: "", server_id: "", purposes: ["transactional"], allow_all_admins: true, allowed_user_ids: [], is_default: true, password: "", smtp_user: "" });
  const [testTo, setTestTo] = useState("");
  const load = useCallback(() => {
    axios.get(`${API_URL}/system/mail`, cred).then((r) => {
      setD(r.data);
      setBox((b) => ({ ...b, server_id: b.server_id || r.data.servers[0]?.id || "" }));
    }).catch((e) => toast.error(e.response?.data?.detail || "Posta ayarları alınamadı."));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="text-xs text-slate-400">Yükleniyor…</div>;

  const applyPreset = (code) => {
    const p = d.presets.find((x) => x.code === code);
    setSrv({ ...srv, provider: code, smtp_host: p?.smtp_host || "", smtp_port: p?.smtp_port || 587 });
  };
  const saveServer = async (e) => {
    e.preventDefault(); setBusy("srv");
    try {
      await axios.post(`${API_URL}/system/mail/servers`, srv, cred);
      toast.success("Posta sunucusu kaydedildi.");
      setSrv({ name: "", provider: srv.provider, smtp_host: srv.smtp_host, smtp_port: srv.smtp_port, smtp_user: "", password: "" });
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(""); }
  };
  const testServer = async (id) => {
    setBusy(`t-${id}`);
    try {
      const r = await axios.post(`${API_URL}/system/mail/servers/${id}/test`, {}, cred);
      (r.data.ok ? toast.success : toast.error)(r.data.message || (r.data.ok ? "Bağlandı." : "Başarısız"));
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Test edilemedi."); } finally { setBusy(""); }
  };
  const delServer = async (s) => {
    if (!window.confirm(`${s.name} sunucusu silinsin mi?`)) return;
    try { await axios.delete(`${API_URL}/system/mail/servers/${s.id}`, cred); toast.success("Sunucu silindi."); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
  };
  const saveBox = async (e) => {
    e.preventDefault(); setBusy("box");
    try {
      await axios.post(`${API_URL}/system/mail/mailboxes`, box, cred);
      toast.success("E-posta kutusu eklendi.");
      setBox({ email: "", display_name: "", server_id: d.servers[0]?.id || "", purposes: ["general"], allow_all_admins: true, allowed_user_ids: [], is_default: false, password: "", smtp_user: "" });
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Eklenemedi."); } finally { setBusy(""); }
  };
  const patchBox = async (b, body, ok) => {
    try { await axios.put(`${API_URL}/system/mail/mailboxes/${b.id}`, body, cred); toast.success(ok); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };
  const delBox = async (b) => {
    if (!window.confirm(`${b.email} silinsin mi?`)) return;
    try { await axios.delete(`${API_URL}/system/mail/mailboxes/${b.id}`, cred); toast.success("Kutu silindi."); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
  };
  const sendTest = async (b) => {
    setBusy(`send-${b.id}`);
    try {
      const r = await axios.post(`${API_URL}/system/mail/send-test`, { mailbox_id: b.id, to: testTo || undefined }, cred);
      toast.success(`Gönderildi: ${r.data.from} → ${r.data.to}`);
    } catch (err) { toast.error(err.response?.data?.detail || "Gönderilemedi."); } finally { setBusy(""); }
  };
  const togglePurpose = (id) => {
    const has = box.purposes.includes(id);
    setBox({ ...box, purposes: has ? box.purposes.filter((x) => x !== id) : [...box.purposes, id] });
  };
  const toggleUser = (id) => {
    const has = box.allowed_user_ids.includes(id);
    setBox({ ...box, allowed_user_ids: has ? box.allowed_user_ids.filter((x) => x !== id) : [...box.allowed_user_ids, id] });
  };

  return (
    <div className="space-y-4 text-xs" data-testid="platform-mail">
      <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-slate-700" data-testid="mail-explainer">
        <div className="font-bold text-slate-900 flex items-center gap-1.5"><Mail className="w-4 h-4 text-sky-600" /> Platform posta sunucusu</div>
        <p className="mt-1 text-[11px] leading-relaxed">Microsoft 365 <b>Send As</b> / Google <b>Send mail as</b> / Odoo outgoing mail server ile aynı model: önce SMTP sunucusunu bağlayın, sonra bildiğiniz gönderen adreslerini (info@, destek@, fatura@) ekleyin ve hangi panel yöneticisinin hangi kutuyu kullanabileceğini seçin. Lisans hatırlatması ve abonelik faturası varsayılan kutudan gider; şirket İletişim Merkezi SMTP’si yedek olarak kalır.</p>
      </div>

      <form onSubmit={saveServer} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="mail-server-form">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><Server className="w-4 h-4 text-amber-500" /> SMTP sunucusu</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div><label className="block font-semibold text-slate-700 mb-1">Ad</label><input value={srv.name} onChange={(e) => setSrv({ ...srv, name: e.target.value })} placeholder="TamKobi SMTP" className={inputCls} data-testid="mail-srv-name" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Sağlayıcı</label><select value={srv.provider} onChange={(e) => applyPreset(e.target.value)} className={inputCls} data-testid="mail-srv-provider">{d.presets.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
          <div><label className="block font-semibold text-slate-700 mb-1">SMTP host</label><input required value={srv.smtp_host} onChange={(e) => setSrv({ ...srv, smtp_host: e.target.value })} className={`${inputCls} font-mono`} data-testid="mail-srv-host" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Port</label><input type="number" required value={srv.smtp_port} onChange={(e) => setSrv({ ...srv, smtp_port: Number(e.target.value) })} className={inputCls} data-testid="mail-srv-port" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">SMTP kullanıcı (giriş)</label><input required value={srv.smtp_user} onChange={(e) => setSrv({ ...srv, smtp_user: e.target.value })} placeholder="smtp@tamkobi.com" className={inputCls} data-testid="mail-srv-user" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Şifre / uygulama şifresi</label><input type="password" required value={srv.password} onChange={(e) => setSrv({ ...srv, password: e.target.value })} className={inputCls} data-testid="mail-srv-password" /></div>
        </div>
        <div className="flex justify-end"><button type="submit" disabled={busy === "srv"} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="mail-srv-save">{busy === "srv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Sunucu ekle</button></div>
      </form>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="mail-server-list">
        <div className="px-4 py-2.5 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Kayıtlı sunucular</div>
        {d.servers.length === 0 ? <div className="p-6 text-slate-400">Henüz SMTP sunucusu yok.</div> : d.servers.map((s) => (
          <div key={s.id} className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center gap-3" data-testid={`mail-srv-row-${s.id}`}>
            <div className="flex-1 min-w-[200px]"><div className="font-semibold text-slate-800">{s.name}</div><div className="text-[10px] font-mono text-slate-500">{s.smtp_host}:{s.smtp_port} · {s.smtp_user || "kullanıcı yok"}</div>{s.last_test && <div className={`text-[10px] mt-0.5 ${s.last_test.ok ? "text-emerald-700" : "text-rose-600"}`}>Son test: {s.last_test.ok ? "başarılı" : s.last_test.message}</div>}</div>
            <button type="button" onClick={() => testServer(s.id)} disabled={busy === `t-${s.id}`} className="px-3 py-1.5 border border-sky-300 text-sky-700 rounded-lg font-semibold inline-flex items-center gap-1" data-testid={`mail-srv-test-${s.id}`}>{busy === `t-${s.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />} Test</button>
            <button type="button" onClick={() => delServer(s)} className="p-1.5 text-slate-400 hover:text-rose-600" data-testid={`mail-srv-del-${s.id}`}><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      <form onSubmit={saveBox} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="mail-box-form">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-emerald-600" /> Bildiğim mailler (gönderen kimlikleri)</h3>
        <p className="text-[11px] text-slate-500">Her adres bir sunucu üzerinden gönderir. “Tüm panel yöneticileri” kapalıysa yalnızca seçilen kişiler o kutuyu From olarak kullanabilir.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div><label className="block font-semibold text-slate-700 mb-1">E-posta</label><input type="email" required value={box.email} onChange={(e) => setBox({ ...box, email: e.target.value })} placeholder="destek@tamkobi.com" className={inputCls} data-testid="mail-box-email" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Görünen ad</label><input value={box.display_name} onChange={(e) => setBox({ ...box, display_name: e.target.value })} placeholder="TamKobi Destek" className={inputCls} data-testid="mail-box-name" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Sunucu</label><select required value={box.server_id} onChange={(e) => setBox({ ...box, server_id: e.target.value })} className={inputCls} data-testid="mail-box-server">{d.servers.length === 0 && <option value="">Önce sunucu ekleyin</option>}{d.servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label className="block font-semibold text-slate-700 mb-1">SMTP kullanıcı (boş = sunucu)</label><input value={box.smtp_user} onChange={(e) => setBox({ ...box, smtp_user: e.target.value })} className={inputCls} data-testid="mail-box-smtp-user" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Kutu şifresi (boş = sunucu şifresi)</label><input type="password" value={box.password} onChange={(e) => setBox({ ...box, password: e.target.value })} className={inputCls} data-testid="mail-box-password" /></div>
        </div>
        <div>
          <div className="font-semibold text-slate-700 mb-1.5">Kullanım</div>
          <div className="flex flex-wrap gap-2">{d.purposes.map((p) => (
            <button type="button" key={p.id} onClick={() => togglePurpose(p.id)} className={`px-2.5 py-1 rounded-lg border font-semibold ${box.purposes.includes(p.id) ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "border-slate-200 text-slate-500"}`} data-testid={`mail-box-purpose-${p.id}`}>{p.label}</button>
          ))}</div>
        </div>
        <label className="flex items-center gap-2 font-semibold text-slate-700"><Toggle on={box.allow_all_admins} onChange={(v) => setBox({ ...box, allow_all_admins: v, allowed_user_ids: v ? [] : box.allowed_user_ids })} testId="mail-box-allow-all" /> Tüm panel yöneticileri kullanabilir</label>
        {!box.allow_all_admins && (
          <div className="bg-slate-50 rounded-xl p-3 space-y-1.5" data-testid="mail-box-acl">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Bu kutuyu kim kullanır</div>
            {d.admins.map((a) => (
              <label key={a.id} className="flex items-center gap-2"><input type="checkbox" checked={box.allowed_user_ids.includes(a.id)} onChange={() => toggleUser(a.id)} data-testid={`mail-box-acl-${a.id}`} /><span>{a.name} <span className="text-slate-400">{a.email}</span></span></label>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 font-semibold text-slate-700"><Toggle on={box.is_default} onChange={(v) => setBox({ ...box, is_default: v })} testId="mail-box-default" /> Sistem işleri için varsayılan (hatırlatma / fatura)</label>
        <div className="flex justify-end"><button type="submit" disabled={busy === "box" || !d.servers.length} className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="mail-box-save">{busy === "box" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kutu ekle</button></div>
      </form>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto" data-testid="mail-box-list">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2.5 text-left">Kutu</th><th className="px-3 py-2.5 text-left">Sunucu</th><th className="px-3 py-2.5 text-left">Kim kullanır</th><th className="px-3 py-2.5 text-left">Durum</th><th className="px-3 py-2.5 text-right">İşlem</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {d.mailboxes.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">Henüz gönderen adresi yok.</td></tr>}
            {d.mailboxes.map((b) => (
              <tr key={b.id} data-testid={`mail-box-row-${b.id}`}>
                <td className="px-3 py-2"><div className="font-semibold text-slate-800">{b.display_name}</div><div className="font-mono text-[10px] text-slate-500">{b.email}</div><div className="mt-1 flex flex-wrap gap-1">{(b.purposes || []).map((p) => <span key={p} className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{(d.purposes.find((x) => x.id === p) || {}).label || p}</span>)}{b.is_default && <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">varsayılan</span>}</div></td>
                <td className="px-3 py-2 text-slate-600">{b.server_name}</td>
                <td className="px-3 py-2 text-slate-600">{b.allow_all_admins ? "Tüm panel yöneticileri" : (b.allowed_users || []).map((u) => u.email).join(", ") || "Kimse"}</td>
                <td className="px-3 py-2"><label className="flex items-center gap-2"><Toggle on={!!b.is_active} onChange={(v) => patchBox(b, { is_active: v }, v ? "Aktif." : "Pasif.")} testId={`mail-box-active-${b.id}`} /><span>{b.is_active ? "Aktif" : "Pasif"}</span></label></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {!b.is_default && <button type="button" onClick={() => patchBox(b, { is_default: true }, "Varsayılan yapıldı.")} className="text-[10px] font-semibold text-amber-700 mr-2" data-testid={`mail-box-make-default-${b.id}`}>Varsayılan</button>}
                  <button type="button" onClick={() => sendTest(b)} disabled={busy === `send-${b.id}`} className="p-1.5 text-sky-600" title="Test gönder" data-testid={`mail-box-test-${b.id}`}>{busy === `send-${b.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button>
                  <button type="button" onClick={() => delBox(b)} className="p-1.5 text-slate-400 hover:text-rose-600" data-testid={`mail-box-del-${b.id}`}><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.mailboxes.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
            <span className="text-slate-500">Test alıcısı (boş = sizin mailiniz)</span>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="ornek@firma.com" className={`${inputCls} max-w-xs`} data-testid="mail-test-to" />
          </div>
        )}
      </div>
    </div>
  );
};

import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Building2, MessageSquare, Mail, Landmark, ShoppingCart, Truck, FileCheck2, Printer, Upload, Save, Loader2, ListOrdered, Link as LinkIcon, Ruler, Trash2, Pencil, Users, ShieldCheck } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { groupIdOf, groupMenuItems } from "../navGroups";
import { SmsCenter } from "../components/SmsCenter";
import { MailClient } from "../components/MailClient";
import { BankConnectionsPanel } from "../components/BankConnectionsPanel";
import { PrintTemplateEditor } from "../components/PrintDocument";
import { resolveImageUrl } from "../utils/imageUrl";
import { UsersRolesPanel } from "../components/UsersRolesPanel";
import { CompanyLocationPanel } from "../components/CompanyLocationPanel";
import { MigrationPanel } from "../components/MigrationPanel";
import { MorningSummarySettings } from "../components/PricingCenter";
import { MyPlanPanel } from "../components/saas/MyPlanPanel";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";
const TABS = [["company", "Şirket Bilgileri", Building2], ["plan", "Paketim & Modüller", ShieldCheck], ["print", "Form & Yazdırma", Printer], ["einvoice", "E-Fatura Entegratörü", FileCheck2], ["sms", "SMS (Netgsm)", MessageSquare], ["mail", "E-posta Hesabı", Mail], ["bank", "Banka Bağlantıları", Landmark], ["channels", "E-Ticaret & Kargo", ShoppingCart], ["whatsapp", "WhatsApp Business", MessageSquare], ["units", "Birimler & Kategoriler", Ruler], ["users", "Kullanıcılar & Roller", Users], ["migration", "Veri Aktarımı", Upload], ["summary", "Sabah Özeti", Upload], ["modules", "Modül Sıralama", ListOrdered]];

const CompanyForm = ({ companyId }) => {
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { axios.get(`${API_URL}/companies/${companyId}`).then((r) => setC(r.data)); }, [companyId]);
  if (!c) return null;
  const set = (k, v) => setC({ ...c, [k]: v });
  const save = async (e) => { e.preventDefault(); setBusy(true); try { await axios.put(`${API_URL}/companies/${companyId}`, c); toast.success("Şirket bilgileri kaydedildi."); } catch { toast.error("Kaydedilemedi."); } finally { setBusy(false); } };
  const uploadLogo = async (e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append("file", f); try { const r = await axios.post(`${API_URL}/files/upload?entity=company&entity_id=${companyId}&company_id=${companyId}`, fd); setC({ ...c, logo_url: r.data.url }); toast.success("Logo yüklendi."); } catch (err) { toast.error(err.response?.data?.detail || "Logo yüklenemedi."); } };
  const fields = [["name", "Şirket Ünvanı"], ["tax_number", "VKN / TCKN"], ["tax_office", "Vergi Dairesi"], ["mersis", "MERSİS No"], ["trade_registry", "Ticaret Sicil No"], ["phone", "Telefon"], ["email", "E-posta"], ["website", "Web Sitesi"], ["address", "Adres"], ["city", "Şehir"], ["bank_name", "Banka"], ["iban", "IBAN"], ["e_invoice_alias", "GİB Posta Kutusu (PK)"]];
  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 text-xs" data-testid="company-form">
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden">{c.logo_url ? <img src={resolveImageUrl(c.logo_url)} alt="logo" className="w-full h-full object-contain" /> : <Building2 className="w-8 h-8 text-slate-300" />}</div>
        <label className="flex items-center gap-1.5 px-3 py-2 border rounded-lg cursor-pointer hover:bg-slate-50 font-semibold"><Upload className="w-3.5 h-3.5" /> Logo Yükle<input type="file" accept="image/*" className="hidden" onChange={uploadLogo} data-testid="company-logo-input" /></label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{fields.map(([k, l]) => <div key={k} className={k === "address" ? "sm:col-span-2" : ""}><label className="block font-semibold text-slate-700 mb-1">{l}</label><input value={c[k] || ""} onChange={(e) => set(k, e.target.value)} className={inputCls} data-testid={`company-${k}-input`} /></div>)}</div>
      <div className="flex justify-end"><button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-60" data-testid="save-company-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button></div>
    </form>
  );
};

const EInvoiceSettings = ({ companyId }) => {
  const [providers, setProviders] = useState([]);
  const [s, setS] = useState(null);
  const [password, setPassword] = useState("");
  useEffect(() => { Promise.all([axios.get(`${API_URL}/einvoice/providers`), axios.get(`${API_URL}/einvoice/settings?company_id=${companyId}`)]).then(([p, st]) => { setProviders(p.data); setS(st.data); }); }, [companyId]);
  if (!s) return null;
  const prov = providers.find((p) => p.code === s.provider);
  const save = async (e) => { e.preventDefault(); try { const r = await axios.put(`${API_URL}/einvoice/settings`, { ...s, company_id: companyId, password }); setS(r.data); setPassword(""); toast.success(r.data.status === "configured" ? "Entegratör bilgileri kaydedildi." : "Kaydedildi — kimlik bilgisi girilmediği için SİMÜLE mod."); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } };
  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 text-xs max-w-xl" data-testid="einvoice-settings">
      <div className="flex items-center justify-between"><h3 className="text-sm font-bold">E-Fatura / E-Arşiv / E-İrsaliye Entegratörü</h3><span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${s.status === "configured" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`} data-testid="einvoice-status">{s.status === "configured" ? "YAPILANDIRILDI" : "SİMÜLE"}</span></div>
      <p className="text-slate-500">Entegratör anahtarı girilmediği sürece GİB gönderimleri simüle edilir. Anahtar geldiğinde buradan girin, tüm fatura ekranları otomatik canlıya geçer.</p>
      <div><label className="block font-semibold mb-1">Entegratör</label><select value={s.provider} onChange={(e) => setS({ ...s, provider: e.target.value })} className={inputCls} data-testid="einvoice-provider-select"><option value="">Seçilmedi (Simüle)</option>{providers.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
      <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setS({ ...s, mode: "test" })} className={`p-2 rounded-lg border font-semibold ${s.mode === "test" ? "bg-amber-500 text-white border-amber-500" : ""}`}>Test Ortamı</button><button type="button" onClick={() => setS({ ...s, mode: "live" })} className={`p-2 rounded-lg border font-semibold ${s.mode === "live" ? "bg-emerald-600 text-white border-emerald-600" : ""}`}>Canlı</button></div>
      {(prov?.fields || []).includes("api_url") && <div><label className="block font-semibold mb-1">API URL</label><input value={s.api_url || ""} onChange={(e) => setS({ ...s, api_url: e.target.value })} className={`${inputCls} font-mono`} /></div>}
      <div className="grid grid-cols-2 gap-2"><div><label className="block font-semibold mb-1">Kullanıcı Adı</label><input value={s.username} onChange={(e) => setS({ ...s, username: e.target.value })} className={inputCls} data-testid="einvoice-username-input" /></div><div><label className="block font-semibold mb-1">Şifre {s.has_password && <span className="text-slate-400 font-normal">(kayıtlı)</span>}</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} data-testid="einvoice-password-input" /></div></div>
      <div><label className="block font-semibold mb-1">GİB Etiket / Alias</label><input value={s.alias || ""} onChange={(e) => setS({ ...s, alias: e.target.value })} placeholder="urn:mail:defaultpk@firma.com.tr" className={`${inputCls} font-mono`} /></div>
      <div className="flex justify-end"><button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold" data-testid="save-einvoice-btn">Kaydet</button></div>
    </form>
  );
};

const PrintSettings = ({ companyId }) => {
  const [editing, setEditing] = useState(null);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="print-settings">
      {[["invoice", "Fatura"], ["order", "Sipariş Formu"], ["quote", "Teklif"], ["dispatch", "İrsaliye"]].map(([k, l]) => (
        <button key={k} onClick={() => setEditing(k)} className="bg-white border border-slate-200 rounded-2xl p-5 text-left hover:border-emerald-500 hover:shadow-md transition" data-testid={`print-tpl-${k}`}><Printer className="w-5 h-5 text-slate-400 mb-2" /><div className="text-sm font-bold text-slate-900">{l}</div><div className="text-xs text-slate-500">Başlık, renk, notlar, logo/imza alanları</div></button>
      ))}
      {editing && <PrintTemplateEditor companyId={companyId} docType={editing} onClose={() => setEditing(null)} onSaved={() => toast.success("Form şablonu kaydedildi.")} />}
    </div>
  );
};

const WhatsAppSettings = ({ companyId }) => {
  const [s, setS] = useState(null); const [token, setToken] = useState("");
  useEffect(() => { axios.get(`${API_URL}/comm/whatsapp/settings?company_id=${companyId}`).then((r) => setS(r.data)); }, [companyId]);
  if (!s) return null;
  const save = async (e) => { e.preventDefault(); try { const r = await axios.put(`${API_URL}/comm/whatsapp/settings`, { ...s, company_id: companyId, access_token: token }); setS(r.data); setToken(""); toast.success(r.data.status === "connected" ? "WhatsApp Cloud API bağlandı." : "Kaydedildi — anahtar girilmeden SİMÜLE."); } catch { toast.error("Kaydedilemedi."); } };
  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 text-xs max-w-xl" data-testid="whatsapp-settings">
      <div className="flex items-center justify-between"><h3 className="text-sm font-bold">WhatsApp Business (Meta Cloud API)</h3><span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${s.status === "connected" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`} data-testid="wa-status">{s.status === "connected" ? "BAĞLI" : "SİMÜLE"}</span></div>
      <p className="text-slate-500">Meta for Developers → WhatsApp → API Setup'tan Phone Number ID ve kalıcı erişim token'ı alın. Webhook URL: <code className="bg-slate-100 px-1 rounded">{window.location.origin}{s.webhook_url}</code> (gelen mesajlar telefon numarasına göre cari kartına düşer).</p>
      <div><label className="block font-semibold mb-1">Phone Number ID</label><input value={s.phone_number_id} onChange={(e) => setS({ ...s, phone_number_id: e.target.value })} className={`${inputCls} font-mono`} data-testid="wa-phone-id-input" /></div>
      <div><label className="block font-semibold mb-1">Erişim Token {s.has_token && <span className="text-slate-400 font-normal">(kayıtlı)</span>}</label><input type="password" value={token} onChange={(e) => setToken(e.target.value)} className={inputCls} data-testid="wa-token-input" /></div>
      <div><label className="block font-semibold mb-1">Webhook Verify Token</label><input value={s.verify_token} onChange={(e) => setS({ ...s, verify_token: e.target.value })} className={`${inputCls} font-mono`} placeholder="nexus-wa-verify" /></div>
      <div className="flex justify-end"><button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold" data-testid="save-wa-btn">Kaydet</button></div>
    </form>
  );
};

const ModuleOrder = () => {
  const { menuItems, moveModule, resetModuleOrder } = useAuth();
  const groups = groupMenuItems(menuItems);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 text-xs max-w-lg space-y-3" data-testid="module-order-settings">
      <div className="flex justify-between items-center"><h3 className="text-sm font-bold">Modül Sıralama</h3><button onClick={resetModuleOrder} className="text-slate-500 hover:underline">Varsayılana dön</button></div>
      <p className="text-slate-500">Sol menü Logo / Mikro / BizimHesap gibi grupludur. Aynı grup içinde sürükleyerek veya oklarla sıralayabilirsiniz.</p>
      {groups.map((g) => (
        <div key={g.id} className="space-y-1.5">
          {g.label && <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 pt-1">{g.label}</div>}
          {g.items.map((m) => {
            const i = menuItems.findIndex((x) => x.path === m.path);
            const prev = menuItems[i - 1];
            const next = menuItems[i + 1];
            const canUp = prev && groupIdOf(prev.path) === groupIdOf(m.path);
            const canDown = next && groupIdOf(next.path) === groupIdOf(m.path);
            return (
              <div key={m.path} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" data-testid={`module-order-row-${m.path.replace("/", "") || "dashboard"}`}>
                <span className="w-5 text-slate-400 font-mono">{i + 1}</span><span className="flex-1 font-semibold">{m.label}</span>
                <button onClick={() => moveModule(i, i - 1)} disabled={!canUp} className="px-2 py-0.5 border rounded disabled:opacity-30" data-testid={`module-up-${i}`}>↑</button>
                <button onClick={() => moveModule(i, i + 1)} disabled={!canDown} className="px-2 py-0.5 border rounded disabled:opacity-30" data-testid={`module-down-${i}`}>↓</button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const UcBox = ({ title, sub, items, base, testId, companyId, call }) => {
  const [val, setVal] = useState("");
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3" data-testid={testId}>
      <div><div className="text-sm font-bold text-slate-900">{title}</div><div className="text-xs text-slate-500">{sub}</div></div>
      <form onSubmit={(e) => { e.preventDefault(); if (!val.trim()) return; call(() => axios.post(`${API_URL}${base}`, { company_id: companyId, name: val.trim() }), "Eklendi."); setVal(""); }} className="flex gap-2"><input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Yeni ekle… (Enter)" className="flex-1 bg-slate-50 border rounded-lg p-2 text-xs" data-testid={`${testId}-input`} /><button type="submit" className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold" data-testid={`${testId}-add`}>Ekle</button></form>
      <div className="flex flex-wrap gap-1.5">{items.map((u) => (
        <span key={u.name} className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs" data-testid={`${testId}-item-${u.name}`}><b>{u.name}</b><span className="text-slate-400">({u.count})</span>
          {base === "/products/units" && <button type="button" onClick={() => { const n = window.prompt("Yeni ad:", u.name); if (n && n.trim() && n !== u.name) call(() => axios.put(`${API_URL}${base}/${encodeURIComponent(u.name)}?company_id=${companyId}`, { name: n.trim() }), "Yeniden adlandırıldı (ürünler güncellendi)."); }} className="text-slate-400 hover:text-slate-900" title="Yeniden adlandır"><Pencil className="w-3 h-3" /></button>}
          <button type="button" onClick={() => { if (window.confirm(`${u.name} silinsin mi?`)) call(() => axios.delete(`${API_URL}${base}/${encodeURIComponent(u.name)}?company_id=${companyId}`), "Silindi."); }} className="text-slate-400 hover:text-rose-600" title="Sil" data-testid={`${testId}-del-${u.name}`}><Trash2 className="w-3 h-3" /></button></span>))}</div>
    </div>
  );
};

const UnitsCategories = ({ companyId }) => {
  const [units, setUnits] = useState([]);
  const [cats, setCats] = useState([]);
  const load = useCallback(() => { axios.get(`${API_URL}/products/units?company_id=${companyId}`).then((r) => setUnits(r.data)).catch(() => {}); axios.get(`${API_URL}/products/categories?company_id=${companyId}`).then((r) => setCats(r.data)).catch(() => {}); }, [companyId]);
  useEffect(() => { load(); }, [load]);
  const call = async (fn, ok) => { try { await fn(); toast.success(ok); load(); } catch (err) { toast.error(err.response?.data?.detail || "İşlem başarısız."); } };
  return (<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <UcBox title="Birimler" sub="Adet, Kg, Mt… Stok kartında listelenir; kullanılan birim silinemez, yeniden adlandırılabilir." items={units} base="/products/units" testId="units-box" companyId={companyId} call={call} />
    <UcBox title="Kategoriler" sub="Stok kartından girilen kategoriler otomatik kaydedilir; burada yönetin." items={cats} base="/products/categories" testId="categories-box" companyId={companyId} call={call} />
  </div>);
};

export const B2BSettings = ({ companyId }) => {
  const [d, setD] = useState(null);
  const [q, setQ] = useState("");
  const [pwd, setPwd] = useState(null);
  const savePwd = async (e) => { e.preventDefault(); if ((pwd.password || "").length < 6) return toast.error("Şifre en az 6 karakter olmalı."); try { await axios.post(`${API_URL}/contacts/${pwd.c.id}/b2b-access`, { enabled: true, discount: pwd.c.b2b_discount, password: pwd.password, login_email: pwd.login_email, base_url: window.location.origin }); toast.success(`${pwd.c.name} için B2B giriş bilgileri kaydedildi.`); setPwd(null); load(); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } };
  const load = useCallback(() => axios.get(`${API_URL}/companies/${companyId}/b2b-settings`).then((r) => setD(r.data)).catch(() => toast.error("B2B ayarları yüklenemedi.")), [companyId]);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const st = d.settings;
  const set = (k, v) => setD({ ...d, settings: { ...st, [k]: v } });
  const save = async (applyAll) => { try { await axios.put(`${API_URL}/companies/${companyId}/b2b-settings`, { ...st, apply_discount_to_all: applyAll }); toast.success(applyAll ? "Kaydedildi, indirim tüm B2B müşterilerine uygulandı." : "B2B ayarları kaydedildi."); load(); } catch { toast.error("Kaydedilemedi."); } };
  const toggleCustomer = async (c, enabled) => { try { const r = await axios.post(`${API_URL}/contacts/${c.id}/b2b-access`, { enabled, base_url: window.location.origin, discount: c.b2b_discount || st.default_discount }); if (enabled) { await navigator.clipboard?.writeText(r.data.link).catch(() => {}); toast.success("Portal linki kopyalandı."); } else toast.success("B2B erişimi kapatıldı."); load(); } catch { toast.error("İşlem başarısız."); } };
  const setDisc = async (c, v) => { try { await axios.post(`${API_URL}/contacts/${c.id}/b2b-access`, { enabled: c.b2b_enabled, discount: Number(v) || 0 }); load(); } catch { toast.error("Güncellenemedi."); } };
  const Tg = ({ k, l, sub }) => <label className="flex items-start gap-2 bg-slate-50 border rounded-xl p-2.5 cursor-pointer"><input type="checkbox" checked={!!st[k]} onChange={(e) => set(k, e.target.checked)} className="mt-0.5 rounded" data-testid={`b2b-set-${k}`} /><span><span className="block font-semibold text-slate-800">{l}</span>{sub && <span className="block text-[10px] text-slate-500">{sub}</span>}</span></label>;
  const filtered = d.customers.filter((c) => `${c.name} ${c.email || ""} ${c.tax_number_or_id || ""}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(b.b2b_enabled) - Number(a.b2b_enabled));
  const list = filtered.slice(0, q ? 300 : 60);
  return (
    <div className="space-y-4 text-xs" data-testid="b2b-settings">
      {pwd && <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={() => setPwd(null)}><form onSubmit={savePwd} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3" data-testid="b2b-pwd-modal"><div className="font-bold text-slate-900 text-sm">{pwd.c.name} — Portal Giriş Bilgileri</div><div><label className="block font-semibold mb-1">Giriş e-postası (veya VKN ile de girebilir)</label><input value={pwd.login_email} onChange={(e) => setPwd({ ...pwd, login_email: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="b2b-pwd-email" /></div><div><label className="block font-semibold mb-1">{pwd.c.has_password ? "Yeni şifre" : "Şifre"} (min 6)</label><input value={pwd.password} onChange={(e) => setPwd({ ...pwd, password: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="b2b-pwd-password" /></div><p className="text-[10px] text-slate-500">Müşteri <b>{window.location.origin}/b2b/giris</b> adresinden bu bilgilerle girer.</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setPwd(null)} className="px-3 py-2 border rounded-lg">İptal</button><button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold" data-testid="b2b-pwd-save">Kaydet</button></div></form></div>}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between"><div><div className="text-sm font-bold text-slate-900">B2B Portal Özellikleri</div><div className="text-slate-500 flex flex-wrap items-center gap-1.5">Müşteri giriş adresi: <b className="font-mono text-emerald-700" data-testid="b2b-login-url">{window.location.origin}/b2b/giris</b><button type="button" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/b2b/giris`); toast.success("Kopyalandı"); }} className="px-1.5 py-0.5 border rounded text-[10px] font-semibold hover:bg-slate-50" data-testid="b2b-copy-login-url">kopyala</button><span>· e-posta/VKN + şifre ya da /portal/… linki; {d.active_count} müşteri aktif.</span></div></div><span className={`px-2 py-1 rounded-lg font-bold ${st.enabled ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{st.enabled ? "AÇIK" : "KAPALI"}</span></div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          <Tg k="enabled" l="Portal açık" sub="Kapatılırsa tüm linkler devre dışı kalır" />
          <Tg k="allow_orders" l="Sipariş alımı" sub="Sepet ve sipariş gönderme" />
          <Tg k="show_prices" l="Fiyatları göster" sub="Kapalıysa yalnızca katalog" />
          <Tg k="show_stock" l="Stok durumunu göster" />
          <Tg k="show_statement" l="Hesap ekstresi sekmesi" />
          <Tg k="show_installments" l="Taksitler sekmesi" />
          <Tg k="allow_ai_cart" l="AI sepet (Excel/PDF yükleme)" sub="Müşteri sipariş listesini yükler, AI eşleştirir" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 items-end">
          <div><label className="block font-semibold mb-1">Giriş yöntemi</label><select value={st.login_method || "both"} onChange={(e) => set("login_method", e.target.value)} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="b2b-set-login"><option value="both">Şifre ile giriş + kişiye özel link (önerilen)</option><option value="password">Yalnızca e-posta/VKN + şifre (/b2b/giris)</option><option value="link">Yalnızca kişiye özel güvenli link (şifresiz)</option></select></div>
          <div><label className="block font-semibold mb-1">Varsayılan B2B indirimi %</label><input type="number" min="0" max="90" step="0.5" value={st.default_discount} onChange={(e) => set("default_discount", Number(e.target.value))} className="w-full bg-slate-50 border rounded-lg p-2 font-bold" data-testid="b2b-set-discount" /></div>
          <div><label className="block font-semibold mb-1">Minimum sipariş (₺)</label><input type="number" min="0" value={st.min_order_amount} onChange={(e) => set("min_order_amount", Number(e.target.value))} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="b2b-set-min" /></div>
          <div><label className="block font-semibold mb-1">Karşılama notu</label><input value={st.welcome_note || ""} onChange={(e) => set("welcome_note", e.target.value)} placeholder="Hoş geldiniz…" className="w-full bg-slate-50 border rounded-lg p-2" /></div>
        </div>
        <div className="flex justify-end gap-2 border-t pt-3"><button onClick={() => save(true)} className="px-3 py-2 border rounded-lg font-semibold" data-testid="b2b-save-apply">Kaydet + İndirimi Tüm Müşterilere Uygula</button><button onClick={() => save(false)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="b2b-save">Kaydet</button></div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-2"><div className="text-sm font-bold text-slate-900">Müşteri Erişimleri</div><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Müşteri ara…" className="bg-slate-50 border rounded-lg p-2 w-56" data-testid="b2b-customer-search" /></div>
        <table className="w-full"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-2">Müşteri</th><th className="text-left py-2">İletişim</th><th className="text-left py-2">Portal Girişi</th><th className="text-right py-2">İndirim %</th><th className="text-left py-2">Portal</th><th className="text-right py-2">İşlem</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{filtered.length > list.length && <tr><td colSpan={6} className="py-2 text-center text-slate-400 text-[10px]">{filtered.length} müşteriden ilk {list.length} gösteriliyor (aktifler önce) — daraltmak için arama yapın.</td></tr>}{list.map((c) => (
            <tr key={c.id} data-testid={`b2b-cust-${c.id}`}><td className="py-2 font-semibold text-slate-900">{c.name}</td><td className="py-2 text-slate-500">{c.email || c.phone || "—"}</td><td className="py-2"><button onClick={() => setPwd({ c, login_email: c.b2b_login_email || c.email || "", password: "" })} className={`px-2 py-1 rounded-lg font-semibold border ${c.has_password ? "border-emerald-200 text-emerald-700 bg-emerald-50" : "border-amber-200 text-amber-700 bg-amber-50"}`} title="Giriş e-postası ve şifre tanımla" data-testid={`b2b-cust-pwd-${c.id}`}>{c.has_password ? `🔑 ${c.b2b_login_email || c.email || c.tax_number_or_id}` : "Şifre Tanımla"}</button>{c.b2b_last_login && <div className="text-[10px] text-slate-400">son giriş {new Date(c.b2b_last_login).toLocaleDateString("tr-TR")}</div>}</td><td className="py-2 text-right"><input type="number" min="0" max="90" defaultValue={c.b2b_discount || 0} onBlur={(e) => Number(e.target.value) !== (c.b2b_discount || 0) && setDisc(c, e.target.value)} className="w-16 bg-slate-50 border rounded p-1 text-right" data-testid={`b2b-cust-disc-${c.id}`} /></td>
              <td className="py-2">{c.b2b_enabled ? <a href={`${window.location.origin}/portal/${c.b2b_token}`} target="_blank" rel="noreferrer" className="text-emerald-700 font-semibold underline">Aktif • linki aç</a> : <span className="text-slate-400">Kapalı</span>}</td>
              <td className="py-2 text-right">{c.b2b_enabled ? <button onClick={() => toggleCustomer(c, false)} className="px-2 py-1 border border-rose-200 text-rose-600 rounded-lg font-semibold" data-testid={`b2b-cust-off-${c.id}`}>Kapat</button> : <button onClick={() => toggleCustomer(c, true)} className="px-2 py-1 bg-slate-900 text-white rounded-lg font-semibold" data-testid={`b2b-cust-on-${c.id}`}>Erişim Ver + Link</button>}</td></tr>))}</tbody></table>
      </div>
    </div>
  );
};

export default function SettingsPage() {
  const { activeCompany } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const tab = searchParams.get("tab") || "company";
  const [contacts, setContacts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  useEffect(() => { if (tab === "b2b") navigate("/b2b-yonetim", { replace: true }); }, [tab, navigate]);
  useEffect(() => { axios.get(`${API_URL}/contacts?company_id=${companyId}`).then((r) => setContacts(r.data)).catch(() => {}); axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`).then((r) => setAccounts(r.data)).catch(() => {}); }, [companyId]);
  return (
    <div className="space-y-6" data-testid="settings-page">
      <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Firma Ayarları</h1><p className="text-xs sm:text-sm text-slate-500">Şirket bilgileri, form şablonları ve tüm entegrasyon ayarları tek yerde</p></div>
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <nav className="w-full lg:w-60 shrink-0 bg-white border border-slate-200 rounded-2xl p-2 flex lg:flex-col gap-1 overflow-x-auto lg:sticky lg:top-20" data-testid="settings-side-menu">
          {TABS.map(([k, l, Icon]) => (
            <button key={k} onClick={() => setSearchParams({ tab: k })} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition text-left ${tab === k ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`} data-testid={`settings-tab-${k}`}>
              <Icon className={`w-4 h-4 shrink-0 ${tab === k ? "text-white" : "text-slate-400"}`} /> {l}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0 space-y-6">
          {tab === "company" && <div className="space-y-4"><CompanyForm companyId={companyId} /><CompanyLocationPanel companyId={companyId} /></div>}
          {tab === "plan" && <MyPlanPanel companyId={companyId} />}
          {tab === "print" && <PrintSettings companyId={companyId} />}
          {tab === "einvoice" && <EInvoiceSettings companyId={companyId} />}
          {tab === "sms" && <SmsCenter companyId={companyId} contacts={contacts} />}
          {tab === "mail" && <MailClient companyId={companyId} />}
          {tab === "bank" && <BankConnectionsPanel companyId={companyId} accounts={accounts} contacts={contacts} />}
          {tab === "channels" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
              <a href="/ecommerce" className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-500 flex items-center gap-3" data-testid="settings-link-ecommerce"><ShoppingCart className="w-6 h-6 text-orange-500" /><div><div className="text-sm font-bold">E-Ticaret Entegrasyonları</div><div className="text-xs text-slate-500">Trendyol, Hepsiburada, N11… API anahtarları</div></div><LinkIcon className="w-4 h-4 text-slate-300 ml-auto" /></a>
              <a href="/cargo" className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-500 flex items-center gap-3" data-testid="settings-link-cargo"><Truck className="w-6 h-6 text-blue-500" /><div><div className="text-sm font-bold">Kargo Entegrasyonları</div><div className="text-xs text-slate-500">Yurtiçi, Aras, MNG, Sürat… API anahtarları</div></div><LinkIcon className="w-4 h-4 text-slate-300 ml-auto" /></a>
            </div>
          )}
          {tab === "whatsapp" && <WhatsAppSettings companyId={companyId} />}
          {tab === "units" && <UnitsCategories companyId={companyId} />}
          {tab === "users" && <UsersRolesPanel companyId={companyId} />}
          {tab === "migration" && <MigrationPanel companyId={companyId} />}
          {tab === "summary" && <MorningSummarySettings companyId={companyId} />}
          {tab === "modules" && <ModuleOrder />}
        </div>
      </div>
    </div>
  );
}

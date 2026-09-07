import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save, Loader2, Send, Mail, MessageCircle, Bell, CreditCard, KeyRound } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { fmtTL, fmtDate, StatCard, Toggle, inputCls } from "./saasUi";

const PAY_STYLE = { paid: "bg-emerald-50 text-emerald-700", pending: "bg-amber-50 text-amber-700", expired: "bg-slate-100 text-slate-500", failed: "bg-rose-50 text-rose-700" };
const PAY_LABEL = { paid: "Ödendi", pending: "Bekliyor", expired: "Süresi geçti", failed: "Başarısız" };

export const PaymentsPanel = () => {
  const [d, setD] = useState(null);
  useEffect(() => { axios.get(`${API_URL}/system/payments`).then((r) => setD(r.data)).catch(() => toast.error("Ödemeler alınamadı.")); }, []);
  if (!d) return <div className="text-xs text-slate-400">Yükleniyor…</div>;
  return (
    <div className="space-y-4 text-xs" data-testid="saas-payments">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3"><StatCard label="Tahsil Edilen" value={fmtTL(d.total_paid)} accent="text-emerald-700" testId="pay-total" /><StatCard label="Başarılı Ödeme" value={d.paid_count} testId="pay-count" /><StatCard label="Toplam Deneme" value={d.items.length} testId="pay-attempts" /></div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[760px]"><thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2.5 text-left">Tarih</th><th className="px-3 py-2.5 text-left">Şirket</th><th className="px-3 py-2.5 text-left">Paket</th><th className="px-3 py-2.5 text-left">Dönem</th><th className="px-3 py-2.5 text-right">Tutar</th><th className="px-3 py-2.5 text-left">Durum</th><th className="px-3 py-2.5 text-left">Sağlayıcı / Fatura</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{d.items.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Henüz ödeme yok.</td></tr>}
            {d.items.map((t) => <tr key={t.id} data-testid={`pay-row-${t.id}`}><td className="px-3 py-2">{fmtDate(t.created_at)}</td><td className="px-3 py-2 font-semibold text-slate-800">{t.company_name}</td><td className="px-3 py-2">{t.plan_name}</td><td className="px-3 py-2">{t.product_type === "gib_credits" ? "Kontör" : t.period === "yearly" ? "Yıllık" : "Aylık"}</td><td className="px-3 py-2 text-right font-bold">{Number(t.amount).toLocaleString("tr-TR")} {String(t.currency).toUpperCase()}</td><td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${PAY_STYLE[t.payment_status] || PAY_STYLE.expired}`}>{PAY_LABEL[t.payment_status] || t.payment_status}</span>{t.applied && <span className="ml-1 text-[9px] text-emerald-600">{t.product_type === "gib_credits" ? "kontör yüklendi" : "lisans aktif"}</span>}</td><td className="px-3 py-2 text-[10px]"><span className={`px-1.5 py-0.5 rounded font-bold ${t.provider === "paytr" ? "bg-sky-50 text-sky-700" : "bg-indigo-50 text-indigo-700"}`}>{t.provider === "paytr" ? "PayTR" : "Stripe"}</span>{t.invoice_number && <span className="ml-1.5 font-mono text-emerald-700" data-testid={`pay-invoice-${t.id}`}>{t.invoice_number}</span>}<div className="font-mono text-slate-400">{t.session_id?.slice(0, 22)}…</div></td></tr>)}</tbody></table>
      </div>
      <p className="text-[10px] text-slate-400 flex items-center gap-1"><CreditCard className="w-3 h-3" /> Ödemeler Stripe veya PayTR ile alınır; ödeme onaylanınca paket otomatik aktive edilir, e-Arşiv fatura kesilip müşteriye e-posta ile gönderilir.</p>
    </div>
  );
};

export const RemindersPanel = () => {
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => axios.get(`${API_URL}/system/reminders`).then((r) => setLog(r.data)).catch(() => toast.error("Hatırlatma günlüğü alınamadı.")), []);
  useEffect(() => { load(); }, [load]);
  const run = async () => { setBusy(true); try { const r = await axios.post(`${API_URL}/system/reminders/run`); toast.success(`${r.data.count} hatırlatma gönderildi.`); load(); } catch (e) { toast.error(e.response?.data?.detail || "Çalıştırılamadı."); } finally { setBusy(false); } };
  return (
    <div className="space-y-4 text-xs" data-testid="saas-reminders">
      <div className="flex items-center justify-between"><p className="text-slate-500">Deneme/lisans bitişinden önce belirlenen günlerde (varsayılan 7 ve 1 gün) ve bittiğinde; uygulama içi bildirim + e-posta + WhatsApp. Saatlik otomatik çalışır.</p><button onClick={run} disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="reminders-run">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Şimdi Çalıştır</button></div>
      <div className="bg-white border border-slate-200 rounded-2xl divide-y">
        {!log ? <div className="p-6 text-slate-400">Yükleniyor…</div> : log.length === 0 ? <div className="p-8 text-center text-slate-400">Henüz hatırlatma gönderilmedi.</div> : log.map((r) => (
          <div key={r.id} className="p-3 flex flex-wrap items-center gap-3" data-testid={`reminder-row-${r.id}`}>
            <div className="flex-1 min-w-[220px]"><b className="text-slate-900">{r.company_name}</b> · {r.plan_name} · <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.kind === "expired" ? "bg-rose-50 text-rose-700" : "bg-sky-50 text-sky-700"}`}>{r.kind === "expired" ? "Süresi doldu" : `${r.kind.slice(1)} gün kala`}</span><div className="text-[10px] text-slate-500">Bitiş {fmtDate(r.period_end)} · gönderim {fmtDate(r.created_at)}</div></div>
            <div className="flex items-center gap-3 text-[10px]"><span className="flex items-center gap-1 text-emerald-700"><Bell className="w-3 h-3" /> bildirim</span><span className={`flex items-center gap-1 ${r.result?.email?.length ? "text-emerald-700" : "text-slate-400"}`} title={r.result?.email_error || ""}><Mail className="w-3 h-3" /> {r.result?.email?.length ? `${r.result.email.length} e-posta` : r.result?.email_error ? "e-posta hatası" : "e-posta yok"}</span><span className={`flex items-center gap-1 ${r.result?.whatsapp?.length ? "text-emerald-700" : "text-slate-400"}`}><MessageCircle className="w-3 h-3" /> {r.result?.whatsapp?.length ? `${r.result.whatsapp.length} WhatsApp` : "WhatsApp yok"}</span></div>
          </div>))}
      </div>
    </div>
  );
};

const ChangePasswordCard = () => {
  const [f, setF] = useState({ current_password: "", new_password: "", new_password2: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (f.new_password !== f.new_password2) { toast.error("Yeni şifreler eşleşmiyor."); return; }
    setBusy(true);
    try {
      await axios.post(`${API_URL}/auth/change-password`, { current_password: f.current_password, new_password: f.new_password }, { withCredentials: true });
      setF({ current_password: "", new_password: "", new_password2: "" });
      toast.success("Şifreniz güncellendi.");
    } catch (err) { toast.error(err.response?.data?.detail || "Şifre değiştirilemedi."); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="change-password-card">
      <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-500" /> Hesap şifresi</h3>
      <p className="text-[11px] text-slate-500">Platform yönetim hesabınızın şifresini buradan değiştirin. Mevcut şifre doğrulanır; yeni şifre en az 6 karakter olmalıdır.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className="block font-semibold text-slate-700 mb-1">Mevcut şifre</label><input type="password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} className={inputCls} data-testid="chg-current-password" autoComplete="current-password" /></div>
        <div><label className="block font-semibold text-slate-700 mb-1">Yeni şifre</label><input type="password" required minLength={6} value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} className={inputCls} data-testid="chg-new-password" autoComplete="new-password" /></div>
        <div><label className="block font-semibold text-slate-700 mb-1">Yeni şifre (tekrar)</label><input type="password" required value={f.new_password2} onChange={(e) => setF({ ...f, new_password2: e.target.value })} className={inputCls} data-testid="chg-new-password2" autoComplete="new-password" /></div>
      </div>
      <div className="flex justify-end"><button type="submit" disabled={busy} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-900 rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="chg-password-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Şifreyi Değiştir</button></div>
    </form>
  );
};

export const PlatformSettingsPanel = () => {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { axios.get(`${API_URL}/system/settings`).then((r) => setS(r.data)).catch(() => toast.error("Ayarlar alınamadı.")); }, []);
  if (!s) return <div className="text-xs text-slate-400">Yükleniyor…</div>;
  const save = async (e) => { e.preventDefault(); setBusy(true); try { const r = await axios.put(`${API_URL}/system/settings`, { ...s, reminder_days: String(s.reminder_days_text ?? s.reminder_days.join(",")).split(",").map((x) => x.trim()).filter(Boolean) }); setS({ ...s, ...r.data, reminder_days_text: undefined }); toast.success("Platform ayarları kaydedildi."); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); } };
  return (
    <div className="space-y-4 text-xs max-w-3xl">
    <ChangePasswordCard />
    <form onSubmit={save} className="space-y-4" data-testid="saas-settings">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <h3 className="font-bold text-slate-900 text-sm">Hatırlatma & Gönderim</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="block font-semibold text-slate-700 mb-1">Hatırlatma günleri (bitişten kaç gün önce; virgülle)</label><input value={s.reminder_days_text ?? s.reminder_days.join(",")} onChange={(e) => setS({ ...s, reminder_days_text: e.target.value })} className={inputCls} data-testid="set-reminder-days" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Gönderici hesapların alındığı şirket</label><select value={s.sender_company_id} onChange={(e) => setS({ ...s, sender_company_id: e.target.value })} className={inputCls} data-testid="set-sender-company">{s.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><div className="text-[10px] text-slate-500 mt-1">SMTP: {s.sender_mail || "tanımlı değil"} · WhatsApp: {s.sender_whatsapp_ready ? "hazır" : "tanımlı değil (simüle)"}</div></div>
          <label className="flex items-center gap-2"><Toggle on={!!s.email_enabled} onChange={(v) => setS({ ...s, email_enabled: v })} testId="set-email" /> <span>E-posta gönder</span></label>
          <label className="flex items-center gap-2"><Toggle on={!!s.whatsapp_enabled} onChange={(v) => setS({ ...s, whatsapp_enabled: v })} testId="set-whatsapp" /> <span>WhatsApp gönder</span></label>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <h3 className="font-bold text-slate-900 text-sm">Kayıt & Deneme</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="block font-semibold text-slate-700 mb-1">Deneme süresi (gün)</label><input type="number" min={0} max={90} value={s.trial_days} onChange={(e) => setS({ ...s, trial_days: Number(e.target.value) })} className={inputCls} data-testid="set-trial-days" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Varsayılan deneme paketi</label><input value={s.trial_plan_id} onChange={(e) => setS({ ...s, trial_plan_id: e.target.value })} className={inputCls} data-testid="set-trial-plan" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Site adresi (tamkobi.com vitrini ve yenileme linkleri)</label><input value={s.public_url || ""} onChange={(e) => setS({ ...s, public_url: e.target.value })} placeholder="https://tamkobi.com" className={inputCls} data-testid="set-public-url" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Marka adı</label><input value={s.brand_name} onChange={(e) => setS({ ...s, brand_name: e.target.value })} className={inputCls} data-testid="set-brand" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Destek e-postası</label><input value={s.support_email || ""} onChange={(e) => setS({ ...s, support_email: e.target.value })} className={inputCls} data-testid="set-support-email" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Destek telefonu</label><input value={s.support_phone || ""} onChange={(e) => setS({ ...s, support_phone: e.target.value })} className={inputCls} data-testid="set-support-phone" /></div>
        </div>
      </div>
      <PaytrSettings />
      <GibPacksEditor packs={s.gib_packs || []} onChange={(gib_packs) => setS({ ...s, gib_packs })} />
      <div className="flex justify-end"><button type="submit" disabled={busy} className="px-5 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="set-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button></div>
    </form>
    </div>
  );
};

const GibPacksEditor = ({ packs, onChange }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="gib-packs-editor">
    <h3 className="font-bold text-slate-900 text-sm">GİB kontör paketleri (müşteri satışı)</h3>
    <p className="text-[11px] text-slate-500">Hesap → GİB Kontör ekranında görünür. Ödeme PayTR/Stripe ile alınır, kontör lisans cüzdanına yüklenir.</p>
    <div className="space-y-2">
      {(packs || []).map((p, i) => (
        <div key={p.id || i} className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid={`gib-pack-edit-${p.id}`}>
          <input value={p.name || ""} onChange={(e) => onChange(packs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className={inputCls} placeholder="Ad" />
          <input type="number" min={1} value={p.credits || 0} onChange={(e) => onChange(packs.map((x, j) => j === i ? { ...x, credits: Number(e.target.value) } : x))} className={inputCls} placeholder="Kontör" />
          <input type="number" min={0} value={p.price || 0} onChange={(e) => onChange(packs.map((x, j) => j === i ? { ...x, price: Number(e.target.value) } : x))} className={inputCls} placeholder="Fiyat ₺" />
          <input value={p.tagline || ""} onChange={(e) => onChange(packs.map((x, j) => j === i ? { ...x, tagline: e.target.value } : x))} className={inputCls} placeholder="Kısa not" />
          <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={!!p.popular} onChange={(e) => onChange(packs.map((x, j) => j === i ? { ...x, popular: e.target.checked } : x))} /> Popüler</label>
        </div>
      ))}
    </div>
  </div>
);

const PaytrSettings = () => {
  const [p, setP] = useState(null);
  const [f, setF] = useState({ merchant_key: "", merchant_salt: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { axios.get(`${API_URL}/system/paytr`).then((r) => setP(r.data)).catch(() => {}); }, []);
  if (!p) return null;
  const save = async () => { setBusy(true); try { const r = await axios.put(`${API_URL}/system/paytr`, { ...p, ...f }); setP(r.data); setF({ merchant_key: "", merchant_salt: "" }); toast.success("PayTR ayarları kaydedildi."); } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); } };
  const test = async () => { setBusy(true); try { const r = await axios.post(`${API_URL}/system/paytr/test`, {}); setP({ ...p, last_test: { ok: r.data.ok, reason: r.data.reason } }); (r.data.ok ? toast.success : toast.error)(r.data.message); } catch (e) { toast.error(e.response?.data?.detail || "Test yapılamadı."); } finally { setBusy(false); } };
  const cb = `${window.location.origin}/api/payments/paytr/callback`;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="paytr-settings">
      <div className="flex items-center justify-between"><h3 className="font-bold text-slate-900 text-sm">PayTR (Türkiye kartlı ödeme)</h3><label className="flex items-center gap-2"><Toggle on={!!p.enabled} onChange={(v) => setP({ ...p, enabled: v })} testId="paytr-enabled" /> <span>Aktif</span></label></div>
      <ol className="text-[10px] text-slate-600 space-y-1 list-decimal pl-4 bg-slate-50 rounded-xl p-3" data-testid="paytr-checklist">
        <li><b>PayTR Mağaza Paneli → Bilgi</b> sayfasından Merchant ID, Merchant Key ve Merchant Salt değerlerini aşağıya girin, <b>PayTR Kaydet</b>.</li>
        <li><b>Bağlantıyı Test Et</b> ile bilgilerin PayTR tarafından kabul edildiğini doğrulayın.</li>
        <li>PayTR Paneli → Ayarlar → <b>Bildirim URL</b> alanına şunu kaydedin: <code className="bg-white border px-1 rounded select-all" data-testid="paytr-callback-url">{cb}</code> <button type="button" onClick={() => { navigator.clipboard?.writeText(cb); toast.success("Kopyalandı"); }} className="text-sky-700 font-semibold" data-testid="paytr-copy-callback">kopyala</button></li>
        <li>Test modunda PayTR test kartıyla bir ödeme yapın; sonra <b>Test modu</b>nu kapatıp canlıya alın. Anahtarlar şifreli saklanır.</li>
      </ol>
      {p.last_test && <div className={`text-[10px] rounded-lg px-3 py-2 ${p.last_test.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`} data-testid="paytr-last-test">Son test: {p.last_test.ok ? "başarılı" : `başarısız – ${p.last_test.reason || ""}`}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className="block font-semibold text-slate-700 mb-1">Merchant ID</label><input value={p.merchant_id || ""} onChange={(e) => setP({ ...p, merchant_id: e.target.value })} className={inputCls} data-testid="paytr-merchant-id" /></div>
        <div><label className="block font-semibold text-slate-700 mb-1">Merchant Key {p.has_key && <span className="text-emerald-600">(kayıtlı)</span>}</label><input type="password" value={f.merchant_key} onChange={(e) => setF({ ...f, merchant_key: e.target.value })} placeholder={p.has_key ? "••••••••" : ""} className={inputCls} data-testid="paytr-merchant-key" /></div>
        <div><label className="block font-semibold text-slate-700 mb-1">Merchant Salt {p.has_salt && <span className="text-emerald-600">(kayıtlı)</span>}</label><input type="password" value={f.merchant_salt} onChange={(e) => setF({ ...f, merchant_salt: e.target.value })} placeholder={p.has_salt ? "••••••••" : ""} className={inputCls} data-testid="paytr-merchant-salt" /></div>
        <label className="flex items-center gap-2"><Toggle on={!!p.test_mode} onChange={(v) => setP({ ...p, test_mode: v })} testId="paytr-test-mode" /> <span>Test modu</span></label>
        <div><label className="block font-semibold text-slate-700 mb-1">Maks. taksit (0 = tek çekim)</label><input type="number" min={0} max={12} value={p.max_installment || 0} onChange={(e) => setP({ ...p, max_installment: Number(e.target.value) })} className={inputCls} data-testid="paytr-max-installment" /></div>
      </div>
      <div className="flex justify-end gap-2"><button type="button" onClick={test} disabled={busy || !(p.has_key && p.has_salt && p.merchant_id)} className="px-4 py-2 border border-sky-300 text-sky-700 rounded-xl font-bold disabled:opacity-50" data-testid="paytr-test">Bağlantıyı Test Et</button><button type="button" onClick={save} disabled={busy} className="px-4 py-2 bg-sky-600 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="paytr-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} PayTR Kaydet</button></div>
    </div>
  );
};

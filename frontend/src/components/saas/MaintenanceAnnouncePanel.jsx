import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Eye, Loader2, LogIn, Megaphone, Save, Trash2, Wrench } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { Toggle, inputCls } from "./saasUi";
import { PlatformNoticeModal } from "../PlatformNoticeModal";
import {
  fromDatetimeLocalValue,
  pickVisibleNotice,
  toDatetimeLocalValue,
} from "../../utils/platformNotices";

const emptyAnnounce = () => ({
  title: "",
  body: "",
  starts_at: toDatetimeLocalValue(new Date().toISOString()),
  ends_at: "",
  active: true,
  status: "draft",
  audience: "all",
  company_ids: [],
  notify_sms: false,
});

/** DEMO / test şirketi: isimde "demo" geçen ilk kayıt. */
export function pickDemoCompany(companies) {
  const rows = companies || [];
  const exact = rows.find((c) => String(c.name || "").trim().toLowerCase() === "demo");
  if (exact) return exact;
  return rows.find((c) => /\bdemo\b/i.test(String(c.name || ""))) || null;
}

/** Platform: bakım zamanı + şirketlere pop-up duyuru (hedefli + taslak/demo). */
export function MaintenanceAnnouncePanel() {
  const [m, setM] = useState(null);
  const [list, setList] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState(emptyAnnounce);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewCompanyId, setPreviewCompanyId] = useState("");

  const companyById = useMemo(() => {
    const map = new Map();
    companies.forEach((c) => map.set(c.id || c._id, c));
    return map;
  }, [companies]);

  const demoCompany = useMemo(() => pickDemoCompany(companies), [companies]);
  const demoId = demoCompany ? (demoCompany.id || demoCompany._id) : "";

  const load = async () => {
    try {
      const [mr, ar, cr] = await Promise.all([
        axios.get(`${API_URL}/system/maintenance`),
        axios.get(`${API_URL}/system/announcements`),
        axios.get(`${API_URL}/system/companies`).catch(() => ({ data: [] })),
      ]);
      setM({
        ...mr.data,
        starts_local: toDatetimeLocalValue(mr.data.starts_at),
        ends_local: toDatetimeLocalValue(mr.data.ends_at),
        audience: mr.data.audience || "all",
        company_ids: Array.isArray(mr.data.company_ids) ? mr.data.company_ids : [],
      });
      setList(Array.isArray(ar.data) ? ar.data : []);
      const rows = Array.isArray(cr.data) ? cr.data : (cr.data?.companies || []);
      setCompanies(rows);
      setPreviewCompanyId((prev) => {
        if (prev) return prev;
        const demo = pickDemoCompany(rows);
        if (demo) return demo.id || demo._id || "";
        return rows[0] ? (rows[0].id || rows[0]._id || "") : "";
      });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Ayarlar yüklenemedi.");
    }
  };

  useEffect(() => { load(); }, []);

  const saveMaintenance = async (e) => {
    e.preventDefault();
    if (m.audience === "selected" && !(m.company_ids || []).length) {
      toast.error("Seçili şirketler için en az bir şirket işaretleyin.");
      return;
    }
    if (m.audience !== "selected" && m.enabled && m.notify_popup !== false) {
      if (!window.confirm("Bu güncelleme pop-up’ı TÜM şirketlere gidecek. Devam?")) return;
    }
    setBusy(true);
    try {
      const r = await axios.put(`${API_URL}/system/maintenance`, {
        enabled: !!m.enabled,
        notify_popup: m.notify_popup !== false,
        notify_sms: !!m.notify_sms,
        title: m.title,
        body: m.body,
        starts_at: fromDatetimeLocalValue(m.starts_local),
        ends_at: fromDatetimeLocalValue(m.ends_local),
        support_email: m.support_email || null,
        support_phone: m.support_phone || null,
        audience: m.audience || "all",
        company_ids: m.audience === "selected" ? (m.company_ids || []) : [],
      });
      setM({
        ...r.data,
        starts_local: toDatetimeLocalValue(r.data.starts_at),
        ends_local: toDatetimeLocalValue(r.data.ends_at),
        audience: r.data.audience || "all",
        company_ids: Array.isArray(r.data.company_ids) ? r.data.company_ids : [],
      });
      toast.success(r.data.message || "Kaydedildi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const targetMaintDemoOnly = () => {
    if (!demoId) {
      toast.error("DEMO şirketi bulunamadı. Önce «Seçili şirketler» ile bir test şirketi işaretleyin.");
      return;
    }
    setM({ ...m, audience: "selected", company_ids: [demoId] });
    toast.info(`Hedef: yalnızca ${demoCompany?.name || "DEMO"}. Kaydet’e basın.`);
  };

  const saveAnnounce = async (status, { audience, company_ids } = {}) => {
    if (!form.title.trim() || !form.body.trim()) {
      toast.error("Başlık ve metin zorunlu.");
      return;
    }
    const aud = audience || form.audience || "all";
    const cids = company_ids != null ? company_ids : (form.company_ids || []);
    if (aud === "selected" && !cids.length) {
      toast.error("Seçili şirketler için en az bir şirket işaretleyin.");
      return;
    }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/system/announcements`, {
        title: form.title.trim(),
        body: form.body.trim(),
        active: !!form.active,
        status,
        audience: aud,
        company_ids: aud === "selected" ? cids : [],
        starts_at: fromDatetimeLocalValue(form.starts_at) || new Date().toISOString(),
        ends_at: fromDatetimeLocalValue(form.ends_at),
        notify_sms: !!form.notify_sms,
      });
      toast.success(r.data.message || (status === "draft" ? "Taslak kaydedildi." : "Yayınlandı."));
      setForm(emptyAnnounce());
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const publishToDemo = async () => {
    if (!demoId) {
      toast.error("DEMO şirketi yok. Listeden bir test şirketi seçip «Seçili şirketler» ile yayınlayın.");
      return;
    }
    await saveAnnounce("published", { audience: "selected", company_ids: [demoId] });
  };

  const remove = async (id) => {
    if (!window.confirm("Bu duyuru silinsin mi?")) return;
    try {
      await axios.delete(`${API_URL}/system/announcements/${id}`);
      toast.success("Silindi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    }
  };

  const toggleActive = async (row) => {
    try {
      await axios.put(`${API_URL}/system/announcements/${row.id}`, { active: !row.active });
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Güncellenemedi.");
    }
  };

  const publishRow = async (row, opts = {}) => {
    try {
      const body = {};
      if (opts.demoOnly) {
        if (!demoId) { toast.error("DEMO şirketi bulunamadı."); return; }
        body.audience = "selected";
        body.company_ids = [demoId];
      }
      const r = await axios.post(`${API_URL}/system/announcements/${row.id}/publish`, body);
      toast.success(r.data.message || "Yayınlandı.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Yayınlanamadı.");
    }
  };

  const expandToAll = async (row) => {
    if (!window.confirm("Bu duyuru tüm şirketlere açılsın mı?")) return;
    try {
      const r = await axios.post(`${API_URL}/system/announcements/${row.id}/retarget`, {
        audience: "all",
        company_ids: [],
        publish: true,
      });
      toast.success(r.data.message || "Tüm şirketlere genişletildi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Hedef güncellenemedi.");
    }
  };

  const openDemoPreview = async () => {
    setBusy(true);
    try {
      const r = await axios.get(`${API_URL}/system/announcements/preview`, {
        params: previewCompanyId ? { company_id: previewCompanyId } : {},
      });
      const notice = pickVisibleNotice(r.data, { getItem: () => null });
      if (!notice) {
        toast.info("Bu şirket için görünür duyuru/bakım yok (taslaklar dahil).");
        return;
      }
      setPreview({ ...notice, _demo: true });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Önizleme alınamadı.");
    } finally {
      setBusy(false);
    }
  };

  const enterDemoPanel = async () => {
    const cid = previewCompanyId || demoId;
    if (!cid) {
      toast.error("Şirket seçin.");
      return;
    }
    setBusy(true);
    try {
      const res = await axios.post(`${API_URL}/system/companies/${cid}/impersonate`, {});
      toast.success(res.data.message || "Demo paneline giriliyor…");
      window.location.href = "/";
    } catch (e) {
      toast.error(e.response?.data?.detail || "Şirket paneline girilemedi. Gizlilik kapalı olabilir.");
    } finally {
      setBusy(false);
    }
  };

  const toggleCompany = (cid, target, setTarget) => {
    const cur = new Set(target.company_ids || []);
    if (cur.has(cid)) cur.delete(cid);
    else cur.add(cid);
    setTarget({ ...target, company_ids: [...cur] });
  };

  const audienceBlock = (state, setState, testPrefix) => (
    <div className="space-y-2 sm:col-span-2" data-testid={`${testPrefix}-audience`}>
      <label className="block font-semibold text-slate-700">Hedef şirketler</label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setState({ ...state, audience: "all", company_ids: [] })} className={`px-3 py-1.5 rounded-lg border font-semibold ${state.audience !== "selected" ? "bg-slate-900 text-white border-slate-900" : "bg-white"}`} data-testid={`${testPrefix}-audience-all`}>Tüm şirketler</button>
        <button type="button" onClick={() => setState({ ...state, audience: "selected" })} className={`px-3 py-1.5 rounded-lg border font-semibold ${state.audience === "selected" ? "bg-slate-900 text-white border-slate-900" : "bg-white"}`} data-testid={`${testPrefix}-audience-selected`}>Seçili şirketler</button>
        {demoId && (
          <button
            type="button"
            onClick={() => setState({ ...state, audience: "selected", company_ids: [demoId] })}
            className={`px-3 py-1.5 rounded-lg border font-semibold ${(state.audience === "selected" && (state.company_ids || []).length === 1 && state.company_ids[0] === demoId) ? "bg-amber-600 text-white border-amber-600" : "bg-amber-50 text-amber-900 border-amber-200"}`}
            data-testid={`${testPrefix}-audience-demo`}
          >
            Yalnızca {demoCompany?.name || "DEMO"}
          </button>
        )}
      </div>
      {state.audience === "selected" && (
        <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-xl p-2 space-y-1 bg-slate-50" data-testid={`${testPrefix}-company-list`}>
          {!companies.length && <p className="text-slate-400 px-1">Şirket listesi boş.</p>}
          {companies.map((c) => {
            const id = c.id || c._id;
            const checked = (state.company_ids || []).includes(id);
            return (
              <label key={id} className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-white cursor-pointer">
                <input type="checkbox" checked={checked} onChange={() => toggleCompany(id, state, setState)} data-testid={`${testPrefix}-company-${id}`} />
                <span className="font-semibold text-slate-800 truncate">{c.name || id}</span>
                <span className="text-[10px] text-slate-400 ml-auto">{c.plan_name || c.license?.plan_name || ""}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );

  if (!m) {
    return <div className="text-xs text-slate-400">Yükleniyor…</div>;
  }

  return (
    <div className="space-y-4 text-xs max-w-3xl" data-testid="maintenance-announce-panel">
      <form onSubmit={saveMaintenance} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Wrench className="w-4 h-4 text-teal-600" /> Güncelleme / Bakım Penceresi
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Zamanı ve hedef şirketleri belirleyin. Önce «Yalnızca DEMO» seçip kaydedin; test sonrası tüm şirketlere genişletin.
              {m.active ? <span className="ml-1 font-semibold text-amber-700">Şu an aktif.</span> : null}
              {m.upcoming ? <span className="ml-1 font-semibold text-sky-700">Zamanlandı (bekliyor).</span> : null}
            </p>
          </div>
          <label className="flex items-center gap-2 shrink-0">
            <Toggle on={!!m.enabled} onChange={(v) => setM({ ...m, enabled: v })} testId="maint-enabled" />
            <span className="font-semibold">{m.enabled ? "Açık" : "Kapalı"}</span>
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">Başlık</label>
            <input value={m.title || ""} onChange={(e) => setM({ ...m, title: e.target.value })} className={inputCls} data-testid="maint-title" />
          </div>
          <div className="sm:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">Metin</label>
            <textarea value={m.body || ""} onChange={(e) => setM({ ...m, body: e.target.value })} rows={6} className={`${inputCls} font-normal`} data-testid="maint-body" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Başlangıç</label>
            <input type="datetime-local" value={m.starts_local || ""} onChange={(e) => setM({ ...m, starts_local: e.target.value })} className={inputCls} data-testid="maint-starts" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Bitiş</label>
            <input type="datetime-local" value={m.ends_local || ""} onChange={(e) => setM({ ...m, ends_local: e.target.value })} className={inputCls} data-testid="maint-ends" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Destek e-posta</label>
            <input value={m.support_email || ""} onChange={(e) => setM({ ...m, support_email: e.target.value })} className={inputCls} data-testid="maint-email" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Destek telefon</label>
            <input value={m.support_phone || ""} onChange={(e) => setM({ ...m, support_phone: e.target.value })} className={inputCls} data-testid="maint-phone" />
          </div>
          {audienceBlock(m, setM, "maint")}
          <label className="flex items-center gap-2 sm:col-span-2">
            <Toggle on={m.notify_popup !== false} onChange={(v) => setM({ ...m, notify_popup: v })} testId="maint-notify-popup" />
            <span>Şirketlere bilgilendirme pop-up’ı göster (zamanlanmış veya aktif)</span>
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <Toggle on={!!m.notify_sms} onChange={(v) => setM({ ...m, notify_sms: v })} testId="maint-notify-sms" />
            <span>Şirket adminlerine SMS gönder (Platform SMS Modülü)</span>
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {demoId && (
            <button type="button" onClick={targetMaintDemoOnly} className="px-4 py-2 border border-amber-300 bg-amber-50 text-amber-900 rounded-xl font-bold" data-testid="maint-target-demo">
              Hedefi DEMO yap
            </button>
          )}
          <button type="submit" disabled={busy} className="px-5 py-2 bg-teal-600 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="maint-save">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet
          </button>
        </div>
      </form>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="announce-compose">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
          <Megaphone className="w-4 h-4 text-amber-600" /> Duyuru Pop-up’ı
        </h3>
        <ol className="text-[11px] text-slate-600 space-y-1 list-decimal list-inside bg-slate-50 border border-slate-100 rounded-xl p-3" data-testid="announce-workflow-steps">
          <li><b>Taslak kaydet</b> veya doğrudan <b>DEMO’ya yayınla</b> — diğer şirketler görmez.</li>
          <li>Aşağıdan <b>Demo aç</b> (önizleme) veya <b>Panele gir</b> (canlı veri ile test).</li>
          <li>Beğenirsen listeden <b>Tüm şirketlere aç</b> veya formda hedefi seçip <b>Hedefe yayınla</b>.</li>
        </ol>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Başlık</label>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} placeholder="Örn. İki Aşamalı Doğrulama (2FA)" data-testid="announce-title" />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Metin</label>
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={7} className={`${inputCls} font-normal`} placeholder="Değerli Kullanıcımız,…" data-testid="announce-body" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Gösterim başlangıcı</label>
            <input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className={inputCls} data-testid="announce-starts" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Bitiş (opsiyonel)</label>
            <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className={inputCls} data-testid="announce-ends" />
          </div>
          {audienceBlock(form, setForm, "announce")}
        </div>
        <label className="flex items-center gap-2">
          <Toggle on={!!form.notify_sms} onChange={(v) => setForm({ ...form, notify_sms: v })} testId="announce-notify-sms" />
          <span>Yayınlanırken hedef şirket adminlerine SMS gönder</span>
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => saveAnnounce("draft")} className="px-4 py-2 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 disabled:opacity-60" data-testid="announce-draft">Taslak kaydet</button>
          <button type="button" disabled={busy || !demoId} onClick={publishToDemo} className="px-4 py-2 bg-amber-600 text-white rounded-xl font-bold disabled:opacity-60" data-testid="announce-publish-demo" title={!demoId ? "DEMO şirketi yok" : undefined}>
            DEMO’ya yayınla
          </button>
          <button type="button" disabled={busy} onClick={() => saveAnnounce("published")} className="px-5 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="announce-publish">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />} Hedefe yayınla
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2" data-testid="announce-demo-box">
        <h3 className="font-bold text-amber-900 text-sm flex items-center gap-1.5"><Eye className="w-4 h-4" /> Demo önizleme & canlı test</h3>
        <p className="text-[11px] text-amber-800">
          Pop-up’ı burada önizleyin; canlı veri ile denemek için seçili şirketin paneline girin
          {demoCompany ? <> (önerilen: <b>{demoCompany.name}</b>)</> : null}.
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[12rem]">
            <label className="block font-semibold text-amber-900 mb-1">Şirket olarak gör</label>
            <select value={previewCompanyId} onChange={(e) => setPreviewCompanyId(e.target.value)} className={inputCls} data-testid="announce-demo-company">
              <option value="">— şirket seç —</option>
              {companies.map((c) => <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>)}
            </select>
          </div>
          <button type="button" disabled={busy} onClick={openDemoPreview} className="px-4 py-2 bg-amber-600 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="announce-demo-btn">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Demo aç
          </button>
          <button type="button" disabled={busy || !(previewCompanyId || demoId)} onClick={enterDemoPanel} className="px-4 py-2 border border-amber-400 bg-white text-amber-900 rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="announce-enter-demo-btn" title="Seçili şirketin paneline destek moduyla gir (canlı veri)">
            <LogIn className="w-4 h-4" /> Panele gir
          </button>
        </div>
        {!demoCompany && (
          <p className="text-[10px] text-amber-700" data-testid="announce-no-demo-hint">
            İsimde «DEMO» geçen bir şirket yoksa Platform → Şirketler’den test şirketi oluşturun; sonra burada hedefleyebilirsiniz.
          </p>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2" data-testid="announce-list">
        <h3 className="font-bold text-slate-900 text-sm">Duyurular</h3>
        {!list.length && <p className="text-slate-400">Henüz duyuru yok.</p>}
        {list.map((row) => {
          const onlyDemo = row.audience === "selected" && demoId && (row.company_ids || []).length === 1 && row.company_ids[0] === demoId;
          return (
            <div key={row.id} className="border border-slate-100 rounded-xl p-3 flex gap-3 items-start" data-testid={`announce-row-${row.id}`}>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 truncate">{row.title}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {row.kind || "info"} · {row.status === "draft" ? "taslak" : "yayında"} · {row.active ? "aktif" : "pasif"}
                  {" · "}
                  {onlyDemo
                    ? `yalnızca ${demoCompany?.name || "DEMO"}`
                    : row.audience === "selected"
                      ? `seçili (${(row.company_ids || []).length})`
                      : "tüm şirketler"}
                  {row.starts_at ? ` · ${new Date(row.starts_at).toLocaleString("tr-TR")}` : ""}
                </div>
                <p className="text-[11px] text-slate-600 mt-1 line-clamp-2 whitespace-pre-wrap">{row.body}</p>
                {row.audience === "selected" && (row.company_ids || []).length > 0 && (
                  <p className="text-[10px] text-slate-400 mt-1 truncate">
                    {(row.company_ids || []).map((id) => companyById.get(id)?.name || id).join(", ")}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                {row.status === "draft" && (
                  <>
                    <button type="button" onClick={() => publishRow(row, { demoOnly: true })} className="px-2 py-1 bg-amber-600 text-white rounded-lg font-semibold" data-testid={`announce-publish-demo-row-${row.id}`}>DEMO’ya yayınla</button>
                    <button type="button" onClick={() => publishRow(row)} className="px-2 py-1 bg-emerald-600 text-white rounded-lg font-semibold" data-testid={`announce-publish-row-${row.id}`}>Yayınla</button>
                  </>
                )}
                {row.status === "published" && row.audience === "selected" && (
                  <button type="button" onClick={() => expandToAll(row)} className="px-2 py-1 bg-slate-900 text-white rounded-lg font-semibold" data-testid={`announce-expand-all-${row.id}`}>Tüm şirketlere aç</button>
                )}
                <button type="button" onClick={() => toggleActive(row)} className="px-2 py-1 border rounded-lg font-semibold" data-testid={`announce-toggle-${row.id}`}>
                  {row.active ? "Pasifleştir" : "Aktifleştir"}
                </button>
                <button type="button" onClick={() => remove(row.id)} className="px-2 py-1 text-rose-600 border border-rose-200 rounded-lg inline-flex items-center justify-center" data-testid={`announce-del-${row.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        <PlatformNoticeModal
          notice={preview}
          onClose={() => setPreview(null)}
          onDontShowAgain={() => setPreview(null)}
        />
      )}
    </div>
  );
}

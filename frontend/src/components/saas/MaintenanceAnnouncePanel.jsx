import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Megaphone, Save, Trash2, Wrench } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { Toggle, inputCls } from "./saasUi";
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "../../utils/platformNotices";

const emptyAnnounce = () => ({
  title: "",
  body: "",
  starts_at: toDatetimeLocalValue(new Date().toISOString()),
  ends_at: "",
  active: true,
});

/** Platform: bakım zamanı + şirketlere pop-up duyuru. */
export function MaintenanceAnnouncePanel() {
  const [m, setM] = useState(null);
  const [list, setList] = useState([]);
  const [form, setForm] = useState(emptyAnnounce);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [mr, ar] = await Promise.all([
        axios.get(`${API_URL}/system/maintenance`),
        axios.get(`${API_URL}/system/announcements`),
      ]);
      setM({
        ...mr.data,
        starts_local: toDatetimeLocalValue(mr.data.starts_at),
        ends_local: toDatetimeLocalValue(mr.data.ends_at),
      });
      setList(Array.isArray(ar.data) ? ar.data : []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Ayarlar yüklenemedi.");
    }
  };

  useEffect(() => { load(); }, []);

  const saveMaintenance = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await axios.put(`${API_URL}/system/maintenance`, {
        enabled: !!m.enabled,
        notify_popup: m.notify_popup !== false,
        title: m.title,
        body: m.body,
        starts_at: fromDatetimeLocalValue(m.starts_local),
        ends_at: fromDatetimeLocalValue(m.ends_local),
        support_email: m.support_email || null,
        support_phone: m.support_phone || null,
      });
      setM({
        ...r.data,
        starts_local: toDatetimeLocalValue(r.data.starts_at),
        ends_local: toDatetimeLocalValue(r.data.ends_at),
      });
      toast.success(r.data.message || "Kaydedildi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const publishAnnounce = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) {
      toast.error("Başlık ve metin zorunlu.");
      return;
    }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/system/announcements`, {
        title: form.title.trim(),
        body: form.body.trim(),
        active: !!form.active,
        starts_at: fromDatetimeLocalValue(form.starts_at) || new Date().toISOString(),
        ends_at: fromDatetimeLocalValue(form.ends_at),
      });
      toast.success(r.data.message || "Duyuru yayınlandı.");
      setForm(emptyAnnounce());
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Yayınlanamadı.");
    } finally {
      setBusy(false);
    }
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
              Zamanı belirleyin. Aktifken şirketlerde hata sayfası yerine bilgilendirme pop-up’ı çıkar.
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
          <label className="flex items-center gap-2 sm:col-span-2">
            <Toggle on={m.notify_popup !== false} onChange={(v) => setM({ ...m, notify_popup: v })} testId="maint-notify-popup" />
            <span>Şirketlere bilgilendirme pop-up’ı göster (zamanlanmış veya aktif)</span>
          </label>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="px-5 py-2 bg-teal-600 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="maint-save">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet
          </button>
        </div>
      </form>

      <form onSubmit={publishAnnounce} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
          <Megaphone className="w-4 h-4 text-amber-600" /> Anlık Duyuru Pop-up’ı
        </h3>
        <p className="text-[11px] text-slate-500">
          Resimdeki gibi başlıklı bilgilendirme: şirket panellerinde “Bir Daha Gösterme” / “Kapat” ile çıkar.
        </p>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Başlık</label>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} placeholder="Örn. İki Aşamalı Doğrulama (2FA) Sistemine Geçiyoruz" data-testid="announce-title" />
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
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="px-5 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="announce-publish">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />} Yayınla
          </button>
        </div>
      </form>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2" data-testid="announce-list">
        <h3 className="font-bold text-slate-900 text-sm">Yayınlanan duyurular</h3>
        {!list.length && <p className="text-slate-400">Henüz duyuru yok.</p>}
        {list.map((row) => (
          <div key={row.id} className="border border-slate-100 rounded-xl p-3 flex gap-3 items-start" data-testid={`announce-row-${row.id}`}>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-800 truncate">{row.title}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {row.kind || "info"} · {row.active ? "aktif" : "pasif"}
                {row.starts_at ? ` · ${new Date(row.starts_at).toLocaleString("tr-TR")}` : ""}
              </div>
              <p className="text-[11px] text-slate-600 mt-1 line-clamp-2 whitespace-pre-wrap">{row.body}</p>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button type="button" onClick={() => toggleActive(row)} className="px-2 py-1 border rounded-lg font-semibold" data-testid={`announce-toggle-${row.id}`}>
                {row.active ? "Pasifleştir" : "Aktifleştir"}
              </button>
              <button type="button" onClick={() => remove(row.id)} className="px-2 py-1 text-rose-600 border border-rose-200 rounded-lg inline-flex items-center justify-center" data-testid={`announce-del-${row.id}`}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

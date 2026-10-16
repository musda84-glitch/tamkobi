import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Bell, Loader2, Save } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const EVENT_ORDER = ["einvoice_incoming", "order_new", "gib_credits_low", "receivable_overdue"];
const FALLBACK_LABELS = {
  einvoice_incoming: "Gelen e-Fatura",
  order_new: "Yeni sipariş",
  gib_credits_low: "GİB kontör düşük",
  receivable_overdue: "Vadesi geçmiş alacak",
};

function draftFrom(view) {
  const events = {};
  for (const key of EVENT_ORDER) {
    const row = (view?.events || {})[key] || {};
    events[key] = {
      inapp: row.inapp?.tenant !== false,
      email: row.email?.tenant !== false,
    };
  }
  return events;
}

function ChannelCell({ eventKey, field, platform, checked, canEdit, onChange }) {
  const disabled = !canEdit || platform === false;
  return (
    <div className="flex flex-col items-center gap-1">
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={`tenant-notify-${eventKey}-${field}`}
      />
      {platform === false ? (
        <span className="text-[10px] text-slate-400 leading-tight" data-testid={`tenant-notify-${eventKey}-${field}-platform-off`}>
          Platform tarafından kapalı
        </span>
      ) : null}
    </div>
  );
}

/**
 * Firma ayarları → Bildirimler. Yalnız uygulama ve e-posta aç/kapa.
 * SMS, gruplama ve alıcılar platformdadır.
 */
export function TenantNotifyPanel({ companyId, canEdit = false }) {
  const [view, setView] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!companyId) return undefined;
    let cancelled = false;
    axios
      .get(`${API_URL}/notify/tenant-prefs`, { params: { company_id: companyId }, withCredentials: true })
      .then((r) => {
        if (cancelled) return;
        setView(r.data);
        setDraft(draftFrom(r.data));
      })
      .catch(() => toast.error("Bildirim ayarları yüklenemedi."));
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (!view || !draft) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 text-xs text-slate-500 flex items-center gap-2" data-testid="tenant-notify-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor…
      </div>
    );
  }

  const labels = view.labels || FALLBACK_LABELS;
  const setField = (key, field, value) => {
    setDraft({
      ...draft,
      [key]: { ...(draft[key] || {}), [field]: value },
    });
  };

  const save = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    const events = {};
    for (const key of EVENT_ORDER) {
      events[key] = {
        inapp: !!(draft[key] || {}).inapp,
        email: !!(draft[key] || {}).email,
      };
    }
    setBusy(true);
    try {
      const r = await axios.put(
        `${API_URL}/notify/tenant-prefs`,
        { events },
        { params: { company_id: companyId }, withCredentials: true },
      );
      setView(r.data);
      setDraft(draftFrom(r.data));
      toast.success("Bildirim ayarları kaydedildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 text-xs" data-testid="tenant-notify-panel">
      <div className="flex items-start gap-2">
        <Bell className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-slate-900">Bildirimler</div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Gelen e-fatura, yeni sipariş, kontör ve vadesi geçmiş alacak için uygulama içi ve e-posta.
            Platformun kapattığı kanal firma tarafından açılamaz.
          </p>
          {!canEdit ? (
            <p className="text-[11px] text-slate-500 mt-1" data-testid="tenant-notify-readonly">
              Salt okunur. Değiştirmek için firma yöneticisi gerekir.
            </p>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-left" data-testid="tenant-notify-table">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Olay</th>
              <th className="px-2 py-2 font-semibold text-center">Uygulama</th>
              <th className="px-2 py-2 font-semibold text-center">E-posta</th>
            </tr>
          </thead>
          <tbody>
            {EVENT_ORDER.map((key) => {
              const row = (view.events || {})[key] || {};
              const cur = draft[key] || { inapp: true, email: true };
              return (
                <tr key={key} className="border-t border-slate-100" data-testid={`tenant-notify-event-${key}`}>
                  <td className="px-3 py-2.5 font-semibold text-slate-800">{labels[key] || key}</td>
                  <td className="px-2 py-2.5 text-center">
                    <ChannelCell
                      eventKey={key}
                      field="inapp"
                      platform={row.inapp?.platform !== false}
                      checked={cur.inapp}
                      canEdit={canEdit}
                      onChange={(value) => setField(key, "inapp", value)}
                    />
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <ChannelCell
                      eventKey={key}
                      field="email"
                      platform={row.email?.platform !== false}
                      checked={cur.email}
                      canEdit={canEdit}
                      onChange={(value) => setField(key, "email", value)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-60" data-testid="tenant-notify-save">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet
          </button>
        </div>
      ) : null}
    </form>
  );
}

export default TenantNotifyPanel;

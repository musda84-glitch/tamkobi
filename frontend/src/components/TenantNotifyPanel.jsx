import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Bell, Loader2, Save } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const GROUP_DEFS = [
  { id: "sales_invoice", title: "Satış / Fatura" },
  { id: "bank_cash_pos", title: "Banka / Kasa / POS" },
  { id: "production_warehouse", title: "Üretim / Depo" },
  { id: "personnel", title: "Personel" },
];

const EVENT_ORDER = [
  "einvoice_incoming",
  "order_new",
  "gib_credits_low",
  "receivable_overdue",
  "bank_sync",
  "cash_approval",
  "pos_approval",
  "pos_daily_summary",
  "order_pick_production",
  "attendance_alert",
  "leave_request",
  "advance_request",
  "overtime_request",
];

const GROUP_OF = {
  einvoice_incoming: "sales_invoice",
  order_new: "sales_invoice",
  gib_credits_low: "sales_invoice",
  receivable_overdue: "sales_invoice",
  bank_sync: "bank_cash_pos",
  cash_approval: "bank_cash_pos",
  pos_approval: "bank_cash_pos",
  pos_daily_summary: "bank_cash_pos",
  order_pick_production: "production_warehouse",
  attendance_alert: "personnel",
  leave_request: "personnel",
  advance_request: "personnel",
  overtime_request: "personnel",
};

const FALLBACK_LABELS = {
  einvoice_incoming: "Gelen e-Fatura",
  order_new: "Yeni sipariş",
  gib_credits_low: "GİB kontör düşük",
  receivable_overdue: "Vadesi geçmiş alacak",
  bank_sync: "Banka hareketi (senkron)",
  cash_approval: "Kasa/banka onayı",
  pos_approval: "POS onayı",
  pos_daily_summary: "Günlük POS özeti",
  order_pick_production: "Üretime gönderildi (sipariş hazırlama)",
  attendance_alert: "Mesai uyarısı (geç/eksik giriş, konum)",
  leave_request: "İzin talebi",
  advance_request: "Avans talebi",
  overtime_request: "Fazla mesai / yevmiye onayı",
};

const LOCK_NOTE = {
  platform: "Platform Yönetimi'nden kapalı",
  approval: "Onay bildirimi, kapatılamaz",
};

function groupedKeys(view) {
  const buckets = new Map(GROUP_DEFS.map((g) => [g.id, []]));
  for (const key of EVENT_ORDER) {
    const row = (view?.events || {})[key] || {};
    const group = buckets.has(row.group) ? row.group : GROUP_OF[key];
    buckets.get(group).push(key);
  }
  return GROUP_DEFS.map((g) => ({ ...g, keys: buckets.get(g.id) })).filter((g) => g.keys.length);
}

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

function changedPatch(view, draft) {
  const base = draftFrom(view);
  const events = {};
  for (const key of EVENT_ORDER) {
    const patch = {};
    const cur = draft[key] || {};
    const orig = base[key] || {};
    if (!!cur.inapp !== !!orig.inapp) patch.inapp = !!cur.inapp;
    if (!!cur.email !== !!orig.email) patch.email = !!cur.email;
    if (Object.keys(patch).length) events[key] = patch;
  }
  return events;
}

function lockOf(channel) {
  const platformOff = channel?.platform === false;
  const reason = channel?.lock_reason || (platformOff ? "platform" : "");
  const locked = channel?.locked === true || platformOff;
  return { locked, reason: locked ? reason : "" };
}

function ChannelCell({ eventKey, field, channel, checked, canEdit, onChange }) {
  const { locked, reason } = lockOf(channel);
  const disabled = !canEdit || locked;
  const note = LOCK_NOTE[reason] || "";
  return (
    <div className="flex flex-col items-center gap-1" title={note || undefined}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        title={note || undefined}
        onChange={(e) => {
          if (disabled) return;
          onChange(e.target.checked);
        }}
        data-testid={`tenant-notify-${eventKey}-${field}`}
      />
      {note ? (
        <span className="text-[10px] text-slate-400 leading-tight" data-testid={`tenant-notify-${eventKey}-${field}-lock`}>
          {note}
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

  const labels = { ...FALLBACK_LABELS, ...(view.labels || {}) };
  const setField = (key, field, value) => {
    setDraft((prev) => ({
      ...prev,
      [key]: { ...((prev || {})[key] || {}), [field]: value },
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    const events = changedPatch(view, draft);
    if (!Object.keys(events).length) {
      toast.success("Bildirim ayarları kaydedildi.");
      return;
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
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" && detail ? detail : "Kaydedilemedi.");
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
            Satış, banka, üretim ve personel olayları için uygulama içi ve e-posta.
            Platformun kapattığı kanal firma tarafından açılamaz. Onay bildirimleri uygulama içinde kapatılamaz.
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
            {groupedKeys(view).map((group) => (
              <React.Fragment key={group.id}>
                <tr data-testid={`tenant-notify-group-${group.id}`} className="bg-slate-50">
                  <td colSpan={3} className="px-3 py-2 text-[11px] font-bold text-slate-600">{group.title}</td>
                </tr>
                {group.keys.map((key) => {
                  const row = (view.events || {})[key] || {};
                  const cur = draft[key] || { inapp: true, email: true };
                  return (
                    <tr key={key} className="border-t border-slate-100" data-testid={`tenant-notify-event-${key}`}>
                      <td className="px-3 py-2.5 font-semibold text-slate-800">{labels[key] || key}</td>
                      <td className="px-2 py-2.5 text-center">
                        <ChannelCell
                          eventKey={key}
                          field="inapp"
                          channel={row.inapp}
                          checked={cur.inapp}
                          canEdit={canEdit}
                          onChange={(value) => setField(key, "inapp", value)}
                        />
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <ChannelCell
                          eventKey={key}
                          field="email"
                          channel={row.email}
                          checked={cur.email}
                          canEdit={canEdit}
                          onChange={(value) => setField(key, "email", value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
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

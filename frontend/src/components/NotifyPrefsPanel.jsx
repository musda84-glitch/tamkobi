import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Bell, Loader2, Save } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const EVENT_ORDER = [
  "einvoice_incoming",
  "order_new",
  "gib_credits_low",
  "receivable_overdue",
  "morning_summary",
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
const PLATFORM_ONLY_EVENTS = new Set([
  "bank_sync",
  "cash_approval",
  "pos_approval",
  "pos_daily_summary",
  "morning_summary",
  "order_pick_production",
  "attendance_alert",
  "leave_request",
  "advance_request",
  "overtime_request",
]);
const ORDER_BATCH_MINUTES = [0, 5, 10, 15, 30, 60];
const cred = { withCredentials: true };

function orderBatchMinutes(events) {
  const raw = Number((events?.order_new || {}).batch_minutes);
  return ORDER_BATCH_MINUTES.includes(raw) ? raw : 10;
}

function quietHours(events) {
  const raw = (events?.order_new || {}).quiet_hours || {};
  return {
    enabled: !!raw.enabled,
    start: raw.start || "22:00",
    end: raw.end || "08:00",
  };
}

function mailLogUrl(companyId) {
  return `${API_URL}/saas/companies/${companyId}/notify-mail-log`;
}

const MAIL_STATUS_TR = {
  sent: "Gönderildi",
  deferred: "Ertelendi",
  failed: "Hata",
  skipped: "Atlandı",
};

const FALLBACK_LABELS = {
  einvoice_incoming: "Gelen e-Fatura",
  order_new: "Yeni sipariş",
  gib_credits_low: "GİB kontör düşük",
  receivable_overdue: "Vadesi geçmiş alacak",
  morning_summary: "Sabah özeti",
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

function eventChannel(events, key) {
  if (events && events[key]) return events[key];
  if (PLATFORM_ONLY_EVENTS.has(key)) {
    return { inapp: true, email: false, sms: false, digest: "instant" };
  }
  return { inapp: true, email: true, sms: false, digest: "instant" };
}

function prefsUrl(mode, companyId) {
  if (mode === "platform") return `${API_URL}/saas/companies/${companyId}/notify-prefs`;
  return `${API_URL}/notify/prefs`;
}

/**
 * Olay bildirim tercihleri.
 * mode="platform": YNT firma detayı → GET/PUT /saas/companies/:id/notify-prefs
 * mode="company" (varsayılan): eski uç noktalar (salt okuma; kayıt süper admin ister).
 */
export function NotifyPrefsPanel({ companyId, mode = "company" }) {
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mailLog, setMailLog] = useState({ sent: [], deferred: [] });
  const isPlatform = mode === "platform";
  const url = prefsUrl(mode, companyId);

  useEffect(() => {
    if (!companyId) return;
    const req = isPlatform
      ? axios.get(url, cred)
      : axios.get(url, { params: { company_id: companyId } });
    req.then((r) => setPrefs(r.data)).catch(() => toast.error("Bildirim tercihleri yüklenemedi."));
    if (isPlatform) {
      axios
        .get(mailLogUrl(companyId), { params: { limit: 50 }, ...cred })
        .then((r) => setMailLog({ sent: r.data?.sent || [], deferred: r.data?.deferred || [] }))
        .catch(() => setMailLog({ sent: [], deferred: [] }));
    }
  }, [companyId, isPlatform, url]);

  if (!prefs) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 text-xs text-slate-500 flex items-center gap-2" data-testid="notify-prefs-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor…
      </div>
    );
  }

  const labels = prefs.event_labels || FALLBACK_LABELS;
  const events = prefs.events || {};
  const usage = prefs.email_usage || {};

  const setEvent = (key, field, value) => {
    setPrefs({
      ...prefs,
      events: {
        ...events,
        [key]: { ...(events[key] || {}), [field]: value },
      },
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const events = {
        ...(prefs.events || {}),
        order_new: {
          ...((prefs.events || {}).order_new || {}),
          batch_minutes: orderBatchMinutes(prefs.events),
          ...(isPlatform ? { quiet_hours: quietHours(prefs.events) } : {}),
        },
      };
      const extra = String(prefs.extra_emails_text ?? (prefs.extra_emails || []).join(", "))
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const body = {
        events,
        extra_emails: extra,
        email_from: prefs.email_from || "platform",
        gib_credits_threshold: Number(prefs.gib_credits_threshold) || 20,
      };
      if (isPlatform) {
        const raw = prefs.daily_email_cap;
        body.daily_email_cap = raw === "" || raw == null ? null : Number(raw);
      } else {
        body.company_id = companyId;
      }
      const r = isPlatform ? await axios.put(url, body, cred) : await axios.put(url, body);
      setPrefs({ ...r.data, extra_emails_text: (r.data.extra_emails || []).join(", ") });
      toast.success("Bildirim tercihleri kaydedildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const extraText = prefs.extra_emails_text ?? (prefs.extra_emails || []).join(", ");
  const platCap = prefs.notify_daily_email_cap_default;
  const capPlaceholder = platCap == null || platCap === "" ? "Platform varsayılanı (sınırsız)" : `Platform varsayılanı (${platCap})`;

  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 text-xs" data-testid="notify-prefs-panel">
      <div className="flex items-start gap-2">
        <Bell className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-slate-900">Olay bildirimleri</div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Gelen e-fatura, sipariş, kontör, vadesi geçmiş alacak, banka, kasa, POS, üretime gönderim, mesai, izin, avans ve fazla mesai için uygulama içi, e-posta ve isteğe bağlı SMS.
            {isPlatform ? " Bu ayarlar Platform Yönetimi’nden kaydedilir." : ""}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-left" data-testid="notify-prefs-table">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Olay</th>
              <th className="px-2 py-2 font-semibold text-center">Uygulama</th>
              <th className="px-2 py-2 font-semibold text-center">E-posta</th>
              <th className="px-2 py-2 font-semibold text-center">SMS</th>
              <th className="px-3 py-2 font-semibold">Özet</th>
            </tr>
          </thead>
          <tbody>
            {EVENT_ORDER.map((key) => {
              const ch = eventChannel(events, key);
              return (
                <tr key={key} className="border-t border-slate-100" data-testid={`notify-event-${key}`}>
                  <td className="px-3 py-2.5 font-semibold text-slate-800">{labels[key] || FALLBACK_LABELS[key] || key}</td>
                  <td className="px-2 py-2.5 text-center">
                    <input type="checkbox" checked={!!ch.inapp} onChange={(e) => setEvent(key, "inapp", e.target.checked)} data-testid={`notify-${key}-inapp`} />
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <input type="checkbox" checked={!!ch.email} onChange={(e) => setEvent(key, "email", e.target.checked)} data-testid={`notify-${key}-email`} />
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <input type="checkbox" checked={!!ch.sms} onChange={(e) => setEvent(key, "sms", e.target.checked)} data-testid={`notify-${key}-sms`} />
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={ch.digest || "instant"}
                      onChange={(e) => setEvent(key, "digest", e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1"
                      data-testid={`notify-${key}-digest`}
                    >
                      <option value="instant">Anında</option>
                      {key === "order_new" && <option value="batch">Grupla</option>}
                      <option value="hourly">Saatlik özet</option>
                      <option value="daily">Günlük özet</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <label className="block font-semibold text-slate-700 mb-1">Gruplama süresi</label>
        <select
          value={String(orderBatchMinutes(events))}
          onChange={(e) => setEvent("order_new", "batch_minutes", Number(e.target.value))}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1"
          data-testid="notify-order-batch-minutes"
        >
          <option value="0">Hemen</option>
          <option value="5">5 dk</option>
          <option value="10">10 dk</option>
          <option value="15">15 dk</option>
          <option value="30">30 dk</option>
          <option value="60">60 dk</option>
        </select>
        <p className="text-[10px] text-slate-500 mt-1" data-testid="notify-order-batch-note">
          Uygulama içi bildirim ve push her zaman anında gelir
        </p>
      </div>

      {isPlatform ? (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2" data-testid="notify-quiet-hours">
          <label className="flex items-center gap-2 font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={quietHours(events).enabled}
              onChange={(e) => setEvent("order_new", "quiet_hours", { ...quietHours(events), enabled: e.target.checked })}
              data-testid="notify-quiet-hours-enabled"
            />
            Sessiz saatler
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Başlangıç</label>
              <input
                type="time"
                value={quietHours(events).start}
                onChange={(e) => setEvent("order_new", "quiet_hours", { ...quietHours(events), start: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                data-testid="notify-quiet-hours-start"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Bitiş</label>
              <input
                type="time"
                value={quietHours(events).end}
                onChange={(e) => setEvent("order_new", "quiet_hours", { ...quietHours(events), end: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                data-testid="notify-quiet-hours-end"
              />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Bu saatlerde (Europe/Istanbul) e-posta ve SMS aralık sonuna ertelenir; uygulama içi bildirim ve push gider.</p>
        </div>
      ) : null}

      {isPlatform ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="notify-email-cap-block">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Günlük e-posta limiti</label>
            <input
              type="number"
              min={0}
              value={prefs.daily_email_cap ?? ""}
              onChange={(e) => setPrefs({ ...prefs, daily_email_cap: e.target.value === "" ? "" : Number(e.target.value) })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
              placeholder={capPlaceholder}
              data-testid="notify-daily-email-cap"
            />
            <p className="text-[10px] text-slate-500 mt-1">Boş = platform varsayılanı. Limit dolunca e-posta ertesi güne ertelenir; uygulama içi bildirim gider.</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-1" data-testid="notify-email-usage">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Gönderim</div>
            <div data-testid="notify-sent-24h">Son 24 saat: {usage.sent_24h ?? 0} gönderilen · {usage.deferred_24h ?? 0} ertelenen</div>
            <div data-testid="notify-sent-30d">Son 30 gün: {usage.sent_30d ?? 0} gönderilen · {usage.deferred_30d ?? 0} ertelenen</div>
            <div data-testid="notify-deferred">Kuyrukta ertelenen: {usage.deferred ?? 0}</div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Ek e-posta alıcıları</label>
          <input
            value={extraText}
            onChange={(e) => setPrefs({ ...prefs, extra_emails_text: e.target.value })}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
            placeholder="muhasebe@firma.com, yonetici@firma.com"
            data-testid="notify-extra-emails"
          />
          <p className="text-[10px] text-slate-500 mt-1">Virgülle ayırın. Rol sahiplerine ek olarak gönderilir.</p>
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Gönderen</label>
          <select
            value={prefs.email_from || "platform"}
            onChange={(e) => setPrefs({ ...prefs, email_from: e.target.value })}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
            data-testid="notify-email-from"
          >
            <option value="platform">Platform SMTP (önerilen)</option>
            <option value="company">Firma e-posta hesabı</option>
          </select>
          <label className="block font-semibold text-slate-700 mb-1 mt-3">Kontör uyarı eşiği</label>
          <input
            type="number"
            min={1}
            value={prefs.gib_credits_threshold ?? 20}
            onChange={(e) => setPrefs({ ...prefs, gib_credits_threshold: Number(e.target.value) })}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
            data-testid="notify-gib-threshold"
          />
        </div>
      </div>

      {isPlatform ? (
        <div className="space-y-3" data-testid="notify-mail-log">
          <div>
            <div className="text-sm font-bold text-slate-900 mb-1">Son gönderimler</div>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left" data-testid="notify-mail-log-sent">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Tarih</th>
                    <th className="px-3 py-2 font-semibold">Alıcılar</th>
                    <th className="px-3 py-2 font-semibold">Konu</th>
                    <th className="px-3 py-2 font-semibold">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {(mailLog.sent || []).length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-3 text-slate-400">Kayıt yok</td></tr>
                  ) : (mailLog.sent || []).map((row) => (
                    <tr key={row.id || row.created_at} className="border-t border-slate-100" data-testid="notify-mail-log-sent-row">
                      <td className="px-3 py-2 whitespace-nowrap">{row.date_tr || "—"}</td>
                      <td className="px-3 py-2">{row.recipients || (row.to || []).join(", ") || "—"}</td>
                      <td className="px-3 py-2">{row.subject || "—"}</td>
                      <td className="px-3 py-2">{MAIL_STATUS_TR[row.status] || row.status || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Ertelenen</div>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left" data-testid="notify-mail-log-deferred">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Tarih</th>
                    <th className="px-3 py-2 font-semibold">Konu</th>
                    <th className="px-3 py-2 font-semibold">Sonraki deneme</th>
                    <th className="px-3 py-2 font-semibold">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {(mailLog.deferred || []).length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-3 text-slate-400">Ertelenen yok</td></tr>
                  ) : (mailLog.deferred || []).map((row) => (
                    <tr key={row.id || row.next_try_at} className="border-t border-slate-100" data-testid="notify-mail-log-deferred-row">
                      <td className="px-3 py-2 whitespace-nowrap">{row.date_tr || "—"}</td>
                      <td className="px-3 py-2">{row.subject || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.next_try_at_tr || "—"}</td>
                      <td className="px-3 py-2">{MAIL_STATUS_TR[row.status] || row.status || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-60" data-testid="notify-prefs-save">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet
        </button>
      </div>
    </form>
  );
}

export default NotifyPrefsPanel;

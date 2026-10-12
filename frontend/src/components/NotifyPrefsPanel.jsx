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

/**
 * Firma Ayarları → Bildirimler: olay kanalları (uygulama / e-posta / SMS / özet).
 */
export function NotifyPrefsPanel({ companyId }) {
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    axios
      .get(`${API_URL}/notify/prefs`, { params: { company_id: companyId } })
      .then((r) => setPrefs(r.data))
      .catch(() => toast.error("Bildirim tercihleri yüklenemedi."));
  }, [companyId]);

  if (!prefs) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 text-xs text-slate-500 flex items-center gap-2" data-testid="notify-prefs-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor…
      </div>
    );
  }

  const labels = prefs.event_labels || FALLBACK_LABELS;
  const events = prefs.events || {};

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
      const r = await axios.put(`${API_URL}/notify/prefs`, {
        company_id: companyId,
        events: prefs.events,
        extra_emails: String(prefs.extra_emails_text ?? (prefs.extra_emails || []).join(", "))
          .split(/[,;\s]+/)
          .map((x) => x.trim())
          .filter(Boolean),
        email_from: prefs.email_from || "platform",
        gib_credits_threshold: Number(prefs.gib_credits_threshold) || 20,
      });
      setPrefs({ ...r.data, extra_emails_text: (r.data.extra_emails || []).join(", ") });
      toast.success("Bildirim tercihleri kaydedildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const extraText = prefs.extra_emails_text ?? (prefs.extra_emails || []).join(", ");

  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 text-xs" data-testid="notify-prefs-panel">
      <div className="flex items-start gap-2">
        <Bell className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-slate-900">Olay bildirimleri</div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Gelen e-fatura, yeni sipariş, kontör ve vadesi geçmiş alacaklar için uygulama içi, e-posta ve isteğe bağlı SMS.
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
              const ch = events[key] || { inapp: true, email: true, sms: false, digest: "instant" };
              return (
                <tr key={key} className="border-t border-slate-100" data-testid={`notify-event-${key}`}>
                  <td className="px-3 py-2.5 font-semibold text-slate-800">{labels[key] || key}</td>
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

      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-60" data-testid="notify-prefs-save">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet
        </button>
      </div>
    </form>
  );
}

export default NotifyPrefsPanel;

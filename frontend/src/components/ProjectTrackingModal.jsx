
import React, { useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, Send, Mail, MessageSquare, Phone, Copy, Loader2, Eye, Link2, Clock } from "lucide-react";
import { API_URL } from "../context/AuthContext";

/** Proje kartında takip linki / görüntülenme durumu */
export const TrackingBadge = ({ project }) => {
  const t = project?.tracking;
  if (!t?.token) return null;
  const views = t.view_count || 0;
  const sent = t.sent_count || 0;
  const label = sent
    ? (views ? `Takip • ${views} görüntüleme` : "Takip linki gönderildi")
    : "Takip linki hazır";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700"
      title={t.last_viewed_at ? `Son: ${new Date(t.last_viewed_at).toLocaleString("tr-TR")}` : ""}
      data-testid={`tracking-badge-${project.project_number}`}
    >
      <Clock className="w-3 h-3" /> {label}
    </span>
  );
};

export const ProjectTrackingModal = ({ project, contact, onClose, onSent }) => {
  useEscape(onClose);
  const [channels, setChannels] = useState({ sms: !!contact?.phone, email: !!contact?.email, whatsapp: !!contact?.phone });
  const [phone, setPhone] = useState(contact?.phone || "");
  const [email, setEmail] = useState(contact?.email || "");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  const absoluteLink = (l) => {
    if (!l) return "";
    if (/^https?:/i.test(l)) return l;
    return `${window.location.origin}${l.startsWith("/") ? l : `/${l}`}`;
  };
  const link = absoluteLink(
    res?.link || project.tracking?.link || (project.tracking?.token ? `/proje/${project.tracking.token}` : "")
  );

  const send = async (list) => {
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/projects/${project.id}/send-tracking`, {
        channels: list,
        phone,
        email,
        base_url: window.location.origin,
      });
      setRes(r.data);
      toast[r.data.status === "success" ? "success" : "error"](r.data.message);
      onSent?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gönderilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (l) => {
    try {
      await navigator.clipboard.writeText(l);
      toast.success("Link kopyalandı.");
    } catch {
      toast.error("Kopyalanamadı.");
    }
  };

  const Ch = ({ k, icon: Icon, label, sub, ok }) => (
    <label
      className={`flex items-start gap-2 border-2 rounded-xl p-2.5 cursor-pointer transition ${
        channels[k] ? "border-emerald-600 bg-emerald-50" : "border-slate-200"
      } ${!ok ? "opacity-60" : ""}`}
    >
      <input
        type="checkbox"
        checked={channels[k]}
        onChange={(e) => setChannels({ ...channels, [k]: e.target.checked })}
        className="mt-0.5 rounded"
        data-testid={`track-ch-${k}`}
      />
      <span>
        <span className="flex items-center gap-1 font-bold text-slate-900">
          <Icon className="w-3.5 h-3.5" /> {label}
        </span>
        <span className="block text-[10px] text-slate-500">{sub}</span>
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-4 sm:p-5 space-y-4 text-xs shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="project-tracking-modal"
      >
        <div className="flex justify-between items-start border-b pb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-emerald-600" /> Durum Takibi — {project.project_number}
            </h3>
            <p className="text-slate-500">
              {project.contact_name || "Müşteri"} • Giriş gerektirmeyen salt görüntüleme. SMS, WhatsApp veya e-posta ile gönderin.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400" data-testid="track-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Ch k="sms" icon={MessageSquare} label="SMS" sub="Netgsm ile" ok={!!phone} />
          <Ch k="email" icon={Mail} label="E-posta" sub="Mail hesabı gerekir" ok={!!email} />
          <Ch k="whatsapp" icon={Phone} label="WhatsApp" sub="Cloud API / wa.me" ok={!!phone} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block font-semibold mb-1">Telefon</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="05XX…"
              className="w-full bg-slate-50 border rounded-lg p-2 font-mono"
              data-testid="track-phone"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">E-posta</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="musteri@firma.com"
              className="w-full bg-slate-50 border rounded-lg p-2"
              data-testid="track-email"
            />
          </div>
        </div>

        {(res || link) && (
          <div className="bg-slate-50 border rounded-xl p-3 space-y-2" data-testid="track-result">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-700 shrink-0">Takip linki:</span>
              <a href={link} target="_blank" rel="noreferrer" className="text-emerald-700 underline truncate flex-1 min-w-0 font-mono" data-testid="track-link">
                {link}
              </a>
              <button onClick={() => copy(link)} className="p-1 border rounded-md bg-white" title="Kopyala" data-testid="track-copy">
                <Copy className="w-3.5 h-3.5" />
              </button>
              <a href={link} target="_blank" rel="noreferrer" className="p-1 border rounded-md bg-white" title="Önizle" data-testid="track-preview">
                <Eye className="w-3.5 h-3.5" />
              </a>
            </div>
            {res?.results &&
              Object.entries(res.results).map(([k, v]) => {
                const st =
                  v.status === "sent"
                    ? "bg-emerald-50 text-emerald-700"
                    : v.status === "simulated"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-rose-50 text-rose-700";
                const label = v.status === "sent" ? "Gönderildi" : v.status === "simulated" ? "SİMÜLE" : "Hata";
                const wa = v.wa_link;
                return (
                  <div key={k} className="flex items-center gap-2 flex-wrap">
                    <span className="w-16 font-bold uppercase text-slate-500">{k}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${st}`}>{label}</span>
                    <span className="text-slate-500 truncate flex-1">{v.detail}</span>
                    {wa && (
                      <a href={wa} target="_blank" rel="noreferrer" className="text-green-700 font-semibold underline">
                        WhatsApp'ta aç
                      </a>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t pt-2">
          <button onClick={onClose} className="px-3 py-1.5 border rounded-lg">
            Kapat
          </button>
          <button onClick={() => send([])} disabled={busy} className="px-3 py-1.5 border rounded-lg font-semibold" data-testid="track-mint">
            Sadece link üret
          </button>
          <button
            onClick={() => {
              const list = Object.keys(channels).filter((k) => channels[k]);
              if (!list.length) {
                toast.error("En az bir kanal seçin ya da yalnız link üretin.");
                return;
              }
              send(list);
            }}
            disabled={busy}
            className="flex items-center gap-1 px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50"
            data-testid="track-send"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {(project.tracking?.sent_count || 0) > 0 ? "Tekrar Gönder" : "Gönder"}
          </button>
        </div>
      </div>
    </div>
  );
};

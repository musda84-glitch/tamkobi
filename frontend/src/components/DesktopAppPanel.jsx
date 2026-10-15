import React, { useEffect, useState } from "react";
import { Download, Monitor } from "lucide-react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";

const UNAVAILABLE = "Masaüstü uygulaması hazırlanıyor, yakında buradan indirebileceksiniz";

function safeDownloadUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href;
  } catch {
    /* ignore */
  }
  return "";
}

export function formatDesktopPublished(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** Firma Ayarları — Windows kiosk kabuğu (Atölye / Depo / Hızlı Satış). */
export function DesktopAppPanel() {
  const [info, setInfo] = useState(null);
  const [phase, setPhase] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_URL}/desktop/latest`)
      .then((res) => {
        if (!cancelled) {
          setInfo(res.data || null);
          setPhase("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInfo(null);
          setPhase("error");
        }
      });
    return () => { cancelled = true; };
  }, []);

  const downloadUrl = safeDownloadUrl(info?.download_url);
  const version = String(info?.version || "").replace(/^v/i, "").trim();
  const available = phase === "ready" && info?.available === true && !!version && !!downloadUrl;
  const published = available ? formatDesktopPublished(info?.published_at) : "";
  const notes = available ? String(info?.notes || "").trim() : "";
  const showUnavailable = phase !== "loading" && !available;
  const DownloadControl = available ? "a" : "button";
  const downloadProps = available
    ? { href: downloadUrl }
    : { type: "button", disabled: true };

  return (
    <div className="space-y-4 max-w-2xl" data-testid="desktop-app-panel">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <Monitor className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Masaüstü Uygulaması</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed" data-testid="desktop-app-description">
              Atölye ve panel ekranlarını bilgisayarınızda kiosk modunda çalıştırın.
            </p>
          </div>
        </div>

        {phase === "loading" ? (
          <p className="text-xs text-slate-400" data-testid="desktop-app-loading">Yükleniyor…</p>
        ) : null}

        {showUnavailable ? (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-testid="desktop-unavailable">
            {UNAVAILABLE}
          </p>
        ) : null}

        <DownloadControl
          {...downloadProps}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold ${available ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed"}`}
          data-testid="desktop-download"
        >
          <Download className="w-4 h-4" />
          {available ? `Windows için indir (v${version})` : "Windows için indir"}
        </DownloadControl>

        {published ? (
          <p className="text-xs text-slate-500" data-testid="desktop-published-at">
            Yayın tarihi: {published}
          </p>
        ) : null}
        {notes ? (
          <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 whitespace-pre-wrap" data-testid="desktop-notes">
            <div className="font-semibold text-slate-900 mb-1">Sürüm notu</div>
            {notes}
          </div>
        ) : null}
      </div>
    </div>
  );
}

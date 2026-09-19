import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../api/client";
import { compareStamps, frontendStamp, stampLabel, stampTitle, updateCard } from "../utils/buildStamp";

const POLL_MS = 45000;

const TONE = {
  dark: {
    ok: "text-slate-500",
    warn: "text-amber-300",
    card: "border-slate-700/80 bg-slate-900/70",
    label: "text-slate-500",
    sha: "text-slate-200",
    msg: "text-slate-300",
    meta: "text-slate-500",
  },
  light: {
    ok: "text-slate-400",
    warn: "text-amber-700",
    card: "border-slate-200 bg-slate-50",
    label: "text-slate-400",
    sha: "text-slate-800",
    msg: "text-slate-600",
    meta: "text-slate-400",
  },
  system: {
    ok: "text-slate-500",
    warn: "text-amber-300",
    card: "border-white/10 bg-white/[0.04]",
    label: "text-slate-500",
    sha: "text-slate-200",
    msg: "text-slate-300",
    meta: "text-slate-500",
  },
};

function fetchVersion(onResult) {
  return axios.get(`${API_URL}/version`).then((r) => {
    onResult(r.data);
  }).catch(() => {
    onResult({ git_sha: null, source: "unknown" });
  });
}

export function BuildStamp({ tone = "dark", layout = "compact" }) {
  const ui = frontendStamp();
  const [api, setApi] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      fetchVersion((data) => {
        if (live) setApi(data);
      });
    };
    load();
    const id = setInterval(load, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  const stamp = api || {};
  const cmp = compareStamps(ui, stamp);
  const colors = TONE[tone] || TONE.dark;
  const warn = cmp.reason === "mismatch" || cmp.reason === "missing" || cmp.reason === "partial";
  if (layout === "sidebar") {
    const card = updateCard(ui, stamp);
    return (
      <div
        className={`rounded-lg border px-2.5 py-2 space-y-1 ${colors.card}`}
        title={stampTitle(ui, stamp)}
        data-testid="build-stamp"
        data-layout="sidebar"
      >
        <div className={`text-[9px] font-bold uppercase tracking-[0.14em] ${colors.label}`}>
          Sürüm
        </div>
        {api === null ? (
          <div className={`text-[11px] font-mono ${colors.ok}`}>…</div>
        ) : (
          <>
            <div className={`text-[13px] font-bold leading-tight ${warn ? colors.warn : colors.sha}`} data-testid="build-stamp-version">
              {card.version}
            </div>
            <div className={`font-mono text-[10px] leading-tight ${colors.meta}`} data-testid="build-stamp-sha">
              {card.sha || "—"}
              {card.builtAt ? ` · ${card.builtAt}` : card.branch ? ` · ${card.branch}` : ""}
            </div>
            <div className={`text-[10px] leading-snug ${warn ? colors.warn : colors.ok}`} data-testid="build-stamp-status">
              {card.statusText}
            </div>
            {cmp.reason === "mismatch" ? (
              <button
                type="button"
                className="text-[10px] font-semibold text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline"
                onClick={() => window.location.reload()}
                data-testid="build-stamp-reload"
              >
                Sayfayı yenile
              </button>
            ) : null}
          </>
        )}
      </div>
    );
  }
  return (
    <div
      className={`px-0.5 pt-1 text-[10px] font-mono leading-tight truncate ${warn ? colors.warn : colors.ok}`}
      title={stampTitle(ui, stamp)}
      data-testid="build-stamp"
      data-layout="compact"
    >
      {api === null ? "…" : stampLabel(ui, api)}
    </div>
  );
}

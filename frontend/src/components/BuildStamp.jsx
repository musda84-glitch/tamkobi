import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../api/client";
import { compareStamps, frontendStamp, stampLabel, stampTitle } from "../utils/buildStamp";

const TONE = {
  dark: {
    ok: "text-slate-500",
    warn: "text-amber-300",
  },
  light: {
    ok: "text-slate-400",
    warn: "text-amber-700",
  },
  system: {
    ok: "text-slate-500",
    warn: "text-amber-300",
  },
};

export function BuildStamp({ tone = "dark" }) {
  const ui = frontendStamp();
  const [api, setApi] = useState(null);
  useEffect(() => {
    let live = true;
    axios.get(`${API_URL}/version`).then((r) => {
      if (live) setApi(r.data);
    }).catch(() => {
      if (live) setApi({ git_sha: null, source: "unknown" });
    });
    return () => { live = false; };
  }, []);
  const cmp = compareStamps(ui, api || {});
  const colors = TONE[tone] || TONE.dark;
  const warn = cmp.reason === "mismatch" || cmp.reason === "missing" || cmp.reason === "partial";
  return (
    <div
      className={`px-0.5 pt-1 text-[10px] font-mono leading-tight truncate ${warn ? colors.warn : colors.ok}`}
      title={stampTitle(ui, api || {})}
      data-testid="build-stamp"
    >
      {api === null ? "…" : stampLabel(ui, api)}
    </div>
  );
}


import React, { useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { locationConsentAccepted, normalizeLocationConsent, validateLocationConsent } from "../utils/locationConsent";
import { LocationSignal } from "./LocationSignal";

export function LocationConsentCard({
  consent,
  signal,
  onAccept,
  busy = false,
  compact = false,
  testId = "loc-consent",
}) {
  const view = normalizeLocationConsent(consent);
  const accepted = locationConsentAccepted(view);
  const [kvkk, setKvkk] = useState(Boolean(view.accept_kvkk));
  const [share, setShare] = useState(Boolean(view.accept_share));
  const [err, setErr] = useState("");

  if (accepted) {
    return (
      <div
        className={`flex flex-wrap items-center gap-2 ${compact ? "text-[11px] text-slate-500" : "rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"}`}
        data-testid={`${testId}-ok`}
      >
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="font-semibold">K / KK sözleşmeleri kabul edildi</span>
        {view.accepted_at ? <span className="text-[10px] opacity-80">· {String(view.accepted_at).slice(0, 16).replace("T", " ")}</span> : null}
        <LocationSignal signal={signal} testId={`${testId}-signal`} />
      </div>
    );
  }

  const submit = async (e) => {
    e?.preventDefault?.();
    const invalid = validateLocationConsent({ accept_kvkk: kvkk, accept_share: share });
    if (invalid) { setErr(invalid); return; }
    setErr("");
    await onAccept?.({ accept_kvkk: true, accept_share: true });
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3" data-testid={testId}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-bold text-slate-900">Konum paylaşımı sözleşmeleri</div>
          <p className="text-[11px] text-amber-900 font-semibold mt-0.5" data-testid={`${testId}-warning`}>{view.warning}</p>
        </div>
      </div>
      <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
        <input
          type="checkbox"
          checked={kvkk}
          onChange={(e) => setKvkk(e.target.checked)}
          className="mt-0.5 rounded border-slate-300"
          data-testid={`${testId}-kvkk`}
        />
        <span>
          <span className="font-bold text-slate-900">{view.kvkk_title}</span>
          <span className="block text-[11px] text-slate-600 mt-0.5">{view.kvkk_text}</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
        <input
          type="checkbox"
          checked={share}
          onChange={(e) => setShare(e.target.checked)}
          className="mt-0.5 rounded border-slate-300"
          data-testid={`${testId}-kk`}
        />
        <span>
          <span className="font-bold text-slate-900">{view.share_title}</span>
          <span className="block text-[11px] text-slate-600 mt-0.5">{view.share_text}</span>
        </span>
      </label>
      {err ? <div className="text-[11px] text-rose-700 font-semibold" data-testid={`${testId}-error`}>{err}</div> : null}
      <button
        type="submit"
        disabled={busy || !kvkk || !share}
        className="w-full sm:w-auto px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
        data-testid={`${testId}-accept`}
      >
        {busy ? "Kaydediliyor…" : "Kabul et ve paneli aç"}
      </button>
    </form>
  );
}

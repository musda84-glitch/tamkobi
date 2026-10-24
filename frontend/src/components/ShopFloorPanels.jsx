import React, { useState } from "react";
import { CheckCircle2, Image as ImageIcon, Undo2 } from "lucide-react";
import ShopfloorPinPad from "./ShopfloorPinPad";
import { formatShopfloorClock, partialForecast, shopfloorInitials, takeoverTitle } from "../utils/shopFloorScreen";
import { formatTrQty } from "../utils/money";

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"];

export function ShopFloorNumpad({ value, onChange, onAccept, testId = "shopfloor-numpad" }) {
  const push = (key) => {
    if (key === "⌫") {
      onChange(String(value || "").slice(0, -1));
      return;
    }
    if (key === "✓") {
      onAccept?.();
      return;
    }
    const next = `${value || ""}${key}`.replace(/^0+(?=\d)/, "");
    if (next.length > 6) return;
    onChange(next);
  };
  return (
    <div className="grid grid-cols-3 gap-2.5" data-testid={testId}>
      {PAD.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => push(key)}
          className="flex h-[60px] items-center justify-center rounded-2xl border-2 border-slate-200 bg-slate-100 text-2xl font-extrabold text-slate-900"
          data-testid={`${testId}-${key === "⌫" ? "back" : key === "✓" ? "ok" : key}`}
        >
          {key}
        </button>
      ))}
    </div>
  );
}

export function PartialCountDialog({ job, unit = "Adet", onClose, onSubmit, busy }) {
  const [raw, setRaw] = useState("");
  const current = Number(job?.partial_qty_total) || 0;
  const plan = Number(job?.planned_quantity) || 0;
  const add = Number(raw) || 0;
  const forecast = partialForecast(current, add, plan);
  const pct = plan > 0 ? Math.min(100, Math.round((current / plan) * 100)) : 0;
  const disabled = busy || add <= 0 || forecast.over;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/55 p-4" data-testid="shopfloor-partial-dialog">
      <div className="flex w-full max-w-[520px] flex-col gap-3.5 rounded-[20px] bg-white p-6 shadow-2xl max-[700px]:p-[18px]">
        <h2 className="text-xl font-bold text-slate-900">Ara sayım · {job?.order_code} Adım {job?.step_no}/{job?.step_count}</h2>
        <div>
          <div className="mb-1.5 flex justify-between text-sm">
            <span>Şu ana kadar</span>
            <b>{formatTrQty(current)} / {formatTrQty(plan)} {unit}</b>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <i className="block h-full bg-amber-500" style={{ width: `${pct}%` }} />
          </div>
          <div className={`mt-1.5 text-[13px] font-bold ${forecast.over ? "text-rose-700" : "text-emerald-700"}`} data-testid="shopfloor-partial-forecast">
            {forecast.over
              ? "Plan aşılamaz"
              : `Eklenince: ${formatTrQty(forecast.next)} / ${formatTrQty(plan)} ${unit} · kalan ${formatTrQty(forecast.left)}`}
          </div>
        </div>
        <div className="rounded-2xl border-2 border-slate-300 px-4 py-2 text-right text-4xl font-black" data-testid="shopfloor-partial-display">{raw || "0"}</div>
        <ShopFloorNumpad value={raw} onChange={setRaw} onAccept={() => { if (!disabled) onSubmit(add); }} />
        <p className="text-xs text-slate-500">Sağlam adet eklenir. Plan aşılamaz; aynı giriş iki kez sayılmaz.</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="flex min-h-11 items-center justify-center rounded-xl border-2 border-slate-300 bg-white font-bold">Vazgeç</button>
          <button type="button" disabled={disabled} onClick={() => onSubmit(add)} className="flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" data-testid="shopfloor-partial-add">+{formatTrQty(add)} Ekle</button>
        </div>
      </div>
    </div>
  );
}

export function TakeoverDialog({ job, detail, onClose, onConfirm, busy }) {
  const name = String(detail?.previous_operator || job?.operator_name || "").trim();
  const when = formatShopfloorClock(detail?.last_action_at);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/55 p-4" data-testid="shopfloor-takeover-dialog">
      <div className="flex w-full max-w-[520px] flex-col gap-3.5 rounded-[20px] bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-2xl font-black text-orange-700">!</span>
          <h2 className="text-xl font-bold text-slate-900">{takeoverTitle(detail, job?.operator_name)}</h2>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-2.5 py-2 text-xs leading-relaxed text-slate-600">
          İş: <b className="text-slate-900">{job?.order_code} • Adım {job?.step_no}/{job?.step_count} · {job?.station || job?.step_name}</b><br />
          Önceki operatör: <b className="text-slate-900">{name || "—"}</b><br />
          Son işlem: <b className="text-slate-900">{when || "—"}</b>
        </div>
        <p className="text-xs text-slate-500">Devralırsanız iş sizin adınıza devam eder; devralma kaydı denetim günlüğüne yazılır.</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="flex min-h-11 items-center justify-center rounded-xl border-2 border-slate-300 bg-white font-bold">Vazgeç</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 font-bold text-white disabled:opacity-60" data-testid="shopfloor-takeover-confirm">Devral ve başla</button>
        </div>
      </div>
    </div>
  );
}

export function DrawingViewer({ title, filename, expiresIn, url, contentType, onClose }) {
  const [zoom, setZoom] = useState(1);
  const minutes = Math.max(1, Math.round(Number(expiresIn || 900) / 60));
  const image = !contentType || String(contentType).startsWith("image/") || String(contentType).includes("svg");
  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-slate-900" data-testid="shopfloor-drawing">
      <div className="flex flex-wrap items-center gap-2.5 bg-slate-950 px-4 py-3 text-white">
        <ImageIcon className="h-[18px] w-[18px]" />
        <b>Teknik çizim · {title}</b>
        <span className="text-[13px] text-slate-400">{filename || "çizim"} · bağlantı {minutes} dk geçerli</span>
        <span className="flex-1" />
        <button type="button" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border-2 border-slate-700 bg-slate-800 text-white" aria-label="Uzaklaş">−</button>
        <button type="button" onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border-2 border-slate-700 bg-slate-800 text-white" aria-label="Yakınlaş">+</button>
        <button type="button" onClick={onClose} className="min-h-11 rounded-xl border-2 border-slate-300 bg-white px-3.5 font-bold text-slate-900" data-testid="shopfloor-drawing-close">✕ Kapat</button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        {url ? (
          image ? (
            <img src={url} alt={filename || "Teknik çizim"} width={1280} height={1280} decoding="async" style={{ transform: `scale(${zoom})`, maxWidth: "100%", maxHeight: "100%" }} data-testid="shopfloor-drawing-image" />
          ) : (
            <iframe title={filename || "Teknik çizim"} src={url} className="h-full w-full bg-white" style={{ transform: `scale(${zoom})` }} data-testid="shopfloor-drawing-frame" />
          )
        ) : (
          <p className="text-sm text-slate-300">Çizim yükleniyor</p>
        )}
      </div>
    </div>
  );
}

export function UndoToast({ text, countdown, onUndo }) {
  return (
    <div className="fixed bottom-6 left-1/2 z-[150] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3.5 rounded-2xl bg-emerald-800 px-4 py-3 font-semibold text-white shadow-xl" data-testid="shopfloor-undo-toast">
      <CheckCircle2 className="h-[18px] w-[18px] shrink-0" />
      <span className="min-w-0">{text}</span>
      <button type="button" onClick={onUndo} className="inline-flex shrink-0 items-center gap-1 rounded-[10px] bg-white px-3.5 py-2 font-extrabold text-emerald-800" data-testid="shopfloor-undo-toast-action">
        <Undo2 className="h-3.5 w-3.5" /> Geri al ({countdown})
      </button>
    </div>
  );
}

export function IdleLock({ name, code, minutes, error, busy, onSubmit, onSwitch }) {
  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-900 p-4 text-white" data-testid="shopfloor-idle-lock">
      <div className="flex w-full max-w-[380px] flex-col gap-4 text-center">
        <div className="text-[22px] font-extrabold">Ekran kilitlendi</div>
        <div className="text-sm text-slate-400">{minutes} dakika işlem yapılmadı · {name}{code ? ` (${code})` : ""}</div>
        <div className="rounded-2xl bg-slate-900 p-2 text-left text-white [&_button]:border-slate-700 [&_button]:bg-slate-800 [&_button]:text-white [&_h3]:text-white [&_p]:text-slate-300">
          <ShopfloorPinPad operatorName={name} error={error} busy={busy} onSubmit={onSubmit} onCancel={onSwitch} />
        </div>
        <button type="button" onClick={onSwitch} className="text-sm font-semibold text-slate-300 underline" data-testid="shopfloor-idle-switch">Başka operatör</button>
      </div>
    </div>
  );
}

export function OperatorPicker({ operators, onPick }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" data-testid="shopfloor-no-operator">
      <h2 className="text-[28px] font-extrabold text-slate-900 sm:text-[32px]">Kim çalışıyor?</h2>
      <p className="mb-1 text-base text-slate-500">Adınıza dokunun, sonra şifrenizi girin.</p>
      <p className="mb-4 text-sm font-semibold text-amber-800">Operatör seçin. Başla / Devam / Bitir operatör PIN girişinden sonra açılır.</p>
      {operators.length === 0 ? (
        <p className="text-sm font-semibold text-amber-900" data-testid="shopfloor-operators-empty">PIN tanımlı ve mesaiye giriş yapmış operatör yok</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {operators.map((op) => (
            <button
              key={`${op.operator_type || "op"}-${op.id}`}
              type="button"
              onClick={() => onPick(op)}
              className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-3 py-4 text-center shadow-sm hover:border-blue-500"
              data-testid={`shopfloor-operator-card-${op.id}`}
            >
              <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-blue-100 text-2xl font-extrabold text-blue-700">{shopfloorInitials(op.name)}</span>
              <span className="text-lg font-bold text-slate-900">{op.name}</span>
              {op.station ? <span className="text-xs text-slate-500">{op.station}</span> : null}
              <span className="text-[11px] font-semibold text-emerald-700">PIN tanımlı</span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-4 text-[15px] text-slate-500">Birkaç dakika işlem yapılmazsa ekran kilitlenir</p>
    </div>
  );
}

export function FocusBoard({ mode, job, title, qtyLabel, passive, onBack, onStart, onFinish, onDrawing }) {
  const running = mode === "running";
  return (
    <div className="fixed inset-0 z-[140] overflow-y-auto overflow-x-hidden bg-slate-100" data-testid={running ? "shopfloor-running" : "shopfloor-next-job"}>
      <div className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
        <span className="text-lg font-bold text-slate-900">{running ? "Çalışıyor" : "Sıradaki iş"}</span>
        <button type="button" onClick={onBack} className="min-h-11 rounded-lg border border-slate-300 px-4 font-semibold" data-testid="shopfloor-focus-back">Listeye dön</button>
      </div>
      <div className="p-5 sm:p-6">
        <div className={`rounded-xl border-[3px] p-6 ${running ? "border-amber-500 bg-amber-50" : "border-blue-600 bg-blue-50"}`}>
          <div className="flex items-center justify-between gap-3">
            <span className={`rounded-full px-3 py-1 text-[13px] font-bold text-white ${running ? "bg-amber-500" : "bg-blue-600"}`}>{running ? "Çalışıyor" : "Hazır"}</span>
            <span className="text-sm text-slate-500">{job?.sales_order_no ? `Sipariş no: ${job.sales_order_no}` : job?.order_code}{job?.planned_date ? ` · Plan: ${job.planned_date}` : ""}</span>
          </div>
          <div className="mt-3.5 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[30px] font-extrabold leading-tight text-slate-900">{title}</div>
              <div className="mt-1.5 text-xl">Adım: <b>{job?.step_name || job?.station}</b></div>
            </div>
            <div className="text-right text-5xl font-extrabold leading-none sm:text-6xl">{qtyLabel}</div>
          </div>
        </div>
        <div className={`mt-4 grid gap-3.5 ${running ? "grid-cols-1 sm:grid-cols-[2fr_1fr]" : "grid-cols-1"}`}>
          {running ? (
            <>
              <button type="button" disabled={passive} onClick={onFinish} className="flex h-[100px] items-center justify-center rounded-xl bg-emerald-600 text-4xl font-extrabold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" data-testid="shopfloor-focus-finish">■ BİTİR</button>
              <div className="flex h-[100px] items-center justify-center rounded-xl border border-slate-300 bg-white text-2xl font-bold text-slate-400">Duraklat mola saatinde</div>
            </>
          ) : (
            <button type="button" disabled={passive} onClick={onStart} className="flex h-[100px] items-center justify-center rounded-xl bg-gradient-to-r from-emerald-600 to-sky-500 text-4xl font-extrabold text-white disabled:cursor-not-allowed disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400" data-testid="shopfloor-focus-start">▶ BAŞLAT</button>
          )}
        </div>
        <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <button type="button" onClick={onDrawing} className="flex min-h-14 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg font-semibold" data-testid="shopfloor-focus-drawing">Çizim / Resim</button>
        </div>
      </div>
    </div>
  );
}

export function FilterMenu({ open, projects, projectId, onPick, anchor = "project" }) {
  if (!open) return null;
  return (
    <div className={`absolute top-12 left-0 z-[120] w-[min(300px,100%)] rounded-[14px] border border-slate-200 bg-white p-1.5 shadow-2xl ${anchor === "recipe" ? "min-[701px]:left-36" : "min-[701px]:left-16"}`} data-testid="shopfloor-filter-menu">
      {projects.map((row) => {
        const active = String(row.id) === String(projectId);
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onPick(row.id)}
            className={`flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2.5 text-left text-sm font-semibold ${active ? "bg-slate-100" : ""}`}
            data-testid={`shopfloor-filter-option-${row.id}`}
          >
            <i className="h-3 w-3 shrink-0 rounded border" style={{ background: row.wash, borderColor: row.edge }} />
            <span className="min-w-0 flex-1">{row.label}</span>
            <small className="text-xs font-semibold text-slate-400">{row.count}{active ? " ✓" : ""}</small>
          </button>
        );
      })}
    </div>
  );
}

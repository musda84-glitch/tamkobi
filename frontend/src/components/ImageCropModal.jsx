import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, X, RotateCcw } from "lucide-react";
import { useEscape } from "../utils/useEscape";

const ASPECTS = [
  { key: "free", label: "Serbest", ratio: null },
  { key: "1:1", label: "1:1", ratio: 1 },
  { key: "4:3", label: "4:3", ratio: 4 / 3 },
  { key: "3:4", label: "Etiket", ratio: 3 / 4 },
];

/** Kaynak dosyadan kırpılabilir önizleme + canvas çıktısı. */
export const ImageCropModal = ({ file, onCancel, onConfirm, title = "Görseli Kırp" }) => {
  useEscape(onCancel);
  const imgRef = useRef(null);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const [src, setSrc] = useState("");
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState("1:1");
  const [crop, setCrop] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }); // normalized 0–1
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const ratio = useMemo(() => ASPECTS.find((a) => a.key === aspect)?.ratio ?? null, [aspect]);

  const applyAspect = useCallback((key, nat = natural) => {
    setAspect(key);
    const r = ASPECTS.find((a) => a.key === key)?.ratio;
    if (!nat.w || !nat.h) return;
    if (!r) {
      setCrop({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
      return;
    }
    const imgR = nat.w / nat.h;
    let w; let h;
    if (imgR > r) {
      h = 0.9;
      w = (h * r * nat.h) / nat.w;
    } else {
      w = 0.9;
      h = (w * nat.w) / (r * nat.h);
    }
    setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  }, [natural]);

  const onImgLoad = () => {
    const el = imgRef.current;
    if (!el) return;
    const nat = { w: el.naturalWidth, h: el.naturalHeight };
    setNatural(nat);
    applyAspect(aspect, nat);
  };

  const clampCrop = (next) => {
    let { x, y, w, h } = next;
    w = Math.min(1, Math.max(0.08, w));
    h = Math.min(1, Math.max(0.08, h));
    x = Math.min(1 - w, Math.max(0, x));
    y = Math.min(1 - h, Math.max(0, y));
    if (ratio && natural.w && natural.h) {
      // Keep aspect: adjust h from w in image pixel space
      const boxW = w * natural.w;
      const boxH = boxW / ratio;
      h = boxH / natural.h;
      if (h > 1) {
        h = 1;
        w = (h * natural.h * ratio) / natural.w;
      }
      y = Math.min(1 - h, Math.max(0, y));
      x = Math.min(1 - w, Math.max(0, x));
    }
    return { x, y, w, h };
  };

  const startDrag = (mode, e) => {
    e.preventDefault();
    e.stopPropagation();
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...crop },
      stageW: stage.width,
      stageH: stage.height,
    };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / d.stageW;
      const dy = (ev.clientY - d.startY) / d.stageH;
      const o = d.origin;
      if (d.mode === "move") {
        setCrop(clampCrop({ x: o.x + dx, y: o.y + dy, w: o.w, h: o.h }));
      } else if (d.mode === "se") {
        setCrop(clampCrop({ x: o.x, y: o.y, w: o.w + dx, h: o.h + dy }));
      } else if (d.mode === "nw") {
        setCrop(clampCrop({ x: o.x + dx, y: o.y + dy, w: o.w - dx, h: o.h - dy }));
      }
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const confirm = async () => {
    if (!imgRef.current || !natural.w) return;
    setBusy(true);
    try {
      const sx = Math.round(crop.x * natural.w);
      const sy = Math.round(crop.y * natural.h);
      const sw = Math.max(1, Math.round(crop.w * natural.w));
      const sh = Math.max(1, Math.round(crop.h * natural.h));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) {
        onCancel?.();
        return;
      }
      const base = (file?.name || "image").replace(/\.[^.]+$/, "");
      const out = new File([blob], `${base}-crop.png`, { type: "image/png", lastModified: Date.now() });
      await onConfirm(out, { width: sw, height: sh });
    } finally {
      setBusy(false);
    }
  };

  if (!file) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-slate-900/75 flex items-center justify-center p-4" data-testid="image-crop-modal">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700" data-testid="image-crop-cancel" aria-label="Kapat">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-3 space-y-3 overflow-y-auto">
          <div className="flex flex-wrap gap-1.5">
            {ASPECTS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => applyAspect(a.key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${aspect === a.key ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200 hover:border-emerald-400"}`}
                data-testid={`crop-aspect-${a.key}`}
              >
                {a.label}
              </button>
            ))}
            <button type="button" onClick={() => applyAspect(aspect)} className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-500 hover:text-slate-800" title="Sıfırla">
              <RotateCcw className="w-3.5 h-3.5" /> Sıfırla
            </button>
          </div>
          <div ref={stageRef} className="relative w-full bg-slate-900 rounded-xl overflow-hidden select-none touch-none" style={{ aspectRatio: natural.w && natural.h ? `${natural.w}/${natural.h}` : "1" }}>
            {src ? (
              <img ref={imgRef} src={src} alt="" className="block w-full h-full object-contain pointer-events-none" onLoad={onImgLoad} draggable={false} />
            ) : null}
            {natural.w > 0 && (
              <div
                className="absolute border-2 border-emerald-400 cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                onPointerDown={(e) => startDrag("move", e)}
                data-testid="crop-box"
              >
                <span className="absolute -left-1.5 -top-1.5 w-3 h-3 bg-emerald-400 rounded-sm cursor-nwse-resize" onPointerDown={(e) => startDrag("nw", e)} />
                <span className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-emerald-400 rounded-sm cursor-nwse-resize" onPointerDown={(e) => startDrag("se", e)} data-testid="crop-handle-se" />
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-500">Kırpma kutusunu sürükleyin. Onaydan sonra görsel WebP/JPEG olarak sıkıştırılıp kaydedilir.</p>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t bg-slate-50">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg text-xs font-semibold text-slate-600" data-testid="image-crop-cancel-btn">İptal</button>
          <button type="button" disabled={busy || !natural.w} onClick={confirm} className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50" data-testid="image-crop-confirm-btn">
            <Check className="w-3.5 h-3.5" /> {busy ? "Hazırlanıyor…" : "Kırp & Yükle"}
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, X, Loader2, FlipHorizontal, Zap } from "lucide-react";

const FORMATS = [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.ITF, Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.DATA_MATRIX];

const beep = () => { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = "square"; o.frequency.value = 1400; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 110); } catch { /* sessiz */ } };

/* Kamera ile barkod/QR okuyucu. continuous=true → okuduktan sonra kapanmaz, aynı kodu 1,5 sn içinde tekrar saymaz */
export const CameraScanner = ({ onScan, onClose, continuous = false, title = "Barkod Okut" }) => {
  const idRef = useRef(`cam-scan-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef(null);
  const lastRef = useRef({ code: "", at: 0 });
  const [status, setStatus] = useState("starting");
  const [error, setError] = useState("");
  const [cams, setCams] = useState([]);
  const [camIdx, setCamIdx] = useState(0);
  const [last, setLast] = useState(null);
  const [count, setCount] = useState(0);
  const [torch, setTorch] = useState(false);

  useEffect(() => {
    let alive = true;
    const start = async () => {
      try {
        const devices = await Html5Qrcode.getCameras();
        if (!alive) return;
        setCams(devices);
        const back = devices.findIndex((d) => /back|rear|arka|environment/i.test(d.label));
        const idx = camIdx || (back >= 0 ? back : Math.max(0, devices.length - 1));
        const scanner = new Html5Qrcode(idRef.current, { formatsToSupport: FORMATS, verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
        scannerRef.current = scanner;
        const cfg = { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * 0.85, 360), height: Math.min(h * 0.45, 180) }), aspectRatio: 1.333, disableFlip: false };
        const src = devices[idx]?.id ? { deviceId: { exact: devices[idx].id } } : { facingMode: "environment" };
        await scanner.start(src, cfg, (text) => {
          const now = Date.now();
          if (lastRef.current.code === text && now - lastRef.current.at < 1500) return;
          lastRef.current = { code: text, at: now };
          beep();
          if (navigator.vibrate) navigator.vibrate(60);
          setLast(text); setCount((c) => c + 1);
          onScan(text);
          if (!continuous) { setTimeout(() => close(), 150); }
        }, () => {});
        if (!alive) return;
        setStatus("scanning");
      } catch (e) {
        if (!alive) return;
        setStatus("error");
        const msg = String(e?.message || e || "");
        setError(/NotAllowed|Permission|izin/i.test(msg) ? "Kamera izni verilmedi. Tarayıcı ayarlarından bu site için kamera iznini açın." : /NotFound|no camera|Requested device not found/i.test(msg) ? "Bu cihazda kamera bulunamadı." : /secure|https/i.test(msg) ? "Kamera yalnızca HTTPS bağlantıda çalışır." : `Kamera başlatılamadı: ${msg.slice(0, 120)}`);
      }
    };
    const t = setTimeout(start, 50);
    return () => { alive = false; clearTimeout(t); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camIdx]);

  const stop = async () => { const s = scannerRef.current; scannerRef.current = null; if (s) { try { if (s.isScanning) await s.stop(); s.clear(); } catch { /* yoksay */ } } };
  const close = async () => { await stop(); onClose?.(); };
  const toggleTorch = async () => { try { await scannerRef.current?.applyVideoConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { setError("Bu kamerada flaş desteklenmiyor."); setTimeout(() => setError(""), 2000); } };

  return (
    <div className="fixed inset-0 z-[70] bg-black/90 flex flex-col" data-testid="camera-scanner" role="dialog">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="font-bold flex items-center gap-2"><Camera className="w-5 h-5 text-emerald-400" /> {title}{continuous && count > 0 && <span className="text-xs bg-emerald-600 rounded-full px-2 py-0.5">{count} okundu</span>}</div>
        <div className="flex items-center gap-1">
          {status === "scanning" && <button onClick={toggleTorch} className={`p-2 rounded-lg ${torch ? "bg-amber-500 text-black" : "bg-white/10"}`} title="Flaş" data-testid="camera-scanner-torch"><Zap className="w-5 h-5" /></button>}
          {cams.length > 1 && <button onClick={() => setCamIdx((camIdx + 1) % cams.length)} className="p-2 rounded-lg bg-white/10" title="Kamera değiştir" data-testid="camera-scanner-switch"><FlipHorizontal className="w-5 h-5" /></button>}
          <button onClick={close} className="p-2 rounded-lg bg-white/10" aria-label="Kapat" data-testid="camera-scanner-close"><X className="w-6 h-6" /></button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center px-3">
        <div className="w-full max-w-xl">
          <div id={idRef.current} className="w-full rounded-2xl overflow-hidden bg-black [&_video]:w-full [&_video]:rounded-2xl" data-testid="camera-scanner-view" />
          {status === "starting" && <div className="text-center text-slate-300 text-sm py-10 flex items-center justify-center gap-2" data-testid="camera-scanner-starting"><Loader2 className="w-5 h-5 animate-spin" /> Kamera açılıyor… izin isteniyorsa "İzin ver"e dokunun.</div>}
          {status === "error" && <div className="text-center text-rose-200 bg-rose-900/40 rounded-xl p-4 text-sm mt-3" data-testid="camera-scanner-error">{error}</div>}
          {status === "scanning" && error && <div className="text-center text-amber-200 text-xs mt-2">{error}</div>}
        </div>
      </div>
      <div className="px-4 pb-6 pt-2 text-center text-slate-300 text-xs space-y-1">
        {last ? <div className="text-emerald-300 font-mono text-base font-bold" data-testid="camera-scanner-last">{last}</div> : <div>Barkodu çerçevenin içine hizalayın. EAN-13, EAN-8, Code 128/39, UPC, ITF ve QR desteklenir.</div>}
        {continuous && <div>Sürekli okuma açık — her okuma otomatik işlenir. Bitince <b>X</b> ile kapatın.</div>}
      </div>
    </div>
  );
};

/* Girdilerin yanına konan kamera düğmesi */
export const ScanButton = ({ onScan, continuous = false, title, className = "", size = "md", label }) => {
  const [open, setOpen] = useState(false);
  const cls = size === "sm" ? "p-1.5" : "px-3 py-2";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${cls} flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition ${className}`} title={title || "Kamera ile barkod okut"} data-testid="camera-scan-btn"><Camera className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />{label && <span>{label}</span>}</button>
      {open && <CameraScanner onScan={onScan} onClose={() => setOpen(false)} continuous={continuous} title={title} />}
    </>
  );
};

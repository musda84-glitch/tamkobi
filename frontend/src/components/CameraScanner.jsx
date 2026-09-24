import React, { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, X, Loader2, FlipHorizontal, Zap } from "lucide-react";
import { scanQtyOnBlur, scanQtyOnFocus, scanQtyShown } from "../utils/scanQty";

/** Yaygın 1D barkod + QR / Data Matrix / PDF417 / Aztec */
export const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.RSS_14,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.PDF_417,
  Html5QrcodeSupportedFormats.AZTEC,
];

const NATIVE_FORMATS = [
  "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93",
  "codabar", "itf", "qr_code", "data_matrix", "pdf417", "aztec",
];

const VIDEO_BASE = {
  width: { ideal: 1920, min: 640 },
  height: { ideal: 1080, min: 480 },
};

export const normalizeScanText = (raw) => {
  if (raw == null) return "";
  return String(raw).trim().replace(/^\]C1/, "").replace(/\u001d/g, "").trim();
};

const supportsNativeDetector = () =>
  typeof window !== "undefined" && typeof window.BarcodeDetector === "function";

const beep = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = 1400;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => { try { o.stop(); ctx.close(); } catch { /* ignore */ } }, 110);
  } catch { /* sessiz */ }
};

const pickBackCamera = (devices) => {
  if (!devices?.length) return null;
  const scored = devices.map((d, i) => {
    const label = (d.label || "").toLowerCase();
    let score = i;
    if (/back|rear|environment|arka|world/.test(label)) score += 100;
    if (/ultra.?wide|tele/.test(label)) score -= 20;
    if (/front|user|ön|selfie|face/.test(label)) score -= 100;
    return { d, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].d;
};

/**
 * Kamera ile barkod/QR okuyucu.
 * Önce native BarcodeDetector (tam kare), yoksa html5-qrcode (yüksek çözünürlük + geniş alan).
 * continuous=true → okuduktan sonra kapanmaz; aynı kod 1,5 sn içinde tekrar sayılmaz.
 */
export const CameraScanner = ({ onScan, onClose, continuous = false, title = "Barkod / QR Okut", qtyEnabled = false, qty, onQtyChange, statusText }) => {
  const hostIdRef = useRef(`cam-scan-${Math.random().toString(36).slice(2)}`);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scannerRef = useRef(null);
  const rafRef = useRef(0);
  const lastRef = useRef({ code: "", at: 0 });
  const aliveRef = useRef(true);
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;

  const [status, setStatus] = useState("starting");
  const [error, setError] = useState("");
  const [engine, setEngine] = useState("");
  const [cams, setCams] = useState([]);
  const [camIdx, setCamIdx] = useState(-1);
  const [last, setLast] = useState(null);
  const [count, setCount] = useState(0);
  const [torch, setTorch] = useState(false);

  const stopAll = useCallback(async () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try { if (scanner.isScanning) await scanner.stop(); } catch { /* ignore */ }
      try { scanner.clear(); } catch { /* ignore */ }
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    if (videoRef.current) {
      try { videoRef.current.srcObject = null; } catch { /* ignore */ }
    }
  }, []);

  const close = useCallback(async () => {
    aliveRef.current = false;
    await stopAll();
    onClose?.();
  }, [onClose, stopAll]);

  const emitScan = useCallback((raw) => {
    const text = normalizeScanText(raw);
    if (!text || !aliveRef.current) return;
    const now = Date.now();
    if (lastRef.current.code === text && now - lastRef.current.at < 1500) return;
    lastRef.current = { code: text, at: now };
    beep();
    try { navigator.vibrate?.(60); } catch { /* ignore */ }
    setLast(text);
    setCount((c) => c + 1);
    onScan?.(text);
    if (!continuousRef.current) setTimeout(() => { close(); }, 120);
  }, [onScan, close]);

  const startNative = useCallback(async (deviceId) => {
    if (!supportsNativeDetector() || !videoRef.current) return false;

    let detector;
    try {
      detector = new window.BarcodeDetector({ formats: NATIVE_FORMATS });
    } catch {
      try { detector = new window.BarcodeDetector(); } catch { return false; }
    }

    const attempts = [];
    if (deviceId) attempts.push({ deviceId: { exact: deviceId }, ...VIDEO_BASE });
    attempts.push({ facingMode: { ideal: "environment" }, ...VIDEO_BASE });
    attempts.push({ facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } });
    attempts.push({ facingMode: "environment" });
    attempts.push(true);

    let stream = null;
    let lastErr;
    for (const c of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: c });
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!stream) throw lastErr || new Error("Kamera açılamadı");
    if (!aliveRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    video.muted = true;
    await video.play();

    setEngine("native");
    setStatus("scanning");

    let busy = false;
    const tick = async () => {
      if (!aliveRef.current) return;
      rafRef.current = requestAnimationFrame(tick);
      if (busy || video.readyState < 2) return;
      busy = true;
      try {
        const codes = await detector.detect(video);
        if (codes?.length) {
          const best = codes.reduce((a, b) => {
            const aa = (a.boundingBox?.width || 0) * (a.boundingBox?.height || 0);
            const bb = (b.boundingBox?.width || 0) * (b.boundingBox?.height || 0);
            return bb > aa ? b : a;
          });
          if (best?.rawValue) emitScan(best.rawValue);
        }
      } catch { /* kare atlanır */ } finally {
        busy = false;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return true;
  }, [emitScan]);

  const startHtml5 = useCallback(async (deviceId, devices) => {
    const elId = hostIdRef.current;
    const host = document.getElementById(elId);
    if (!host) return false;
    host.innerHTML = "";

    const scanner = new Html5Qrcode(elId, {
      formatsToSupport: SCAN_FORMATS,
      verbose: false,
      useBarCodeDetectorIfSupported: true,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    scannerRef.current = scanner;

    const qrbox = (viewW, viewH) => {
      const width = Math.floor(Math.min(viewW * 0.92, viewW - 16));
      const height = Math.floor(Math.min(Math.max(viewH * 0.45, 240), viewH * 0.72, 420));
      return { width: Math.max(200, width), height: Math.max(160, height) };
    };

    const onOk = (text) => emitScan(text);
    const onFail = () => {};

    const tryStart = async (cameraConfig, config) => {
      await scanner.start(cameraConfig, config, onOk, onFail);
    };

    const rich = {
      fps: 24,
      qrbox,
      aspectRatio: 1.777,
      disableFlip: false,
      videoConstraints: {
        ...VIDEO_BASE,
        facingMode: { ideal: "environment" },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    };
    const soft = { fps: 20, qrbox, disableFlip: false };

    try {
      if (deviceId) await tryStart({ deviceId: { exact: deviceId } }, rich);
      else await tryStart({ facingMode: "environment" }, rich);
    } catch {
      try { await scanner.stop().catch(() => {}); } catch { /* ignore */ }
      try {
        if (deviceId) await tryStart(deviceId, soft);
        else await tryStart({ facingMode: "environment" }, soft);
      } catch (e2) {
        const fallbackId = devices?.find((d) => d.id !== deviceId)?.id || devices?.[0]?.id;
        if (fallbackId) await tryStart(fallbackId, soft);
        else throw e2;
      }
    }

    if (!aliveRef.current) {
      await stopAll();
      return false;
    }
    setEngine("html5");
    setStatus("scanning");
    return true;
  }, [emitScan, stopAll]);

  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;

    const boot = async () => {
      setStatus("starting");
      setError("");
      setEngine("");
      setTorch(false);
      await stopAll();
      if (cancelled || !aliveRef.current) return;

      try {
        let devices = [];
        try {
          devices = await Html5Qrcode.getCameras();
        } catch {
          devices = [];
        }
        if (cancelled || !aliveRef.current) return;
        setCams(devices);

        let idx = camIdx;
        if (idx < 0 || idx >= devices.length) {
          const back = pickBackCamera(devices);
          idx = back ? Math.max(0, devices.findIndex((d) => d.id === back.id)) : 0;
          setCamIdx(idx);
        }
        const deviceId = devices[idx]?.id || null;

        let ok = false;
        if (supportsNativeDetector()) {
          try {
            ok = await startNative(deviceId);
          } catch {
            ok = false;
            await stopAll();
          }
        }
        if (!ok && aliveRef.current && !cancelled) {
          await startHtml5(deviceId, devices);
        }
      } catch (e) {
        if (cancelled || !aliveRef.current) return;
        setStatus("error");
        const msg = String(e?.message || e || "");
        setError(
          /NotAllowed|Permission|izin|Denied/i.test(msg)
            ? "Kamera izni verilmedi. Tarayıcı ayarlarından bu site için kamera iznini açın."
            : /NotFound|no camera|Requested device not found/i.test(msg)
              ? "Bu cihazda kamera bulunamadı."
              : /secure|https|SecureContext/i.test(msg)
                ? "Kamera yalnızca HTTPS bağlantıda çalışır."
                : `Kamera başlatılamadı: ${msg.slice(0, 140)}`
        );
      }
    };

    const t = setTimeout(boot, 40);
    return () => {
      cancelled = true;
      aliveRef.current = false;
      clearTimeout(t);
      stopAll();
    };
  }, [camIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTorch = async () => {
    try {
      if (scannerRef.current?.applyVideoConstraints) {
        await scannerRef.current.applyVideoConstraints({ advanced: [{ torch: !torch }] });
        setTorch(!torch);
        return;
      }
      const vt = streamRef.current?.getVideoTracks?.()?.[0];
      if (vt?.getCapabilities?.()?.torch) {
        await vt.applyConstraints({ advanced: [{ torch: !torch }] });
        setTorch(!torch);
        return;
      }
      setError("Bu kamerada flaş desteklenmiyor.");
      setTimeout(() => setError(""), 2000);
    } catch {
      setError("Bu kamerada flaş desteklenmiyor.");
      setTimeout(() => setError(""), 2000);
    }
  };

  const switchCam = () => {
    if (cams.length < 2) return;
    setCamIdx((i) => (Math.max(0, i) + 1) % cams.length);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/95 flex flex-col" data-testid="camera-scanner" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 py-3 text-white shrink-0">
        <div className="font-bold flex items-center gap-2 min-w-0">
          <Camera className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="truncate">{title}</span>
          {continuous && count > 0 && (
            <span className="text-xs bg-emerald-600 rounded-full px-2 py-0.5 shrink-0">{count} okundu</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {status === "scanning" && (
            <button type="button" onClick={toggleTorch} className={`p-2 rounded-lg ${torch ? "bg-amber-500 text-black" : "bg-white/10"}`} title="Flaş" data-testid="camera-scanner-torch">
              <Zap className="w-5 h-5" />
            </button>
          )}
          {cams.length > 1 && (
            <button type="button" onClick={switchCam} className="p-2 rounded-lg bg-white/10" title="Kamera değiştir" data-testid="camera-scanner-switch">
              <FlipHorizontal className="w-5 h-5" />
            </button>
          )}
          <button type="button" onClick={close} className="p-2 rounded-lg bg-white/10" aria-label="Kapat" data-testid="camera-scanner-close">
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-3 min-h-0 relative">
        <div className="w-full max-w-2xl relative">
          <video
            ref={videoRef}
            className={`w-full rounded-2xl bg-black object-cover max-h-[70vh] ${engine === "native" && status === "scanning" ? "block" : "hidden"}`}
            playsInline
            muted
            autoPlay
            data-testid="camera-scanner-video"
          />
          <div
            id={hostIdRef.current}
            className={`w-full rounded-2xl overflow-hidden bg-black [&_video]:w-full [&_video]:rounded-2xl [&_video]:max-h-[70vh] [&_img]:hidden ${engine === "html5" ? "block" : engine ? "hidden" : "block"}`}
            data-testid="camera-scanner-view"
          />

          {engine === "native" && status === "scanning" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
              <div className="w-[88%] max-w-md border-2 border-emerald-400/80 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" style={{ height: "38%" }} />
            </div>
          )}

          {status === "starting" && (
            <div className="text-center text-slate-300 text-sm py-10 flex items-center justify-center gap-2" data-testid="camera-scanner-starting">
              <Loader2 className="w-5 h-5 animate-spin" /> Kamera açılıyor… izin isteniyorsa &quot;İzin ver&quot;e dokunun.
            </div>
          )}
          {status === "error" && (
            <div className="text-center text-rose-200 bg-rose-900/40 rounded-xl p-4 text-sm mt-3" data-testid="camera-scanner-error">{error}</div>
          )}
          {status === "scanning" && error && (
            <div className="text-center text-amber-200 text-xs mt-2">{error}</div>
          )}
        </div>
      </div>

      <div className="px-4 pb-6 pt-2 text-center text-slate-300 text-xs space-y-1 shrink-0">
        {last ? (
          <div className="text-emerald-300 font-mono text-base font-bold break-all" data-testid="camera-scanner-last">{last}</div>
        ) : (
          <div>
            Barkodu veya QR kodu çerçeveye hizalayın ve sabit tutun.
            EAN-13/8, UPC, Code 128/39/93, ITF, Codabar, QR, Data Matrix, PDF417 desteklenir.
          </div>
        )}
        {qtyEnabled ? (
          <label className="flex items-center justify-center gap-2 text-white pt-1">
            <span className="font-bold">Adet çarpan</span>
            <input
              value={scanQtyShown(qty)}
              onChange={(e) => onQtyChange?.(e.target.value.replace(/\D/g, ""))}
              onFocus={() => onQtyChange?.(scanQtyOnFocus())}
              onBlur={() => onQtyChange?.(scanQtyOnBlur(qty))}
              inputMode="numeric"
              className="w-16 rounded-lg px-2 py-1 text-slate-900 font-black text-center"
              data-testid="camera-scanner-qty"
            />
          </label>
        ) : null}
        {statusText ? <div className="text-emerald-300 font-bold" data-testid="camera-scanner-status">{statusText}</div> : null}
        {continuous && <div>Sürekli okuma açık — her okuma otomatik işlenir. Bitince <b>X</b> ile kapatın.</div>}
        {engine && status === "scanning" && (
          <div className="text-slate-500" data-testid="camera-scanner-engine">
            {engine === "native" ? "Yerel tarayıcı okuyucu" : "Gelişmiş yazılım okuyucu"}
          </div>
        )}
      </div>
    </div>
  );
};

/** Girdilerin yanına konan kamera düğmesi — panel, B2B, hızlı satış vb. ortak */
export const ScanButton = ({ onScan, continuous = false, title, className = "", size = "md", label, qtyEnabled = false, qty, onQtyChange, statusText }) => {
  const [open, setOpen] = useState(false);
  const cls = size === "sm" ? "p-1.5" : "px-3 py-2";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${cls} flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition ${className}`}
        title={title || "Kamera ile barkod / QR okut"}
        data-testid="camera-scan-btn"
      >
        <Camera className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />
        {label && <span>{label}</span>}
      </button>
      {open && (
        <CameraScanner
          onScan={onScan}
          onClose={() => setOpen(false)}
          continuous={continuous}
          title={title}
          qtyEnabled={qtyEnabled}
          qty={qty}
          onQtyChange={onQtyChange}
          statusText={statusText}
        />
      )}
    </>
  );
};

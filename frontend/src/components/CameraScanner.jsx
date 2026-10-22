import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, X, Loader2, FlipHorizontal, Zap, Check } from "lucide-react";
import { parseScanQtyInput, scanQtyOnBlur, scanQtyOnFocus, scanQtyShown } from "../utils/scanQty";
import {
  applyFocusTuning,
  applyTapFocus,
  html5CameraConfig,
  html5VideoConstraints,
  openVideoStream,
  orderCamerasForSwitch,
  playVideoElement,
  prepareVideoElement,
  preferredZoom,
  resolveCameraDevices,
  selectBackCamera,
  stopStream,
  trackFromScanner,
} from "./cameraSelect";

/** Basılı tutma eşiği, tek okuma penceresi ve aynı kodun tekrar sayılmama süresi. */
export const SHUTTER_HOLD_MS = 400;
export const SHUTTER_SEARCH_MS = 1500;
export const SHUTTER_DEDUPE_MS = 1500;

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

export const normalizeScanText = (raw) => {
  if (raw == null) return "";
  return String(raw).trim().replace(/^\]C1/, "").replace(/\u001d/g, "").trim();
};

const supportsNativeDetector = () =>
  typeof window !== "undefined" && typeof window.BarcodeDetector === "function";

/** iOS Safari / Android Chrome: titreşim yoksa veya hata verirse okuma sürer. */
const buzz = () => {
  try {
    const vibrate = typeof navigator !== "undefined" ? navigator.vibrate : undefined;
    if (typeof vibrate === "function") vibrate(60);
  } catch { /* sessiz */ }
};

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

/**
 * Kamera ile barkod/QR okuyucu — deklanşör.
 * Önce native BarcodeDetector (tam kare), yoksa html5-qrcode (yüksek çözünürlük + geniş alan).
 * Decode döngüsü sürekli çalışır; sonuç yalnızca tek okuma penceresinde (ilk kod) veya
 * seri okuma basılıyken (dedupe ile) onScan'a gider. Kamera okumadan sonra açık kalır.
 * continuous geriye uyumluluk için kabul edilir; davranışı değiştirmez.
 */
export const CameraScanner = ({ onScan, onClose, continuous = false, title = "Barkod okut", qtyEnabled = false, qty, onQtyChange, statusText }) => {
  void continuous;
  const hostIdRef = useRef(`cam-scan-${Math.random().toString(36).slice(2)}`);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scannerRef = useRef(null);
  const rafRef = useRef(0);
  const lastRef = useRef({ code: "", at: 0 });
  const aliveRef = useRef(true);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const modeRef = useRef("idle");
  const pressingRef = useRef(false);
  const holdTimerRef = useRef(0);
  const searchTimerRef = useRef(0);
  const flashTimerRef = useRef(0);
  const focusTimerRef = useRef(0);
  const trackRef = useRef(null);
  const manualCodeRef = useRef("");
  const manualInputRef = useRef(null);
  const hiddenRef = useRef(false);
  const torchRef = useRef(false);

  const [status, setStatus] = useState("starting");
  const [error, setError] = useState("");
  const [engine, setEngine] = useState("");
  const [cams, setCams] = useState([]);
  const [camIdx, setCamIdx] = useState(-1);
  const [count, setCount] = useState(0);
  const [recent, setRecent] = useState([]);
  const [torch, setTorch] = useState(false);
  const [torchCapable, setTorchCapable] = useState(false);
  const [zoomRange, setZoomRange] = useState(null);
  const [zoomValue, setZoomValue] = useState(1);
  const [needGesture, setNeedGesture] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [visTick, setVisTick] = useState(0);
  const [mode, setMode] = useState("idle");
  const [notFound, setNotFound] = useState(false);
  const [hit, setHit] = useState(null);
  const [flash, setFlash] = useState(false);
  torchRef.current = torch;

  const clearTimer = (ref) => {
    if (ref.current) {
      clearTimeout(ref.current);
      ref.current = 0;
    }
  };

  const setModeBoth = (next) => {
    modeRef.current = next;
    setMode(next);
  };

  const stopAll = useCallback(async () => {
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = 0;
    }
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
    stopStream(stream);
    trackRef.current = null;
    const host = typeof document !== "undefined" ? document.getElementById(hostIdRef.current) : null;
    host?.querySelectorAll?.("video")?.forEach((video) => {
      stopStream(video.srcObject);
      try { video.srcObject = null; } catch { /* ignore */ }
    });
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
    const current = modeRef.current;
    if (current !== "single" && current !== "serial") return;
    const now = Date.now();
    if (lastRef.current.code === text && now - lastRef.current.at < SHUTTER_DEDUPE_MS) return;
    lastRef.current = { code: text, at: now };
    beep();
    buzz();
    setFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = 0;
      setFlash(false);
    }, 180);
    if (current === "single") {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = 0;
      }
      modeRef.current = "idle";
      setMode("idle");
      setNotFound(false);
      setHit({ code: text });
    } else {
      setCount((c) => c + 1);
      setRecent((prev) => [text, ...prev].slice(0, 6));
    }
    onScanRef.current?.(text);
  }, []);

  const enterSerial = () => {
    clearTimer(searchTimerRef);
    setNotFound(false);
    setHit(null);
    setCount(0);
    setRecent([]);
    setModeBoth("serial");
  };

  const enterSingle = () => {
    clearTimer(searchTimerRef);
    setNotFound(false);
    setHit(null);
    setModeBoth("single");
    searchTimerRef.current = setTimeout(() => {
      searchTimerRef.current = 0;
      if (modeRef.current !== "single") return;
      modeRef.current = "idle";
      setMode("idle");
      setNotFound(true);
    }, SHUTTER_SEARCH_MS);
  };

  const onShutterDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pressingRef.current) return;
    pressingRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
    clearTimer(holdTimerRef);
    if (modeRef.current === "single") {
      clearTimer(searchTimerRef);
      setModeBoth("idle");
    }
    setNotFound(false);
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = 0;
      if (!pressingRef.current) return;
      enterSerial();
    }, SHUTTER_HOLD_MS);
  };

  const releasePointer = (e) => {
    try {
      if (e?.pointerId != null && e.currentTarget?.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch { /* ignore */ }
  };

  const finishGesture = (e, asTap) => {
    const was = pressingRef.current;
    pressingRef.current = false;
    clearTimer(holdTimerRef);
    releasePointer(e);
    if (!was) return;
    if (modeRef.current === "serial") {
      setModeBoth("idle");
      return;
    }
    if (asTap) enterSingle();
  };

  const onShutterContextMenu = (e) => {
    e.preventDefault();
  };

  const shutterStyle = {
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
  };
  const shutterBox = {
    ...shutterStyle,
    width: 76,
    height: 76,
    minWidth: 72,
    minHeight: 72,
  };
  const shutterRef = useRef(null);

  useLayoutEffect(() => {
    const el = shutterRef.current;
    if (!el) return undefined;
    // iOS Safari ve Android Chrome vendor önekini ham style metninden uygular.
    el.setAttribute(
      "style",
      "touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; width: 76px; height: 76px; min-width: 72px; min-height: 72px;",
    );
    const block = (event) => {
      if (event.cancelable) event.preventDefault();
    };
    const opts = { capture: true, passive: false };
    el.addEventListener("touchstart", block, opts);
    el.addEventListener("touchmove", block, opts);
    el.addEventListener("pointermove", block, opts);
    el.addEventListener("selectstart", block, opts);
    el.addEventListener("contextmenu", block, opts);
    return () => {
      el.removeEventListener("touchstart", block, opts);
      el.removeEventListener("touchmove", block, opts);
      el.removeEventListener("pointermove", block, opts);
      el.removeEventListener("selectstart", block, opts);
      el.removeEventListener("contextmenu", block, opts);
    };
  });

  const publishCaps = useCallback((caps) => {
    const zoom = caps?.zoom;
    const hasZoom = !!zoom && typeof zoom.min === "number" && typeof zoom.max === "number" && zoom.max > zoom.min;
    setZoomRange(hasZoom ? { min: zoom.min, max: zoom.max, step: zoom.step || 0.1 } : null);
    const start = preferredZoom(zoom);
    if (start != null) setZoomValue(start);
    setTorchCapable(caps?.torch === true);
  }, []);

  const bindTrack = useCallback(async (scanner, video) => {
    prepareVideoElement(video);
    const tunable = trackFromScanner(scanner) || video?.srcObject?.getVideoTracks?.()?.[0] || null;
    trackRef.current = tunable;
    const caps = tunable ? (await applyFocusTuning(tunable)) || {} : {};
    publishCaps(caps);
    if (video) {
      const playing = await playVideoElement(video);
      if (!playing) setNeedGesture(true);
    }
    return caps;
  }, [publishCaps]);

  const startNative = useCallback(async (deviceId) => {
    if (!supportsNativeDetector() || !videoRef.current) return false;
    const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (typeof getUserMedia !== "function") return false;

    let detector;
    try {
      detector = new window.BarcodeDetector({ formats: NATIVE_FORMATS });
    } catch {
      try { detector = new window.BarcodeDetector(); } catch { return false; }
    }

    const stream = await openVideoStream(getUserMedia, deviceId);
    if (!aliveRef.current || hiddenRef.current) {
      stopStream(stream);
      return false;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    video.srcObject = stream;
    await bindTrack(null, video);
    if (hiddenRef.current) {
      await stopAll();
      return false;
    }

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
  }, [bindTrack, emitScan, stopAll]);

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
      const width = Math.floor(viewW * 0.88);
      const height = Math.floor(viewH * 0.38);
      return {
        width: Math.max(1, Math.min(width, viewW - 2)),
        height: Math.max(1, Math.min(height, viewH - 2)),
      };
    };

    const onOk = (text) => emitScan(text);
    const onFail = () => {};

    const tryStart = async (cameraConfig, config) => {
      await scanner.start(cameraConfig, config, onOk, onFail);
    };

    const scanConfig = (id, quality) => ({
      fps: 15,
      qrbox,
      aspectRatio: 1.777,
      disableFlip: false,
      videoConstraints: html5VideoConstraints(id, quality),
    });

    const startWith = async (id, quality) => {
      await tryStart(html5CameraConfig(id), scanConfig(id, quality));
    };

    const startRelaxed = async (id) => {
      await tryStart(html5CameraConfig(id), {
        fps: 15,
        qrbox,
        aspectRatio: 1.777,
        disableFlip: false,
        videoConstraints: id
          ? { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    };

    const attempts = [
      () => startWith(deviceId, "high"),
      () => startRelaxed(deviceId),
    ];
    const fallbackId = devices?.map((d) => d.id).find((id) => id && id !== deviceId) || null;
    if (fallbackId) attempts.push(() => startRelaxed(fallbackId));
    if (deviceId) attempts.push(() => startRelaxed(null));

    let started = false;
    let lastErr;
    for (const attempt of attempts) {
      try {
        await attempt();
        started = true;
        break;
      } catch (err) {
        lastErr = err;
        try { await scanner.stop().catch(() => {}); } catch { /* ignore */ }
      }
    }
    if (!started) throw lastErr || new Error("Kamera açılamadı");

    if (!aliveRef.current || hiddenRef.current) {
      await stopAll();
      return false;
    }
    await bindTrack(scanner, host.querySelector("video"));
    if (!aliveRef.current || hiddenRef.current) {
      await stopAll();
      return false;
    }
    setEngine("html5");
    setStatus("scanning");
    return true;
  }, [bindTrack, emitScan, stopAll]);

  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;

    const boot = async () => {
      if (hiddenRef.current) return;
      setStatus("starting");
      setError("");
      setEngine("");
      setTorch(false);
      setTorchCapable(false);
      setZoomRange(null);
      setNeedGesture(false);
      await stopAll();
      if (cancelled || !aliveRef.current || hiddenRef.current) return;

      try {
        const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
        let devices = await resolveCameraDevices(() => Html5Qrcode.getCameras(), getUserMedia);
        if (cancelled || !aliveRef.current || hiddenRef.current) return;
        devices = orderCamerasForSwitch(devices);
        setCams(devices);

        let idx = camIdx;
        if (idx < 0 || idx >= devices.length) {
          const back = await selectBackCamera(devices, getUserMedia);
          if (cancelled || !aliveRef.current || hiddenRef.current) return;
          idx = back ? Math.max(0, devices.findIndex((d) => d.id === back.id)) : 0;
          if (devices.length && idx !== camIdx) {
            setCamIdx(idx);
            return;
          }
          if (!devices.length && camIdx !== 0) {
            setCamIdx(0);
            return;
          }
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
        if (!ok && aliveRef.current && !cancelled && !hiddenRef.current) {
          await startHtml5(deviceId, devices);
        }
      } catch (e) {
        if (cancelled || !aliveRef.current) return;
        await stopAll();
        if (cancelled || !aliveRef.current) return;
        setStatus("error");
        const msg = String(e?.name || "") + " " + String(e?.message || e || "");
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
      clearTimer(holdTimerRef);
      clearTimer(searchTimerRef);
      clearTimer(flashTimerRef);
      clearTimer(focusTimerRef);
      stopAll();
    };
  }, [camIdx, visTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onVis = () => {
      const hidden = document.visibilityState === "hidden";
      hiddenRef.current = hidden;
      if (hidden) {
        stopAll();
        return;
      }
      setVisTick((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [stopAll]);

  useEffect(() => {
    if (status !== "error") return undefined;
    try { manualInputRef.current?.focus(); } catch { /* ignore */ }
    return undefined;
  }, [status]);

  const toggleTorch = async () => {
    if (!torchCapable) return;
    const next = !torch;
    try {
      const track = trackRef.current;
      if (track?.applyConstraints) {
        await track.applyConstraints({ advanced: [{ torch: next }] });
        setTorch(next);
        return;
      }
      if (scannerRef.current?.applyVideoConstraints) {
        await scannerRef.current.applyVideoConstraints({ advanced: [{ torch: next }] });
        setTorch(next);
        return;
      }
      const vt = streamRef.current?.getVideoTracks?.()?.[0];
      if (vt?.getCapabilities?.()?.torch) {
        await vt.applyConstraints({ advanced: [{ torch: next }] });
        setTorch(next);
      }
    } catch { /* flaş yoksa sessiz */ }
  };

  const switchCam = () => {
    if (cams.length < 2) return;
    setCamIdx((i) => (Math.max(0, i) + 1) % cams.length);
  };

  const submitManual = (event) => {
    event?.preventDefault?.();
    const text = normalizeScanText(manualCodeRef.current);
    if (!text || !aliveRef.current) return;
    manualCodeRef.current = "";
    setManualCode("");
    onScanRef.current?.(text);
    beep();
    buzz();
  };

  const changeZoom = async (raw) => {
    if (!zoomRange) return;
    const next = Math.min(zoomRange.max, Math.max(zoomRange.min, Number(raw)));
    if (Number.isNaN(next)) return;
    setZoomValue(next);
    const track = trackRef.current;
    if (!track?.applyConstraints) return;
    try {
      const caps = track.getCapabilities?.() || {};
      const advanced = { zoom: next };
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) advanced.focusMode = "continuous";
      if (caps.torch && torchRef.current) advanced.torch = true;
      await track.applyConstraints({ advanced: [advanced] });
    } catch { /* sessiz */ }
  };

  const onPreviewPointerDown = async (event) => {
    const tag = event.target?.closest?.("button, input, textarea, a, label");
    if (tag) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = event.currentTarget.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const result = await applyTapFocus(track, x, y);
    if (result?.revert) {
      clearTimer(focusTimerRef);
      focusTimerRef.current = setTimeout(() => {
        focusTimerRef.current = 0;
        result.revert();
      }, result.revertMs || 1000);
    }
  };

  const resumePlayback = async () => {
    const video = videoRef.current || document.getElementById(hostIdRef.current)?.querySelector("video");
    const ok = await playVideoElement(video);
    if (ok) setNeedGesture(false);
  };

  const qtyN = qtyEnabled ? parseScanQtyInput(qty) : 1;
  const serial = mode === "serial";
  const heading = serial ? "Seri okuma" : title;
  const statusNode = statusText ? (
    <div className="font-bold text-sm truncate" data-testid="camera-scanner-status">{statusText}</div>
  ) : null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/95 flex flex-col" style={{ height: "100dvh", maxHeight: "100dvh" }} data-testid="camera-scanner" data-mode={mode} role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 py-3 text-white shrink-0">
        <div className="font-bold flex items-center gap-2 min-w-0">
          <Camera className={`w-5 h-5 shrink-0 ${serial ? "text-rose-400" : "text-emerald-400"}`} />
          <span className="truncate">{heading}</span>
          {serial && (
            <span className="text-[11px] font-black tracking-wide bg-rose-600 text-white rounded-full px-2 py-0.5 shrink-0" data-testid="camera-scanner-serial-badge">● SERİ</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {status === "scanning" && (
            <button type="button" onClick={toggleTorch} disabled={!torchCapable} className={`p-2 rounded-lg disabled:opacity-40 ${torch ? "bg-amber-500 text-black" : "bg-white/10"}`} title={torchCapable ? "Flaş" : "Flaş desteklenmiyor"} data-testid="camera-scanner-torch">
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
        <div className="w-full max-w-2xl relative" onPointerDown={onPreviewPointerDown}>
          <video
            ref={(node) => {
              videoRef.current = node;
              prepareVideoElement(node);
            }}
            className={`w-full rounded-2xl bg-black object-cover max-h-[70vh] ${engine === "native" && status === "scanning" ? "block" : "hidden"}`}
            playsInline
            muted
            autoPlay
            data-testid="camera-scanner-video"
          />
          <div
            id={hostIdRef.current}
            className={`w-full rounded-2xl overflow-hidden bg-black [&_video]:w-full [&_video]:object-cover [&_video]:rounded-2xl [&_video]:max-h-[70vh] [&_img]:hidden ${engine === "html5" ? "block" : engine ? "hidden" : "block"}`}
            data-testid="camera-scanner-view"
          />

          {engine === "native" && status === "scanning" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
              <div className={`w-[88%] max-w-md border-2 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] ${serial ? "border-rose-400/80" : "border-emerald-400/80"}`} style={{ height: "38%" }} />
            </div>
          )}

          {flash && <div className="pointer-events-none absolute inset-0 rounded-2xl bg-emerald-400/35" data-testid="camera-scanner-flash" />}

          {hit && !serial && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 max-w-[92%] inline-flex items-center gap-2 rounded-full bg-emerald-500 text-white px-4 py-2 shadow-lg" data-testid="camera-scanner-toast" role="status">
              <Check className="w-5 h-5 shrink-0" />
              <div className="text-left min-w-0">
                {statusNode || <div className="font-bold text-sm truncate">{hit.code}</div>}
                <div className="font-mono text-[11px] text-emerald-50 truncate" data-testid="camera-scanner-last">{hit.code}</div>
                <div className="text-[11px] text-emerald-50">Sepete eklendi (×{qtyN}) · sıradaki için tekrar dokunun</div>
              </div>
            </div>
          )}

          {notFound && !hit && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-full bg-rose-600 text-white px-4 py-2 text-sm font-bold shadow-lg" data-testid="camera-scanner-notfound" role="status">
              Kod bulunamadı
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
          {needGesture && (
            <button type="button" onClick={resumePlayback} className="mt-3 px-3 py-2 rounded-lg bg-white/10 text-white text-xs font-semibold" data-testid="camera-scanner-play">
              Kamerayı başlat
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pt-2 text-slate-300 text-xs shrink-0 flex flex-col items-center">
        <form className="flex items-center justify-center gap-2 text-white text-xs mb-3" onSubmit={submitManual} data-testid="camera-scanner-manual">
          <span className="font-bold">Kodu elle gir</span>
          <input
            ref={manualInputRef}
            value={manualCode}
            onChange={(e) => {
              manualCodeRef.current = e.target.value;
              setManualCode(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitManual(e);
            }}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-40 rounded-lg px-2 py-1 text-slate-900 font-black text-center text-sm"
            aria-label="Kodu elle gir"
            data-testid="camera-scanner-manual-input"
          />
        </form>
        {zoomRange ? (
          <label className="flex items-center justify-center gap-2 text-white text-xs mb-3">
            <span className="font-bold">Yakınlaştır</span>
            <input
              type="range"
              min={zoomRange.min}
              max={zoomRange.max}
              step={zoomRange.step || 0.1}
              value={zoomValue}
              onChange={(e) => changeZoom(e.target.value)}
              className="w-40"
              data-testid="camera-scanner-zoom"
            />
          </label>
        ) : null}
      </div>

      <div className="px-4 pb-6 pt-2 text-center text-slate-300 text-xs shrink-0 flex flex-col items-center" style={shutterStyle}>
        {serial && (
          <div className="w-full max-w-sm mb-3 text-left">
            <div className="text-rose-300 font-bold text-sm text-center" data-testid="camera-scanner-count">{count} okuma</div>
            {recent.length > 0 && (
              <ul className="mt-1 max-h-24 overflow-y-auto space-y-0.5" data-testid="camera-scanner-recent">
                {recent.map((code, i) => (
                  <li key={`${code}-${i}`} className="font-mono text-[11px] text-slate-300 truncate">{code}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!(hit && !serial) && statusNode ? <div className="text-emerald-300 mb-2">{statusNode}</div> : null}
        {qtyEnabled ? (
          <label className="flex items-center justify-center gap-2 text-white text-xs mb-3">
            <span className="font-bold">Adet çarpan</span>
            <input
              value={scanQtyShown(qty)}
              onChange={(e) => onQtyChange?.(e.target.value.replace(/\D/g, ""))}
              onFocus={() => onQtyChange?.(scanQtyOnFocus())}
              onBlur={() => onQtyChange?.(scanQtyOnBlur(qty))}
              inputMode="numeric"
              className="w-14 rounded-lg px-2 py-1 text-slate-900 font-black text-center text-sm"
              data-testid="camera-scanner-qty"
            />
          </label>
        ) : null}
        <button
          ref={shutterRef}
          type="button"
          data-testid="camera-scanner-shutter"
          data-mode={mode}
          aria-label="Deklanşör. Dokun: tek okut. Basılı tut: seri okut."
          onPointerDown={onShutterDown}
          onPointerUp={(e) => finishGesture(e, true)}
          onPointerLeave={(e) => {
            if (e.pointerType && e.pointerType !== "mouse") return;
            finishGesture(e, false);
          }}
          onPointerCancel={(e) => finishGesture(e, false)}
          onContextMenu={onShutterContextMenu}
          draggable={false}
          style={shutterBox}
          className={`relative select-none outline-none touch-none ${serial ? "text-rose-500" : "text-white"}`}
        >
          <span className="pointer-events-none relative block w-full h-full">
            <span className={`absolute inset-0 rounded-full border-[5px] ${serial ? "border-rose-500 animate-pulse" : "border-white"}`} />
            {serial && (
              <span
                className="absolute -inset-1 rounded-full border-4 border-transparent border-t-rose-400 border-r-rose-500 animate-spin"
                style={{ animationDuration: "0.9s" }}
              />
            )}
            <span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all ${serial ? "w-8 h-8 rounded-lg bg-rose-500" : "w-14 h-14 rounded-full bg-white"}`} />
          </span>
        </button>
        <div className="mt-3 text-xs text-slate-300" data-testid="camera-scanner-hint">
          {serial ? "Seri okuma sürüyor · bırakınca durur" : "Dokun: tek okut · Basılı tut: seri okut"}
        </div>
        {engine && status === "scanning" && (
          <div className="text-slate-500 mt-2" data-testid="camera-scanner-engine">
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

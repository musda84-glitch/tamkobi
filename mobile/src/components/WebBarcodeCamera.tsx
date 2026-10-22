import React, { createElement, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { normalizeScanText } from "../utils/b2bCatalog";

type DetectorCtor = new (opts?: { formats?: string[] }) => { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> };

const FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "itf",
  "qr_code",
  "data_matrix",
  "pdf417",
  "aztec",
];

function detector(): DetectorCtor | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return typeof Ctor === "function" ? Ctor : null;
}

type ZoomCaps = { min?: number; max?: number; step?: number };
type TrackCaps = MediaTrackCapabilities & {
  torch?: boolean;
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  zoom?: ZoomCaps;
};

function isFrontLabel(label: string) {
  const text = label.toLowerCase();
  if (/facing[\s_-]*(front|user)/.test(text)) return true;
  if (/\b(front|user|selfie)\b/.test(text)) return true;
  return text.includes("ön");
}

function pickBackCamera(devices: MediaDeviceInfo[]) {
  const labeled = devices.filter((device) => device.label?.trim());
  if (!labeled.length) return null;
  const virtual = [/back\s+triple\s+camera/, /back\s+dual\s+wide\s+camera/, /back\s+dual\s+camera/];
  for (const pattern of virtual) {
    const found = labeled.find((device) => pattern.test(device.label.toLowerCase()));
    if (found) return found.deviceId;
  }
  const plain = labeled.find((device) => {
    const text = device.label.toLowerCase();
    return /back|rear|arka|environment/.test(text) && !isFrontLabel(text) && !/ultra|macro|\btele\b|depth|desk|\bwide\b/.test(text);
  });
  if (plain) return plain.deviceId;
  const anyBack = labeled.find((device) => /back|rear|arka|environment/.test(device.label.toLowerCase()) && !isFrontLabel(device.label));
  return anyBack?.deviceId || null;
}

function videoAttempts(deviceId: string | null): Array<MediaTrackConstraints | boolean> {
  const sized = (id: string | null, width: number, height: number): MediaTrackConstraints => {
    const video: MediaTrackConstraints = {
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30 },
      aspectRatio: { ideal: 16 / 9 },
    };
    if (id) video.deviceId = { exact: id };
    else video.facingMode = { ideal: "environment" };
    return video;
  };
  const attempts: Array<MediaTrackConstraints | boolean> = [];
  if (deviceId) {
    attempts.push(sized(deviceId, 1920, 1080));
    attempts.push(sized(deviceId, 1280, 720));
  }
  attempts.push(sized(null, 1920, 1080));
  attempts.push(sized(null, 1280, 720));
  attempts.push({ facingMode: { ideal: "environment" } });
  attempts.push(true);
  return attempts;
}

async function openStream(deviceId: string | null) {
  let last: unknown;
  for (const video of videoAttempts(deviceId)) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("Kamera açılamadı");
}

function applyFocusTuning(track: MediaStreamTrack | undefined) {
  if (!track || typeof track.getCapabilities !== "function" || typeof track.applyConstraints !== "function") return;
  let caps: TrackCaps = {};
  try {
    caps = track.getCapabilities() as TrackCaps;
  } catch {
    return;
  }
  const advanced: Record<string, unknown> = {};
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) advanced.focusMode = "continuous";
  if (caps.zoom && typeof caps.zoom.min === "number" && typeof caps.zoom.max === "number") {
    const start = Math.min(Math.max(caps.zoom.min, 1.5), caps.zoom.max);
    if (start >= 1) advanced.zoom = start;
  }
  if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) advanced.exposureMode = "continuous";
  if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes("continuous")) {
    advanced.whiteBalanceMode = "continuous";
  }
  if (!Object.keys(advanced).length) return;
  track.applyConstraints({ advanced: [advanced] } as unknown as MediaTrackConstraints).catch(() => undefined);
}

function applyTorch(stream: MediaStream | null, torch: boolean) {
  const track = stream?.getVideoTracks?.()?.[0];
  if (!track || typeof track.applyConstraints !== "function" || typeof track.getCapabilities !== "function") return;
  const caps = track.getCapabilities() as TrackCaps;
  if (!caps.torch) return;
  track.applyConstraints({ advanced: [{ torch }] } as unknown as MediaTrackConstraints).catch(() => undefined);
}

/** Expo CameraView web'de barkod olayı üretmez; tarayıcı BarcodeDetector + getUserMedia kullanır. */
export function WebBarcodeCamera({
  active,
  onScan,
  continuous = false,
  torch = false,
}: {
  active: boolean;
  onScan: (code: string) => void;
  /** Geriye uyumluluk. Akış artık deklanşör kapısından geçer; bu prop çözmeyi durdurmaz. */
  continuous?: boolean;
  torch?: boolean;
}) {
  void continuous;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const torchRef = useRef(torch);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  torchRef.current = torch;
  const [hint, setHint] = useState("Kamera açılıyor…");
  const [resumeKey, setResumeKey] = useState(0);

  useEffect(() => {
    applyTorch(streamRef.current, torch);
  }, [torch]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        return;
      }
      setResumeKey((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setHint("Bu ortamda kamera yok. Barkodu elle yazın.");
      return;
    }
    const host = hostRef.current;
    if (!host || typeof host.replaceChildren !== "function") {
      setHint("Bu ortamda kamera yok. Barkodu elle yazın.");
      return;
    }
    const video = document.createElement("video");
    video.setAttribute("playsinline", "true");
    video.setAttribute("autoplay", "true");
    video.muted = true;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";
    video.style.background = "#000";
    video.style.userSelect = "none";
    if (typeof video.style.setProperty === "function") {
      video.style.setProperty("-webkit-user-select", "none");
      video.style.setProperty("-webkit-touch-callout", "none");
    }
    video.addEventListener("contextmenu", (event) => event.preventDefault());
    host.replaceChildren(video);

    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const Ctor = detector();

    const tick = async (det: InstanceType<DetectorCtor>) => {
      if (stopped) return;
      try {
        if (video.readyState >= 2) {
          const codes = await det.detect(video);
          const value = normalizeScanText(codes[0]?.rawValue);
          if (value) onScanRef.current(value);
        }
      } catch {
        /* kare atlanır */
      }
      timer = window.setTimeout(() => tick(det), 180);
    };

    const play = () => {
      video.play().catch(() => setHint("Görüntü için ekrana dokunun."));
    };
    video.addEventListener("click", play);

    (async () => {
      try {
        let deviceId: string | null = null;
        try {
          const listed = await navigator.mediaDevices.enumerateDevices();
          deviceId = pickBackCamera(listed);
        } catch { /* etiket için önce akış */ }
        stream = await openStream(deviceId);
        streamRef.current = stream;
        video.srcObject = stream;
        if (!deviceId) {
          try {
            const listed = await navigator.mediaDevices.enumerateDevices();
            const picked = pickBackCamera(listed);
            const current = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
            if (picked && picked !== current) {
              stream.getTracks().forEach((track) => track.stop());
              stream = await openStream(picked);
              streamRef.current = stream;
              video.srcObject = stream;
            }
          } catch { /* mevcut akış kalsın */ }
        }
        applyFocusTuning(stream.getVideoTracks()[0]);
        try {
          await video.play();
        } catch {
          setHint("Görüntü için ekrana dokunun.");
        }
        applyTorch(stream, torchRef.current);
        if (!Ctor) {
          setHint("Bu tarayıcı canlı barkod okumuyor. Chrome / Edge kullanın veya kodu yazın.");
          return;
        }
        setHint("");
        tick(new Ctor({ formats: FORMATS }));
      } catch (err) {
        setHint(err instanceof Error && /denied|permission/i.test(err.message)
          ? "Kamera izni reddedildi. Tarayıcı adres çubuğundan izin verin."
          : "Kamera açılamadı. HTTPS gerekir; kodu elle yazabilirsiniz.");
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (streamRef.current === stream) streamRef.current = null;
      video.srcObject = null;
      video.removeEventListener("click", play);
      host.replaceChildren();
    };
  }, [active, resumeKey]);

  return (
    <View style={{ flex: 1, minHeight: 240 }}>
      {createElement("div", {
        ref: (el: HTMLDivElement | null) => {
          hostRef.current = el;
        },
        style: {
          width: "100%",
          height: "100%",
          minHeight: 240,
          borderRadius: 16,
          overflow: "hidden",
          background: "#000",
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
        },
        onContextMenu: (event: Event) => event.preventDefault(),
      })}
      {hint ? (
        <Text style={{ position: "absolute", left: 12, right: 12, bottom: 12, color: "#CBD5E1", fontSize: 13 }}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function webBarcodeSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

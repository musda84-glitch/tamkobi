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

function applyTorch(stream: MediaStream | null, torch: boolean) {
  const track = stream?.getVideoTracks?.()?.[0];
  if (!track || typeof track.applyConstraints !== "function" || typeof track.getCapabilities !== "function") return;
  const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
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

  useEffect(() => {
    applyTorch(streamRef.current, torch);
  }, [torch]);

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

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
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
      host.replaceChildren();
    };
  }, [active]);

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

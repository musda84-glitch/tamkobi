import React, { createElement, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { colors } from "../theme";
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

/** Expo CameraView web'de barkod olayı üretmez; tarayıcı BarcodeDetector + getUserMedia kullanır. */
export function WebBarcodeCamera({
  active,
  onScan,
  continuous = false,
}: {
  active: boolean;
  onScan: (code: string) => void;
  continuous?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [hint, setHint] = useState("Kamera açılıyor…");

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setHint("Bu ortamda kamera yok. Barkodu elle yazın.");
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    const video = document.createElement("video");
    video.setAttribute("playsinline", "true");
    video.setAttribute("autoplay", "true");
    video.muted = true;
    video.style.width = "100%";
    video.style.height = "260px";
    video.style.objectFit = "cover";
    video.style.background = "#000";
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
          if (value) {
            onScanRef.current(value);
            if (!continuous) return;
            timer = window.setTimeout(() => tick(det), 900);
            return;
          }
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
        video.srcObject = stream;
        await video.play();
        if (!Ctor) {
          setHint("Bu tarayıcı canlı barkod okumuyor. Chrome / Edge kullanın veya kodu yazın.");
          return;
        }
        setHint("Barkodu çerçeveye yaklaştırın");
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
      video.srcObject = null;
      host.replaceChildren();
    };
  }, [active, continuous]);

  return (
    <View style={{ gap: 8 }}>
      {createElement("div", {
        ref: (el: HTMLDivElement | null) => {
          hostRef.current = el;
        },
        style: { width: "100%", minHeight: 260, borderRadius: 12, overflow: "hidden", background: "#000" },
      })}
      <Text style={{ color: "#CBD5E1", fontSize: 13 }}>{hint}</Text>
    </View>
  );
}

export function webBarcodeSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

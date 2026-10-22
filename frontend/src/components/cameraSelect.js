/** Kamera seçimi, çözünürlük ve odak — saf yardımcılar (CameraScanner test eder). */

const labelText = (deviceOrLabel) => {
  if (deviceOrLabel && typeof deviceOrLabel === "object") return deviceOrLabel.label || "";
  return deviceOrLabel || "";
};

/** "facing back" içindeki "fac" + "e" yüz kamerası sanılmasın. */
export function isFrontLabel(label) {
  const text = labelText(label).toLowerCase();
  if (!text) return false;
  if (/facing[\s_-]*(front|user)/.test(text)) return true;
  if (/\b(front|user|selfie)\b/.test(text)) return true;
  if (text.includes("ön")) return true;
  return false;
}

export function isBackLabel(label) {
  const text = labelText(label).toLowerCase();
  if (!text || isFrontLabel(text)) return false;
  return /back|rear|arka|environment|world/.test(text);
}

/** Sabit odaklı yardımcı lensler. Sanal "dual wide" bunun dışında tutulur. */
function isSpecialtyLens(label) {
  const text = labelText(label).toLowerCase();
  return /ultra|macro|telephoto|\btele\b|depth|desk|\bwide\b/.test(text);
}

/** iOS otomatik lens: triple, sonra dual wide, sonra dual. Eşleşme yoksa null. */
function virtualRank(label) {
  const text = labelText(label).toLowerCase();
  if (/back\s+triple\s+camera/.test(text)) return 0;
  if (/back\s+dual\s+wide\s+camera/.test(text)) return 1;
  if (/back\s+dual\s+camera/.test(text)) return 2;
  return null;
}

/** Sıra: sanal ana kameralar, düz arka kamera, diğer arka kameralar. Ön kamera yok. */
export function backCameraCandidates(devices) {
  if (!devices?.length) return [];
  const virtual = [];
  const plain = [];
  const other = [];
  devices.forEach((device, index) => {
    const rank = virtualRank(device?.label);
    if (rank != null) {
      virtual.push({ device, rank, index });
      return;
    }
    if (!isBackLabel(device?.label)) return;
    if (isSpecialtyLens(device?.label)) other.push(device);
    else plain.push(device);
  });
  virtual.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return [...virtual.map((item) => item.device), ...plain, ...other];
}

/**
 * Cihaz sırasına puan vermez.
 * (a) sanal arka kamera (b) düz arka / camera2 0 (c) ilk arka (d) ön olmayan ilk cihaz.
 * Etiketler boşsa null — çağıran facingMode ile açıp listeyi yeniler.
 * Ön kamera varsayılan olmaz.
 */
export function pickBackCamera(devices) {
  if (!devices?.length) return null;
  const hasLabel = devices.some((device) => (device?.label || "").trim());
  if (!hasLabel) return null;
  const ranked = backCameraCandidates(devices);
  if (ranked.length) return ranked[0];
  return devices.find((device) => (device?.label || "").trim() && !isFrontLabel(device.label)) || null;
}

/** Kamera değiştir: arka kameralar önce, ön kamera en sonda. */
export function orderCamerasForSwitch(devices) {
  if (!devices?.length) return [];
  if (!devices.some((device) => (device?.label || "").trim())) return devices.slice();
  const ranked = backCameraCandidates(devices);
  const seen = new Set(ranked.map((device) => device.id));
  const unknown = [];
  const fronts = [];
  devices.forEach((device) => {
    if (seen.has(device.id)) return;
    if (isFrontLabel(device.label)) fronts.push(device);
    else unknown.push(device);
  });
  return [...ranked, ...unknown, ...fronts];
}

function sizedConstraints(deviceId, width, height) {
  const video = {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: 30 },
    aspectRatio: { ideal: 16 / 9 },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = { ideal: "environment" };
  return video;
}

/** 1920x1080 ideal. min yok. deviceId varsa exact, facingMode ile karışmaz. */
export function buildVideoConstraints(deviceId) {
  return sizedConstraints(deviceId || null, 1920, 1080);
}

/** 1920x1080 → 1280x720 → yalnızca facingMode → true. exact facingMode yok. */
export function videoConstraintAttempts(deviceId) {
  const attempts = [];
  if (deviceId) {
    attempts.push(sizedConstraints(deviceId, 1920, 1080));
    attempts.push(sizedConstraints(deviceId, 1280, 720));
  }
  attempts.push(sizedConstraints(null, 1920, 1080));
  attempts.push(sizedConstraints(null, 1280, 720));
  attempts.push({ facingMode: { ideal: "environment" } });
  attempts.push(true);
  return attempts;
}

export function html5CameraConfig(deviceId) {
  if (deviceId) return { deviceId: { exact: deviceId } };
  return { facingMode: "environment" };
}

/** html5-qrcode videoConstraints verilince cameraId'yi yok sayar; kısıt burada da taşınır. */
export function html5VideoConstraints(deviceId, quality = "high") {
  const low = quality === "low";
  return sizedConstraints(deviceId || null, low ? 1280 : 1920, low ? 720 : 1080);
}

export function stopStream(stream) {
  try {
    stream?.getTracks?.().forEach((track) => {
      try { track.stop(); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

export function preferredZoom(zoom) {
  if (!zoom || typeof zoom.min !== "number" || typeof zoom.max !== "number") return null;
  const start = Math.min(Math.max(zoom.min, 1.5), zoom.max);
  if (start < 1) return null;
  return start;
}

/**
 * focusMode / zoom / exposure / white balance. Destek yoksa veya hata olursa sessiz.
 * Başlangıç zoom: min(max(min, 1.5), max) — 1'in altına inmez.
 */
export async function applyFocusTuning(track) {
  if (!track || typeof track.getCapabilities !== "function" || typeof track.applyConstraints !== "function") {
    return {};
  }
  let caps;
  try {
    caps = track.getCapabilities() || {};
  } catch {
    return {};
  }
  const advanced = {};
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
    advanced.focusMode = "continuous";
  }
  const zoom = preferredZoom(caps.zoom);
  if (zoom != null) advanced.zoom = zoom;
  if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) {
    advanced.exposureMode = "continuous";
  }
  if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes("continuous")) {
    advanced.whiteBalanceMode = "continuous";
  }
  if (!Object.keys(advanced).length) return caps;
  try {
    const pending = track.applyConstraints({ advanced: [advanced] });
    if (pending && typeof pending.then === "function") await pending;
  } catch { /* sessiz */ }
  return caps;
}

/** Dokunulan noktaya odak. pointsOfInterest varsa single-shot, 1 sn sonra continuous. */
export async function applyTapFocus(track, x, y) {
  if (!track || typeof track.getCapabilities !== "function" || typeof track.applyConstraints !== "function") {
    return null;
  }
  let caps;
  try {
    caps = track.getCapabilities() || {};
  } catch {
    return null;
  }
  const nx = Math.min(1, Math.max(0, Number(x) || 0));
  const ny = Math.min(1, Math.max(0, Number(y) || 0));
  try {
    if (caps.pointsOfInterest) {
      const advanced = { pointsOfInterest: [{ x: nx, y: ny }] };
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes("single-shot")) {
        advanced.focusMode = "single-shot";
      }
      const pending = track.applyConstraints({ advanced: [advanced] });
      if (pending && typeof pending.then === "function") await pending;
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
        return {
          revertMs: 1000,
          revert: () => {
            try {
              const again = track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
              if (again && typeof again.then === "function") again.catch(() => {});
            } catch { /* sessiz */ }
          },
        };
      }
      return null;
    }
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
      const pending = track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      if (pending && typeof pending.then === "function") await pending;
    }
  } catch { /* sessiz */ }
  return null;
}

export async function openVideoStream(getUserMedia, deviceId) {
  if (typeof getUserMedia !== "function") throw new Error("Kamera yok");
  let lastErr;
  for (const video of videoConstraintAttempts(deviceId)) {
    try {
      return await getUserMedia({ audio: false, video });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Kamera açılamadı");
}

/** Etiket yoksa veya liste boşsa environment ile izin al, sonra yeniden say. */
export async function resolveCameraDevices(listDevices, getUserMedia) {
  let devices = [];
  try {
    devices = (await listDevices()) || [];
  } catch {
    devices = [];
  }
  const missingLabels = !devices.length || devices.every((device) => !(device?.label || "").trim());
  if (!missingLabels || typeof getUserMedia !== "function") return devices;
  let stream = null;
  try {
    stream = await getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
  } catch { /* izin veya kamera yok */ }
  finally { stopStream(stream); }
  try {
    const again = await listDevices();
    if (Array.isArray(again) && again.length) return again;
  } catch { /* ilk liste */ }
  return devices;
}

/** En fazla 3 arka kamera dener; continuous focus olanı seçer. Her denemede akışı kapatır. */
export async function selectBackCamera(devices, getUserMedia) {
  const picked = pickBackCamera(devices);
  if (!picked || typeof getUserMedia !== "function") return picked;
  const candidates = backCameraCandidates(devices).slice(0, 3);
  if (candidates.length < 2) return picked;
  for (const device of candidates) {
    let stream = null;
    try {
      stream = await getUserMedia({ audio: false, video: buildVideoConstraints(device.id) });
      const track = stream?.getVideoTracks?.()?.[0];
      let caps = {};
      try { caps = track?.getCapabilities?.() || {}; } catch { caps = {}; }
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) return device;
    } catch { /* sonraki aday */ }
    finally { stopStream(stream); }
  }
  return picked;
}

export function trackFromScanner(scanner) {
  if (!scanner) return null;
  const hasCaps = typeof scanner.getRunningTrackCapabilities === "function";
  const hasApply = typeof scanner.applyVideoConstraints === "function";
  if (!hasCaps && !hasApply) return null;
  return {
    getCapabilities() {
      if (!hasCaps) return {};
      try { return scanner.getRunningTrackCapabilities() || {}; } catch { return {}; }
    },
    applyConstraints(constraints) {
      if (!hasApply) return Promise.resolve();
      return scanner.applyVideoConstraints(constraints);
    },
  };
}

export function prepareVideoElement(video) {
  if (!video) return;
  try {
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    if (video.style) video.style.objectFit = "cover";
  } catch { /* ignore */ }
}

export async function playVideoElement(video) {
  prepareVideoElement(video);
  if (!video || typeof video.play !== "function") return false;
  try {
    const pending = video.play();
    if (pending && typeof pending.then === "function") await pending;
    return true;
  } catch {
    return false;
  }
}

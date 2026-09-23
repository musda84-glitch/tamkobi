export const TAMKOBI_NOTIFY_SRC = "/sounds/tamkobi.wav";

let unlocked = false;
let audio;

function getAudio() {
  if (typeof Audio === "undefined") return null;
  if (!audio) {
    audio = new Audio(TAMKOBI_NOTIFY_SRC);
    audio.preload = "auto";
    audio.volume = 0.72;
  }
  return audio;
}

/** İlk tıklamada tarayıcı autoplay kilidini açar. */
export function unlockTamkobiNotify() {
  const el = getAudio();
  if (!el || unlocked) return;
  const prev = el.volume;
  el.volume = 0;
  el.play()
    .then(() => {
      el.pause();
      el.currentTime = 0;
      el.volume = prev;
      unlocked = true;
    })
    .catch(() => {
      el.volume = prev;
    });
}

export function playTamkobiNotify() {
  const el = getAudio();
  if (!el) return false;
  try {
    el.currentTime = 0;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** İlk yüklemede çalma; sonra yeni id gelince çal. */
export function notifySoundPlan(prevSeen, incomingIds, seeded) {
  const next = (incomingIds || []).map((id) => String(id || "")).filter(Boolean);
  const seen = (prevSeen || []).map((id) => String(id || "")).filter(Boolean);
  if (!seeded) return { play: false, seen: next, seeded: true };
  const known = new Set(seen);
  const fresh = next.filter((id) => !known.has(id));
  const merged = [...seen];
  for (const id of next) {
    if (!known.has(id)) {
      known.add(id);
      merged.push(id);
    }
  }
  return { play: fresh.length > 0, seen: merged.slice(-80), seeded: true };
}

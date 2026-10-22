/** Sayfa kapanışı ve yanıtsız ağ hatası için güncelleme modalı kararı. */

import axios from "axios";
import {
  isGatewayTransportError,
  isUpdateTransportError,
} from "./platformNotices";

const PROBE_TIMEOUT_MS = 2500;

let pageUnloading = false;
let unloadGuardInstalled = false;
let probeInflight = null;
let probeGeneration = 0;

export function isPageUnloading() {
  return pageUnloading;
}

export function markPageUnloading() {
  pageUnloading = true;
}

/** pagehide / beforeunload: yenileme sırasında iptal olan istekler modal açmasın. */
export function installPageUnloadGuard() {
  if (unloadGuardInstalled || typeof window === "undefined") return;
  unloadGuardInstalled = true;
  window.addEventListener("pagehide", markPageUnloading);
  window.addEventListener("beforeunload", markPageUnloading);
}

export function resetTransportOutageForTests() {
  pageUnloading = false;
  probeInflight = null;
  probeGeneration += 1;
}

/** Bayrak açıkken veya axios iptalinde olay da modal da üretilmez. */
export function shouldIgnoreTransportError(err) {
  if (pageUnloading) return true;
  if (typeof axios.isCancel === "function" && axios.isCancel(err)) return true;
  return false;
}

function versionUrl() {
  const base = process.env.REACT_APP_BACKEND_URL || "";
  return `${base}/api/version`;
}

/**
 * Mevcut /api/version. Axios interceptor'ına girmez (fetch).
 * Ulaşılabiliyorsa true; ağ hatası, zaman aşımı veya 502/503/504 ise false.
 */
async function probeVersionReachable() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(versionUrl(), {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.status === 502 || res.status === 503 || res.status === 504) return false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Aynı anda gelen hatalar tek doğrulamayı paylaşır. */
function probeShared() {
  if (!probeInflight) {
    const gen = probeGeneration;
    const run = probeVersionReachable();
    probeInflight = run;
    run.finally(() => {
      if (probeGeneration === gen && probeInflight === run) probeInflight = null;
    });
  }
  return probeInflight;
}

/**
 * 502/503/504: hemen bildir.
 * Yanıtsız ağ hatası: önce /api/version; o da düşerse bildir.
 * Kapanış ve iptal: hiçbir şey yapma.
 */
export function considerTransportFailure(err, onShow) {
  if (typeof onShow !== "function" || shouldIgnoreTransportError(err) || !isUpdateTransportError(err)) return;
  if (isGatewayTransportError(err)) {
    onShow();
    return;
  }
  const gen = probeGeneration;
  probeShared().then((up) => {
    if (gen !== probeGeneration || up || shouldIgnoreTransportError(err)) return;
    onShow();
  }).catch(() => {});
}

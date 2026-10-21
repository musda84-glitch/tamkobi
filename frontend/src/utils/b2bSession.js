import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../api/client";
import { parseHeldCarts, parseStoredCart } from "./b2bCart";

/** sessionStorage anahtarı. Değer ham select_token; adreste ve çerezde durmaz. */
export const B2B_SESSION_KEY = "b2b_session";
export const B2B_SESSION_EMAIL_KEY = "b2b_session_email";
/** Cari → portal token eşlemesi. Sepet anahtarı değildir; sepet b2b_cart_<portalToken> olarak kalır. */
export const B2B_PORTAL_MAP_KEY = "b2b_contact_portals";

const AVATAR_COLORS = ["bg-blue-600", "bg-emerald-600", "bg-amber-500", "bg-violet-600", "bg-rose-600"];

export function readB2BSession() {
  try {
    return String(sessionStorage.getItem(B2B_SESSION_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function readB2BSessionEmail() {
  try {
    return String(sessionStorage.getItem(B2B_SESSION_EMAIL_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function writeB2BSession(selectToken, email) {
  const token = String(selectToken || "").trim();
  if (!token) return;
  sessionStorage.setItem(B2B_SESSION_KEY, token);
  const mail = String(email || "").trim();
  if (mail) sessionStorage.setItem(B2B_SESSION_EMAIL_KEY, mail);
}

/** Yalnız seçim oturumunu siler. Uygulama çerezine ve b2b_cart_* anahtarlarına dokunmaz. */
export function clearB2BSession() {
  try { sessionStorage.removeItem(B2B_SESSION_KEY); } catch { /* gizli mod */ }
  try { sessionStorage.removeItem(B2B_SESSION_EMAIL_KEY); } catch { /* gizli mod */ }
}

export function b2bSessionHeaders(selectToken) {
  const token = String(selectToken || "").trim();
  if (!token) return {};
  return { Authorization: `B2bSession ${token}` };
}

/** select_token sorgu dizesine, çıpaya veya açık yönlendirmeye yazılmaz. */
export function isSafeB2BPath(path) {
  const value = String(path || "").trim();
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//") || value.includes("\\") || value.includes("?") || value.includes("#")) return false;
  if (value.toLowerCase().includes("select_token")) return false;
  if (value === "/b2b/giris" || value === "/b2b/tedarikci") return true;
  return /^\/portal\/[^/]+$/.test(value);
}

export const b2bNav = {
  go(path) {
    if (!isSafeB2BPath(path) || typeof window === "undefined") return;
    window.location.href = path;
  },
};

function hasStoredB2BCart() {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) || "";
      if (key.startsWith("b2b_cart_")) {
        const cart = parseStoredCart(localStorage.getItem(key) || "{}");
        if (Object.values(cart).some((row) => (Number(row?.qty) || 0) > 0)) return true;
      } else if (key.startsWith("b2b_held_carts_")) {
        if (parseHeldCarts(localStorage.getItem(key) || "[]").length) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** Oturumu kapatır. Sepet anahtarlarına ve panel oturumuna dokunmaz. */
export function logoutB2B() {
  const token = readB2BSession();
  const keepCartNotice = hasStoredB2BCart();
  if (token) {
    try {
      const pending = axios.post(`${API_URL}/public/b2b/logout`, { select_token: token }, {
        headers: { Authorization: `B2BSession ${token}` },
      });
      if (pending && typeof pending.then === "function") pending.catch(() => {});
    } catch { /* uç hata verse de yerel çıkış sürer */ }
  }
  clearB2BSession();
  try { localStorage.removeItem(B2B_PORTAL_MAP_KEY); } catch { /* gizli mod */ }
  if (keepCartNotice) {
    try { toast.message("Sepetiniz bu cihazda saklandı."); } catch { /* toast yok */ }
  }
  b2bNav.go("/b2b/giris");
}

export function portalTokenFromPath(path) {
  if (!isSafeB2BPath(path) || !String(path).startsWith("/portal/")) return "";
  return String(path).slice("/portal/".length);
}

export function rememberContactPortal(contactId, portalToken) {
  const id = String(contactId || "").trim();
  const token = String(portalToken || "").trim();
  if (!id || !token) return;
  let map = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(B2B_PORTAL_MAP_KEY) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) map = parsed;
  } catch {
    map = {};
  }
  map[id] = token;
  try { localStorage.setItem(B2B_PORTAL_MAP_KEY, JSON.stringify(map)); } catch { /* dolu depo */ }
}

export function contactPortalToken(contactId) {
  const id = String(contactId || "").trim();
  if (!id) return "";
  try {
    const parsed = JSON.parse(localStorage.getItem(B2B_PORTAL_MAP_KEY) || "{}");
    return String(parsed?.[id] || "").trim();
  } catch {
    return "";
  }
}

/** Portal token'ına ait yerel sepet adedi. Başka tedarikçinin sepetine bakmaz. */
export function storedCartUnits(portalToken) {
  const token = String(portalToken || "").trim();
  if (!token) return 0;
  try {
    const cart = parseStoredCart(localStorage.getItem(`b2b_cart_${token}`) || "{}");
    return Object.values(cart).reduce((sum, row) => sum + (Number(row?.qty) || 0), 0);
  } catch {
    return 0;
  }
}

export function supplierCartUnits(contactId) {
  return storedCartUnits(contactPortalToken(contactId));
}

export function supplierInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "•";
  const first = parts[0];
  const second = parts[1];
  const raw = second ? `${first[0] || ""}${second[0] || ""}` : first.slice(0, 2);
  return raw.toLocaleUpperCase("tr-TR");
}

export function supplierAvatarClass(name) {
  const text = String(name || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash + text.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash];
}

export async function selectB2BSupplier(contactId) {
  const selectToken = readB2BSession();
  const id = String(contactId || "").trim();
  if (!selectToken || !id) {
    const error = new Error("Oturum bulunamadı.");
    error.response = { status: 401, data: { detail: "Oturum bulunamadı. Yeniden giriş yapın." } };
    throw error;
  }
  const res = await axios.post(`${API_URL}/public/b2b/select-supplier`, {
    select_token: selectToken,
    contact_id: id,
  });
  const path = String(res.data?.redirect || "");
  if (!isSafeB2BPath(path)) {
    const error = new Error("Portal açılamadı.");
    error.response = { data: { detail: "Portal açılamadı." } };
    throw error;
  }
  rememberContactPortal(id, portalTokenFromPath(path));
  return path;
}

export function supplierErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  return fallback;
}

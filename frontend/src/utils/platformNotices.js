/** Platform bakım / duyuru pop-up yardımcıları. */

const DISMISS_PREFIX = "tk_platform_notice_dismissed:";

export function dismissKey(id) {
  return `${DISMISS_PREFIX}${id || "unknown"}`;
}

export function isDismissed(id, storage = localStorage) {
  if (!id || !storage) return false;
  try {
    return storage.getItem(dismissKey(id)) === "1";
  } catch {
    return false;
  }
}

export function dismissNotice(id, storage = localStorage) {
  if (!id || !storage) return;
  try {
    storage.setItem(dismissKey(id), "1");
  } catch {
    /* private mode */
  }
}

export function clearDismiss(id, storage = localStorage) {
  if (!id || !storage) return;
  try {
    storage.removeItem(dismissKey(id));
  } catch {
    /* ignore */
  }
}

/** Bakım aktifken veya duyuru listesinde gösterilecek sıradaki pop-up. */
export function pickVisibleNotice(payload, storage = localStorage) {
  if (!payload) return null;
  const m = payload.maintenance;
  if (m && m.active) {
    return {
      id: "maintenance-active",
      title: m.title || "Sistem Güncellemesi",
      body: m.body || "",
      kind: "maintenance",
      activeUpdate: true,
      support_email: m.support_email,
      support_phone: m.support_phone,
      dismissible: false,
    };
  }
  const announcements = Array.isArray(payload.announcements) ? payload.announcements : [];
  for (const a of announcements) {
    const id = a.id || a._id;
    if (!id || isDismissed(id, storage)) continue;
    return {
      id,
      title: a.title || "Duyuru",
      body: a.body || "",
      kind: a.kind || "info",
      activeUpdate: false,
      dismissible: true,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
    };
  }
  // Zamanlanmış bakım (henüz başlamadı) — pop-up olarak duyuru listesinde yoksa göster
  if (m && m.upcoming && m.notify_popup !== false) {
    const id = "maintenance-upcoming";
    if (!isDismissed(id, storage)) {
      return {
        id,
        title: m.title || "Planlı Güncelleme",
        body: m.body || "",
        kind: "maintenance",
        activeUpdate: false,
        dismissible: true,
        support_email: m.support_email,
        support_phone: m.support_phone,
        starts_at: m.starts_at,
        ends_at: m.ends_at,
      };
    }
  }
  return null;
}

/** 502/503 veya ağ kopması → güncelleme mesajı mı? */
export function isUpdateTransportError(err) {
  if (!err) return false;
  const status = err.response?.status || err.status;
  if (status === 502 || status === 503 || status === 504) return true;
  if (!err.response && (err.code === "ERR_NETWORK" || /network|failed to fetch/i.test(String(err.message || "")))) {
    return true;
  }
  return false;
}

export const UPDATE_FALLBACK_NOTICE = {
  id: "update-transport",
  title: "Sistem Güncellemesi Yapılıyor",
  body:
    "Değerli Kullanıcımız,\n\n" +
    "Sistemimizde güncelleme yapılmaktadır. Bu nedenle bağlantı geçici olarak kesilmiş olabilir.\n\n" +
    "Lütfen birkaç dakika sonra sayfayı yenileyerek tekrar deneyin.\n\n" +
    "Anlayışınız için teşekkür ederiz.",
  kind: "maintenance",
  activeUpdate: true,
  dismissible: false,
};

export function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocalValue(local) {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

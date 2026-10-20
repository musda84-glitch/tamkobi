import { toast } from "sonner";

const seen = new WeakSet();

export function isMesaimLockedError(err) {
  return err?.response?.status === 403 && err?.response?.data?.code === "mesaim_locked";
}

/** 403 mesaim_locked: bir kez toast + kapı yenilemesi. Çift interceptor aynı hatayı tekrarlamaz. */
export function notifyMesaimLocked(err, refresh) {
  if (!isMesaimLockedError(err)) return false;
  if (err && typeof err === "object") {
    if (seen.has(err)) return true;
    try {
      seen.add(err);
    } catch {
      /* ignore */
    }
  }
  const detail = err.response?.data?.detail;
  toast.error(typeof detail === "string" && detail.trim() ? detail : "Mesai çıkışı yapıldı. Diğer ekranlar bir sonraki mesai girişinize kadar kapalı.");
  if (typeof refresh === "function") {
    Promise.resolve(refresh()).catch(() => {});
  }
  return true;
}

/** Axios yanıt zinciri. Mock istemcide interceptors yoksa no-op. */
export function bindMesaimLockedInterceptor(client, refresh) {
  const bag = client?.interceptors?.response;
  if (!bag || typeof bag.use !== "function") return () => {};
  const id = bag.use(
    (res) => res,
    (err) => {
      notifyMesaimLocked(err, refresh);
      return Promise.reject(err);
    },
  );
  return () => {
    if (typeof bag.eject === "function") bag.eject(id);
  };
}

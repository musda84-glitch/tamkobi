import { isOnline, onlineOnlyBlock } from "./policy";

export function installOfflineGuard(axios) {
  if (!axios || axios.__tamkobiOfflineGuard) return;
  const request = axios.interceptors?.request;
  if (!request || typeof request.use !== "function") return;
  axios.__tamkobiOfflineGuard = true;
  request.use((config) => {
    const url = `${config?.baseURL || ""}${config?.url || ""}`;
    const block = onlineOnlyBlock(url, { online: isOnline() });
    if (!block) return config;
    const err = new Error(block.message);
    err.code = block.code;
    err.response = { status: 503, data: { detail: block.message, code: block.code } };
    return Promise.reject(err);
  });
}

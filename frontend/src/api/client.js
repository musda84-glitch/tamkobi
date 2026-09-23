
/** Shared API origin. Import this module once from index.js so every axios call sends cookies. */
import axios from "axios";
import { isUpdateTransportError } from "../utils/platformNotices";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
export const API_URL = `${BACKEND_URL}/api`;

axios.defaults.withCredentials = true;

/** 502/503/ağ hatalarında hata sayfası yerine güncelleme bilgisini tetikle. */
if (typeof window !== "undefined" && !axios.__tamkobiNoticeInterceptor) {
  axios.__tamkobiNoticeInterceptor = true;
  axios.interceptors.response.use(
    (res) => res,
    (err) => {
      try {
        if (isUpdateTransportError(err)) {
          window.dispatchEvent(new CustomEvent("tamkobi:api-error", { detail: err }));
        }
      } catch {
        /* ignore */
      }
      return Promise.reject(err);
    },
  );
}

export default axios;

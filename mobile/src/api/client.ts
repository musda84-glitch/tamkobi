import { isMesaimLockedBody, notifyMesaimLocked } from "../auth/mesaimLockSignal";
import { saveApiBase } from "../auth/storage";
import { ApiHttpError, apiErrorMessage } from "./errors";
import {
  API_BASE_HEADER,
  apiRoot,
  applyRedirectedApiBase,
  displayFileUrl,
  fileUrl,
  isAllowedApiRedirectUrl,
  isPermanentRedirect,
  normalizeApiBase,
  redirectBaseFromFinalUrl,
  redirectBaseFromLocation,
  requestTarget,
} from "./url";

export type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  if (!parts.length) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${parts.join("&")}`;
}

export type ApiClient = {
  baseUrl: string;
  token: string | null;
};

async function persistRedirectBase(next: string): Promise<string> {
  const applied = applyRedirectedApiBase(next);
  try {
    await saveApiBase(applied);
  } catch {
    /* AsyncStorage yoksa oturum override yeterli */
  }
  return applied;
}

type FetchInit = {
  method: string;
  headers: Record<string, string>;
  body?: string | FormData;
};

/**
 * 301/308 gelirse Location host’una bir kez yeniden dener ve kaydeder.
 * Diğer 3xx yanıtlar Location’a follow edilir.
 */
async function fetchApi(
  client: ApiClient,
  pathWithQuery: string,
  init: FetchInit,
): Promise<Response> {
  let base = client.baseUrl;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { url, proxiedBase } = requestTarget(base, pathWithQuery);
    const headers = { ...init.headers };
    if (proxiedBase) headers[API_BASE_HEADER] = proxiedBase;
    else delete headers[API_BASE_HEADER];

    // RN redirect:"manual" desteklemeyebilir — yine de dene; final url ile de kontrol edilir.
    const res = await fetch(url, {
      method: init.method,
      headers,
      body: init.body,
      redirect: "manual",
    });

    if (attempt === 0 && isPermanentRedirect(res.status)) {
      const next = redirectBaseFromLocation(res.headers.get("Location"), base);
      if (next) {
        base = await persistRedirectBase(next);
        continue;
      }
      // http / yabancı host → kaydetme, token ile takip etme
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location");
      if (loc) {
        const abs = /^https?:\/\//i.test(loc) ? loc : new URL(loc, url).href;
        if (!isAllowedApiRedirectUrl(abs)) {
          // Token gönderme / kaydetme yok — yönlendirme yanıtını olduğu gibi bırak
          return res;
        }
        return fetch(abs, {
          method: init.method,
          headers,
          body: init.body,
          redirect: "follow",
        });
      }
      return res;
    }

    // Manuel redirect yoksa (RN otomatik takip): host değiştiyse izinliyse kaydet + bir kez tekrarla
    if (attempt === 0) {
      const next = redirectBaseFromFinalUrl(
        typeof res.url === "string" ? res.url : null,
        base,
        Boolean((res as { redirected?: boolean }).redirected),
      );
      if (next) {
        base = await persistRedirectBase(next);
        continue;
      }
    }

    return res;
  }
  throw new ApiHttpError(0, null, "Yönlendirme sonrası istek tamamlanamadı.");
}

export async function request<T>(
  client: ApiClient,
  method: string,
  path: string,
  opts?: { body?: unknown; query?: Query }
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Tamkobi-Client": "mobile" };
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json";
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  let res: Response;
  try {
    res = await fetchApi(client, withQuery(path, opts?.query), {
      method,
      headers,
      body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(0, null, apiErrorMessage(err, "Sunucuya bağlanılamadı. API adresini kontrol edin."));
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  if (!res.ok) failResponse(res.status, data, `HTTP ${res.status}`);
  return data as T;
}

/** Multipart yükleme: Content-Type'ı fetch kendisi (boundary ile) koyar. */
export async function upload<T>(client: ApiClient, path: string, form: FormData, query?: Query): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Tamkobi-Client": "mobile" };
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  let res: Response;
  try {
    res = await fetchApi(client, withQuery(path, query), {
      method: "POST",
      headers,
      body: form,
    });
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(0, null, apiErrorMessage(err, "Dosya yüklenemedi. Bağlantıyı kontrol edin."));
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  if (!res.ok) failResponse(res.status, data, `HTTP ${res.status}`);
  return data as T;
}

function failResponse(status: number, data: unknown, fallback: string): never {
  if (status === 403 && isMesaimLockedBody(data)) notifyMesaimLocked();
  const message = apiErrorMessage({ status, response: { data, status } }, fallback);
  throw new ApiHttpError(status, (data as { detail?: unknown } | null)?.detail, message);
}

export const get = <T,>(c: ApiClient, path: string, query?: Query) => request<T>(c, "GET", path, { query });
export const post = <T,>(c: ApiClient, path: string, body?: unknown, query?: Query) =>
  request<T>(c, "POST", path, { body: body ?? {}, query });
export const put = <T,>(c: ApiClient, path: string, body?: unknown, query?: Query) =>
  request<T>(c, "PUT", path, { body: body ?? {}, query });
export const del = <T,>(c: ApiClient, path: string, query?: Query) => request<T>(c, "DELETE", path, { query });

export { normalizeApiBase, apiRoot, fileUrl, displayFileUrl };

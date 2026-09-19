import { ApiHttpError, apiErrorMessage } from "./errors";
import { API_BASE_HEADER, apiRoot, fileUrl, normalizeApiBase, requestTarget } from "./url";

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

export async function request<T>(
  client: ApiClient,
  method: string,
  path: string,
  opts?: { body?: unknown; query?: Query }
): Promise<T> {
  const { url, proxiedBase } = requestTarget(client.baseUrl, withQuery(path, opts?.query));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json";
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  if (proxiedBase) headers[API_BASE_HEADER] = proxiedBase;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (err) {
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
  if (!res.ok) {
    const message = apiErrorMessage({ status: res.status, response: { data, status: res.status } }, `HTTP ${res.status}`);
    throw new ApiHttpError(res.status, (data as { detail?: unknown })?.detail, message);
  }
  return data as T;
}

/** Multipart yükleme: Content-Type'ı fetch kendisi (boundary ile) koyar. */
export async function upload<T>(client: ApiClient, path: string, form: FormData, query?: Query): Promise<T> {
  const { url, proxiedBase } = requestTarget(client.baseUrl, withQuery(path, query));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  if (proxiedBase) headers[API_BASE_HEADER] = proxiedBase;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: form });
  } catch (err) {
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
  if (!res.ok) {
    throw new ApiHttpError(res.status, (data as { detail?: unknown })?.detail, apiErrorMessage({ status: res.status, response: { data, status: res.status } }, `HTTP ${res.status}`));
  }
  return data as T;
}

export const get = <T,>(c: ApiClient, path: string, query?: Query) => request<T>(c, "GET", path, { query });
export const post = <T,>(c: ApiClient, path: string, body?: unknown, query?: Query) =>
  request<T>(c, "POST", path, { body: body ?? {}, query });
export const put = <T,>(c: ApiClient, path: string, body?: unknown, query?: Query) =>
  request<T>(c, "PUT", path, { body: body ?? {}, query });
export const del = <T,>(c: ApiClient, path: string, query?: Query) => request<T>(c, "DELETE", path, { query });

export { normalizeApiBase, apiRoot, fileUrl };

/**
 * Ağ etiket yazıcısı (Xprinter XP-490B): cihaz ayarı + ham TCP :9100.
 * TSPL metni tspl.ts içindedir; bu dosya saklama ve gönderimdir.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ApiClient } from "../api/client";
import { get, put } from "../api/client";
import {
  buildProductLabel,
  buildShipmentBatch,
  buildTestLabel,
  buildWorkOrderLabel,
  clampCopies,
  clampMm,
  isSerialBaudPort,
  type LabelSize,
  type ProductLabelInput,
  type ShipmentLabelInput,
  type TsplJob,
  type WorkOrderLabelInput,
} from "./tspl";

export const LABEL_PRINTER_KEY = "tamkobi_label_printer_v1";

export type LabelPrinterSettings = {
  name: string;
  host: string;
  port: number;
  widthMm: number;
  heightMm: number;
  gapMm: number;
  dpi: 203 | 300;
  textMode: "codepage" | "bitmap";
};

export type CompanyLabelPrinter = {
  name?: string;
  host?: string;
  port?: number;
  width_mm?: number;
  height_mm?: number;
  gap_mm?: number;
  dpi?: number;
  text_mode?: string;
  configured?: boolean;
};

export function defaultLabelPrinter(): LabelPrinterSettings {
  return {
    name: "Xprinter XP-490B",
    host: "",
    port: 9100,
    widthMm: 100,
    heightMm: 50,
    gapMm: 2,
    dpi: 203,
    textMode: "codepage",
  };
}

export function normalizeLabelPrinter(raw: Partial<LabelPrinterSettings> | null | undefined): LabelPrinterSettings {
  const base = defaultLabelPrinter();
  const src = raw || {};
  const portNum = Number(src.port);
  let port = 9100;
  if (Number.isFinite(portNum) && portNum > 0) {
    port = isSerialBaudPort(portNum) ? 9100 : Math.max(1, Math.min(65535, Math.round(portNum)));
  }
  const dpi = Number(src.dpi) === 300 ? 300 : 203;
  return {
    name: String(src.name || base.name).trim().slice(0, 80) || base.name,
    host: String(src.host || "").trim(),
    port,
    widthMm: clampMm(src.widthMm, base.widthMm, 20, 120),
    heightMm: clampMm(src.heightMm, base.heightMm, 10, 300),
    gapMm: clampMm(src.gapMm, base.gapMm, 0, 25),
    dpi,
    textMode: src.textMode === "bitmap" ? "bitmap" : "codepage",
  };
}

export function labelPrinterConfigError(settings: Partial<LabelPrinterSettings> | null | undefined): string | null {
  const host = String(settings?.host || "").trim();
  if (!host) return "Yazıcı IP adresi girin (örn. 192.168.1.117).";
  if (isSerialBaudPort(settings?.port)) {
    return (
      `Port ${settings?.port} seri baud hızıdır (yazıcı konfig etiketi), Ethernet ham port değil. `
      + "XP-490B için port 9100 kullanın."
    );
  }
  const port = Number(settings?.port ?? 9100);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return "Port 1–65535 arasında olmalı. Varsayılan 9100.";
  return null;
}

export function labelSizeOf(settings: Pick<LabelPrinterSettings, "widthMm" | "heightMm" | "gapMm" | "dpi">): LabelSize {
  return {
    widthMm: settings.widthMm,
    heightMm: settings.heightMm,
    gapMm: settings.gapMm,
    dpi: settings.dpi,
  };
}

export function toCompanyLabelPrinter(settings: LabelPrinterSettings): CompanyLabelPrinter {
  return {
    name: settings.name,
    host: settings.host,
    port: settings.port,
    width_mm: settings.widthMm,
    height_mm: settings.heightMm,
    gap_mm: settings.gapMm,
    dpi: settings.dpi,
    text_mode: settings.textMode,
  };
}

export function fromCompanyLabelPrinter(raw: CompanyLabelPrinter | null | undefined): LabelPrinterSettings {
  return normalizeLabelPrinter({
    name: raw?.name,
    host: raw?.host,
    port: raw?.port,
    widthMm: raw?.width_mm,
    heightMm: raw?.height_mm,
    gapMm: raw?.gap_mm,
    dpi: raw?.dpi === 300 ? 300 : 203,
    textMode: raw?.text_mode === "bitmap" ? "bitmap" : "codepage",
  });
}

function storageKey(companyId?: string | null): string {
  const id = String(companyId || "").trim();
  return id ? `${LABEL_PRINTER_KEY}:${id}` : LABEL_PRINTER_KEY;
}

export async function loadLabelPrinter(companyId?: string | null): Promise<LabelPrinterSettings> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(companyId));
    if (!raw) return defaultLabelPrinter();
    return normalizeLabelPrinter(JSON.parse(raw) as Partial<LabelPrinterSettings>);
  } catch {
    return defaultLabelPrinter();
  }
}

export async function saveLabelPrinter(
  settings: Partial<LabelPrinterSettings>,
  companyId?: string | null,
): Promise<LabelPrinterSettings> {
  const prev = await loadLabelPrinter(companyId);
  const next = normalizeLabelPrinter({ ...prev, ...settings });
  await AsyncStorage.setItem(storageKey(companyId), JSON.stringify(next));
  return next;
}

export async function fetchCompanyLabelPrinter(
  client: ApiClient,
  companyId: string,
): Promise<LabelPrinterSettings & { configured: boolean }> {
  const raw = await get<CompanyLabelPrinter>(client, `/companies/${companyId}/label-printer`);
  return { ...fromCompanyLabelPrinter(raw), configured: !!raw?.configured && !!String(raw?.host || "").trim() };
}

export async function saveCompanyLabelPrinter(
  client: ApiClient,
  companyId: string,
  settings: LabelPrinterSettings,
): Promise<LabelPrinterSettings> {
  const raw = await put<CompanyLabelPrinter>(
    client,
    `/companies/${companyId}/label-printer`,
    toCompanyLabelPrinter(settings),
  );
  return fromCompanyLabelPrinter(raw);
}

export function printerTarget(host: string, port: number): string {
  return `${String(host).trim()}:${port}`;
}

export function printerErrorMessage(err: unknown, host: string, port: number): string {
  const where = printerTarget(host, port);
  const code = String((err as { code?: string })?.code || "");
  const raw = err instanceof Error ? err.message : String(err || "");
  const blob = `${code} ${raw}`;
  if (/zaman aşımı|timed?\s*out|ETIMEDOUT|ECONNABORTED|timeout/i.test(blob)) {
    return `Yazıcı zaman aşımına uğradı (${where}). Yazıcı açık mı ve telefon aynı Wi-Fi ağında mı?`;
  }
  if (/ECONNREFUSED|connection refused|bağlantıyı reddetti/i.test(blob)) {
    return `Yazıcı bağlantıyı reddetti (${where}). Port 9100 açık mı?`;
  }
  if (/EHOSTUNREACH|ENETUNREACH|ENETDOWN|unreachable|ulaşılamıyor/i.test(blob)) {
    return `Yazıcıya ağdan ulaşılamıyor (${where}). IP adresini ve yerel ağı kontrol edin.`;
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|çözülemedi/i.test(blob)) {
    return `Yazıcı adresi çözülemedi (${where}).`;
  }
  if (/EAS preview|Expo Go|react-native-tcp-socket|Tarayıcıdan ham TCP/i.test(raw)) return raw;
  if (raw.trim()) return `Yazıcı bağlantı hatası (${where}): ${raw.trim()}`;
  return `Yazıcıya bağlanılamadı (${where}).`;
}

export type TcpConnection = {
  write: (data: Uint8Array, onFlushed?: () => void) => void;
  on: (event: string, cb: (arg?: unknown) => void) => void;
  destroy: () => void;
};

export type TcpConnect = (opts: { host: string; port: number; timeoutMs: number }) => TcpConnection;

const CONNECT_TIMEOUT_MS = 8000;

function isBrowserPage(): boolean {
  return typeof document !== "undefined"
    && typeof navigator !== "undefined"
    && (navigator as { product?: string }).product !== "ReactNative";
}

export function defaultTcpConnect(opts: { host: string; port: number; timeoutMs: number }): TcpConnection {
  if (isBrowserPage()) {
    throw new Error("Tarayıcıdan ham TCP (port 9100) açılamaz. Etiket için EAS preview derlemesini kullanın.");
  }
  let TcpSocket: {
    createConnection: (
      options: Record<string, unknown>,
      cb?: () => void,
    ) => { write: (data: Uint8Array, encoding?: string, cb?: () => void) => void; on: TcpConnection["on"]; destroy: () => void };
  };
  try {
    // Native modül — Expo Go'da yok; EAS preview / dev build derler.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-tcp-socket") as { default?: typeof TcpSocket } & typeof TcpSocket;
    TcpSocket = (mod.default || mod) as typeof TcpSocket;
  } catch {
    throw new Error(
      "Doğrudan TCP için uygulama EAS preview derlemesi gerekir (react-native-tcp-socket). Expo Go ham porta bağlanamaz.",
    );
  }
  if (!TcpSocket?.createConnection) {
    throw new Error(
      "Doğrudan TCP için uygulama EAS preview derlemesi gerekir (react-native-tcp-socket). Expo Go ham porta bağlanamaz.",
    );
  }
  let native: ReturnType<typeof TcpSocket.createConnection> | null = null;
  const pending: Array<[string, (arg?: unknown) => void]> = [];
  const wrapped: TcpConnection = {
    write(data: Uint8Array, onFlushed?: () => void) {
      if (!native) throw new Error("Yazıcı soketi henüz açılmadı.");
      native.write(data, undefined, () => onFlushed?.());
    },
    on(event, cb) {
      if (native && typeof native.on === "function") native.on(event, cb);
      else pending.push([event, cb]);
    },
    destroy() {
      try { native?.destroy(); } catch { /* kapalı */ }
    },
  };
  native = TcpSocket.createConnection(
    { host: opts.host, port: opts.port, timeout: opts.timeoutMs },
    () => undefined,
  );
  if (native && typeof native.on === "function") {
    for (const [event, cb] of pending) native.on(event, cb);
  }
  return wrapped;
}

export async function sendRawToPrinter(opts: {
  host: string;
  port: number;
  bytes: Uint8Array;
  timeoutMs?: number;
  connect?: TcpConnect;
}): Promise<{ bytes: number }> {
  const host = String(opts.host || "").trim();
  const port = Number(opts.port) || 9100;
  const cfgErr = labelPrinterConfigError({ host, port });
  if (cfgErr) throw new Error(cfgErr);
  if (!opts.bytes?.length) throw new Error("Boş yazdırma verisi.");
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || CONNECT_TIMEOUT_MS);
  const connect = opts.connect || defaultTcpConnect;
  return new Promise((resolve, reject) => {
    let settled = false;
    let sock: TcpConnection | null = null;
    const finish = (err: Error | null, ok?: { bytes: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock?.destroy(); } catch { /* */ }
      if (err) reject(err);
      else resolve(ok || { bytes: opts.bytes.length });
    };
    const timer = setTimeout(() => {
      finish(new Error(printerErrorMessage({ code: "ETIMEDOUT", message: "timeout" }, host, port)));
    }, timeoutMs);
    try {
      sock = connect({ host, port, timeoutMs });
    } catch (err) {
      finish(err instanceof Error ? err : new Error(printerErrorMessage(err, host, port)));
      return;
    }
    sock.on("error", (err) => finish(new Error(printerErrorMessage(err, host, port))));
    sock.on("timeout", () => finish(new Error(printerErrorMessage({ code: "ETIMEDOUT" }, host, port))));
    sock.on("connect", () => {
      try {
        let flushed = false;
        let fallback: ReturnType<typeof setTimeout> | null = null;
        const ok = () => {
          if (flushed) return;
          flushed = true;
          if (fallback) clearTimeout(fallback);
          finish(null, { bytes: opts.bytes.length });
        };
        fallback = setTimeout(ok, 500);
        sock?.write(opts.bytes, ok);
      } catch (err) {
        finish(new Error(printerErrorMessage(err, host, port)));
      }
    });
  });
}

export async function printTsplJob(
  job: TsplJob,
  settings: LabelPrinterSettings,
  connect?: TcpConnect,
): Promise<{ bytes: number }> {
  const cfgErr = labelPrinterConfigError(settings);
  if (cfgErr) throw new Error(cfgErr);
  if (!job?.bytes?.length) throw new Error("Boş yazdırma verisi.");
  try {
    return await sendRawToPrinter({
      host: settings.host,
      port: settings.port,
      bytes: job.bytes,
      connect,
    });
  } catch (err) {
    if (err instanceof Error && /Yazıcı|Tarayıcıdan|EAS preview/.test(err.message)) throw err;
    throw new Error(printerErrorMessage(err, settings.host, settings.port));
  }
}

export async function printProductLabel(opts: {
  settings: LabelPrinterSettings;
  product: Omit<ProductLabelInput, "size" | "textMode" | "copies">;
  copies?: number;
  connect?: TcpConnect;
}): Promise<{ bytes: number }> {
  const job = buildProductLabel({
    ...opts.product,
    copies: clampCopies(opts.copies),
    size: labelSizeOf(opts.settings),
    textMode: opts.settings.textMode,
  });
  return printTsplJob(job, opts.settings, opts.connect);
}

export async function printWorkOrderLabel(opts: {
  settings: LabelPrinterSettings;
  order: Omit<WorkOrderLabelInput, "size" | "textMode" | "copies">;
  copies?: number;
  connect?: TcpConnect;
}): Promise<{ bytes: number }> {
  const job = buildWorkOrderLabel({
    ...opts.order,
    copies: clampCopies(opts.copies),
    size: labelSizeOf(opts.settings),
    textMode: opts.settings.textMode,
  });
  return printTsplJob(job, opts.settings, opts.connect);
}

export async function printShipmentLabels(opts: {
  settings: LabelPrinterSettings;
  shipment: Omit<ShipmentLabelInput, "size" | "textMode" | "copies" | "packageIndex" | "packageTotal"> & {
    packageTotal?: number;
  };
  connect?: TcpConnect;
}): Promise<{ bytes: number }> {
  const job = buildShipmentBatch({
    ...opts.shipment,
    size: labelSizeOf(opts.settings),
    textMode: opts.settings.textMode,
  });
  return printTsplJob(job, opts.settings, opts.connect);
}

export async function printTestLabel(
  settings: LabelPrinterSettings,
  connect?: TcpConnect,
): Promise<{ bytes: number }> {
  const job = buildTestLabel({
    name: settings.name,
    host: settings.host,
    port: settings.port,
    size: labelSizeOf(settings),
    textMode: settings.textMode,
  });
  return printTsplJob(job, settings, connect);
}

/**
 * Ethernet / IP etiket yazıcı (Xprinter XP-490B vb.) — mobil.
 * Ayarlar AsyncStorage; gönderim API veya yerel LAN köprüsü.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ApiClient } from "../api/client";
import { post } from "../api/client";

export const ETHERNET_PRINTER_KEY = "tamkobi_ethernet_printer";

export type EthernetPrinterSettings = {
  enabled: boolean;
  host: string;
  port: number;
  protocol: "tspl" | "escpos";
  dpi: number;
  brand: string;
  model: string;
  presetId: string;
  mode: "api" | "bridge";
  bridgeUrl: string;
};

export const PRINTER_PRESETS = [
  { id: "xprinter-xp-490b", brand: "Xprinter", model: "XP-490B", port: 9100, protocol: "tspl" as const, dpi: 203 },
  { id: "xprinter-xp-470b", brand: "Xprinter", model: "XP-470B", port: 9100, protocol: "tspl" as const, dpi: 203 },
  { id: "generic-tspl-9100", brand: "Generic", model: "TSPL Ethernet", port: 9100, protocol: "tspl" as const, dpi: 203 },
];

export function defaultEthernetPrinter(): EthernetPrinterSettings {
  return {
    enabled: false,
    host: "",
    port: 9100,
    protocol: "tspl",
    dpi: 203,
    brand: "Xprinter",
    model: "XP-490B",
    presetId: "xprinter-xp-490b",
    mode: "bridge",
    bridgeUrl: "http://192.168.1.50:19100",
  };
}

/** Yazıcı konfig etiketindeki Serial Port baud — Ethernet raw port değil. */
export const SERIAL_BAUD_PORTS = new Set([9600, 19200, 38400, 57600, 115200]);
export const ETHERNET_RAW_PORT = 9100;

export function normalizeEthernetPort(port: number | string | undefined): number {
  const p = Number(port);
  if (!Number.isFinite(p) || p <= 0) return ETHERNET_RAW_PORT;
  if (SERIAL_BAUD_PORTS.has(p)) return ETHERNET_RAW_PORT;
  return Math.max(1, Math.min(65535, p));
}

export function isSerialBaudPort(port: number | string | undefined): boolean {
  return SERIAL_BAUD_PORTS.has(Number(port));
}

/** Köprü hostname yazıcı IP ile aynı mı? (yazıcıda HTTP köprü yok; :19100 olsa bile yanlış) */
export function isBridgeUrlOnPrinterHost(settings: Partial<EthernetPrinterSettings>): boolean {
  const host = String(settings?.host || "").trim().toLowerCase();
  const bridge = String(settings?.bridgeUrl || "").trim();
  if (!host || !bridge) return false;
  try {
    const u = new URL(bridge.includes("://") ? bridge : `http://${bridge}`);
    return u.hostname.toLowerCase() === host;
  } catch {
    return false;
  }
}

/** @deprecated isBridgeUrlOnPrinterHost kullanın */
export function isBridgeUrlPrinterRawPort(settings: Partial<EthernetPrinterSettings>): boolean {
  return isBridgeUrlOnPrinterHost(settings);
}

export function suggestedBridgeUrl(): string {
  return "http://127.0.0.1:19100";
}

export function ethernetPrinterConfigError(settings: Partial<EthernetPrinterSettings>): string | null {
  const cfg = { ...defaultEthernetPrinter(), ...settings };
  if (!cfg.host) return "Yazıcı IP adresi girin (örn. 192.168.1.117).";
  if (isSerialBaudPort(cfg.port)) {
    return (
      `Port ${cfg.port} seri baud hızıdır (yazıcı konfig etiketi), Ethernet ham port değil. `
      + `XP-490B Ethernet yazdırma için port 9100 kullanın.`
    );
  }
  if (cfg.mode !== "bridge") return null;
  if (!cfg.bridgeUrl) {
    return "Köprü URL gerekli. PC'de python3 scripts/ethernet_print_bridge.py → http://PC-IP:19100";
  }
  if (isBridgeUrlOnPrinterHost(cfg)) {
    return (
      `Köprü URL yazıcı IP'si olamaz (${cfg.bridgeUrl}). `
      + `Yazıcıda HTTP köprü çalışmaz — PC'de python3 scripts/ethernet_print_bridge.py açıp `
      + `http://PC-IP:19100 yazın. Yazıcı IP alanına ${cfg.host} kalsın, port 9100.`
    );
  }
  try {
    const u = new URL(cfg.bridgeUrl.includes("://") ? cfg.bridgeUrl : `http://${cfg.bridgeUrl}`);
    const port = Number(u.port || 80);
    if (port === 9100 || port === 9101) return "Köprü portu 9100 olamaz. Varsayılan 19100.";
  } catch {
    return "Köprü URL geçersiz. Örnek: http://192.168.1.50:19100";
  }
  return null;
}

export async function loadEthernetPrinter(): Promise<EthernetPrinterSettings> {
  try {
    const raw = await AsyncStorage.getItem(ETHERNET_PRINTER_KEY);
    if (!raw) return defaultEthernetPrinter();
    const merged = { ...defaultEthernetPrinter(), ...JSON.parse(raw) };
    let dirty = false;
    if (isSerialBaudPort(merged.port)) {
      merged.port = ETHERNET_RAW_PORT;
      dirty = true;
    }
    if (merged.mode === "bridge" && isBridgeUrlOnPrinterHost(merged)) {
      merged.bridgeUrl = suggestedBridgeUrl();
      dirty = true;
    }
    if (dirty) return saveEthernetPrinter(merged);
    return merged;
  } catch {
    return defaultEthernetPrinter();
  }
}

export async function saveEthernetPrinter(settings: Partial<EthernetPrinterSettings>): Promise<EthernetPrinterSettings> {
  const raw = await AsyncStorage.getItem(ETHERNET_PRINTER_KEY).catch(() => null);
  const prev = raw ? { ...defaultEthernetPrinter(), ...JSON.parse(raw) } : defaultEthernetPrinter();
  const next: EthernetPrinterSettings = {
    ...prev,
    ...settings,
    port: normalizeEthernetPort(settings.port ?? prev.port),
    dpi: Number(settings.dpi ?? prev.dpi) === 300 ? 300 : 203,
    protocol: (settings.protocol ?? prev.protocol) === "escpos" ? "escpos" : "tspl",
    mode: (settings.mode ?? prev.mode) === "api" ? "api" : "bridge",
    host: String(settings.host ?? prev.host ?? "").trim(),
    bridgeUrl: String(settings.bridgeUrl ?? prev.bridgeUrl ?? "").trim().replace(/\/$/, ""),
  };
  if (next.mode === "bridge" && isBridgeUrlOnPrinterHost(next)) {
    next.bridgeUrl = suggestedBridgeUrl();
  }
  await AsyncStorage.setItem(ETHERNET_PRINTER_KEY, JSON.stringify(next));
  return next;
}

export function mmToDots(mm: number, dpi = 203): number {
  const d = Number(dpi) === 300 ? 300 : 203;
  return Math.max(0, Math.round(Number(mm) * (d / 25.4)));
}

export function escapeTsplText(value: unknown): string {
  return String(value ?? "")
    .replace(/"/g, "'")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 120);
}

export function sanitizeBarcodeData(value: unknown): string {
  return String(value ?? "").replace(/[^0-9A-Za-z\-_.]/g, "").slice(0, 64);
}

export type LabelProduct = {
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  sale_price?: number | null;
};

export type LabelTpl = {
  width_mm?: number;
  height_mm?: number;
  elements?: Array<{
    type?: string;
    field?: string;
    text?: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    font?: number;
    bold?: boolean;
    showText?: boolean;
  }>;
};

function fieldValue(el: NonNullable<LabelTpl["elements"]>[number], product: LabelProduct, companyName?: string): string {
  const map: Record<string, string> = {
    name: String(product?.name || ""),
    sku: String(product?.sku || ""),
    barcode_text: String(product?.barcode || ""),
    price: product?.sale_price != null ? `${Number(product.sale_price).toFixed(2)} TL` : "",
    company: companyName || "",
    text: String(el.text || ""),
  };
  return map[el.field || ""] ?? "";
}

export function buildTsplLabel(opts: {
  product: LabelProduct;
  companyName?: string;
  tpl?: LabelTpl | null;
  copies?: number;
  dpi?: number;
}): string {
  const wMm = Math.max(20, Number(opts.tpl?.width_mm) || 100);
  const hMm = Math.max(10, Number(opts.tpl?.height_mm) || 30);
  const n = Math.max(1, Math.min(200, Number(opts.copies) || 1));
  const dpi = opts.dpi || 203;
  const lines = [
    `SIZE ${wMm} mm,${hMm} mm`,
    "GAP 2 mm,0 mm",
    "DIRECTION 1",
    "REFERENCE 0,0",
    "CLS",
  ];
  const elements = Array.isArray(opts.tpl?.elements) ? opts.tpl!.elements! : [];
  if (elements.length) {
    for (const el of elements) {
      const x = mmToDots(el.x ?? 2, dpi);
      const y = mmToDots(el.y ?? 2, dpi);
      if (el.type === "barcode") {
        const code = sanitizeBarcodeData(opts.product?.barcode || opts.product?.sku || "");
        if (!code) continue;
        const bh = Math.max(40, mmToDots(el.h ?? 12, dpi));
        lines.push(`BARCODE ${x},${y},"128",${bh},${el.showText === false ? 0 : 1},0,2,2,"${code}"`);
      } else if (el.type === "qr") {
        const code = escapeTsplText(opts.product?.barcode || opts.product?.sku || opts.product?.name || "");
        if (!code) continue;
        lines.push(`QRCODE ${x},${y},L,4,A,0,"${code}"`);
      } else if (el.type === "field" || el.type === "text") {
        const text = escapeTsplText(fieldValue(el, opts.product, opts.companyName) || el.text || "");
        if (!text) continue;
        const font = Number(el.font) >= 14 ? "4" : Number(el.font) >= 10 ? "3" : "2";
        const mul = el.bold ? 2 : 1;
        lines.push(`TEXT ${x},${y},"${font}",0,${mul},${mul},"${text}"`);
      }
    }
  } else {
    const name = escapeTsplText(opts.product?.name || "");
    const sku = escapeTsplText(opts.product?.sku || "");
    const code = sanitizeBarcodeData(opts.product?.barcode || opts.product?.sku || "");
    if (name) lines.push(`TEXT ${mmToDots(2, dpi)},${mmToDots(2, dpi)},"3",0,1,1,"${name}"`);
    if (code) {
      lines.push(
        `BARCODE ${mmToDots(2, dpi)},${mmToDots(9, dpi)},"128",${mmToDots(Math.max(8, hMm - 16), dpi)},1,0,2,2,"${code}"`,
      );
    }
    if (sku) lines.push(`TEXT ${mmToDots(wMm - 34, dpi)},${mmToDots(10, dpi)},"2",0,1,1,"${sku}"`);
  }
  lines.push(`PRINT ${n},1`);
  return `${lines.join("\r\n")}\r\n`;
}

async function bridgePost(bridgeUrl: string, path: string, body: unknown): Promise<unknown> {
  const url = `${bridgeUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const detail = (data as { detail?: string })?.detail || `HTTP ${res.status}`;
    throw new Error(String(detail));
  }
  return data;
}

export async function probeEthernetPrinter(
  settings: EthernetPrinterSettings,
  client?: ApiClient | null,
): Promise<{ ok?: boolean; host?: string; port?: number }> {
  const cfgErr = ethernetPrinterConfigError(settings);
  if (cfgErr) throw new Error(cfgErr);
  if (settings.mode === "bridge") {
    try {
      return await bridgePost(settings.bridgeUrl, "/probe", { host: settings.host, port: settings.port }) as {
        ok?: boolean;
        host?: string;
        port?: number;
      };
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : "Köprü hatası"}. `
        + `PC'de python3 scripts/ethernet_print_bridge.py çalıştırın; URL http://PC-IP:19100 `
        + `(yazıcı ${settings.host}:9100 değil).`,
      );
    }
  }
  if (!client) throw new Error("API istemcisi yok.");
  return post(client, "/network-printers/probe", { host: settings.host, port: settings.port });
}

export type DiscoveredPrinter = { host: string; port: number };

export type DiscoverEthernetResult = {
  ok?: boolean;
  printers: DiscoveredPrinter[];
  scanned?: number;
  subnet?: string;
  port?: number;
};

/** LAN'da :9100 açık özel IP'leri tara (köprü veya API). */
export async function discoverEthernetPrinters(
  settings: Partial<EthernetPrinterSettings>,
  client?: ApiClient | null,
  opts?: { subnet?: string },
): Promise<DiscoverEthernetResult> {
  const cfg = { ...defaultEthernetPrinter(), ...settings };
  const port = normalizeEthernetPort(cfg.port);
  const body: { host?: string; port: number; subnet?: string } = { port };
  const host = String(cfg.host || "").trim();
  if (host) body.host = host;
  const subnet = String(opts?.subnet || "").trim();
  if (subnet) body.subnet = subnet;

  const normalize = (raw: unknown): DiscoverEthernetResult => {
    const data = (raw || {}) as {
      ok?: boolean;
      printers?: Array<{ host?: string; port?: number }>;
      scanned?: number;
      subnet?: string;
      port?: number;
      detail?: string;
    };
    const printers = (Array.isArray(data.printers) ? data.printers : [])
      .map((row) => ({
        host: String(row?.host || "").trim(),
        port: normalizeEthernetPort(row?.port ?? port),
      }))
      .filter((row) => !!row.host);
    return {
      ok: data.ok !== false,
      printers,
      scanned: data.scanned,
      subnet: data.subnet,
      port: data.port ?? port,
    };
  };

  if (cfg.mode === "bridge") {
    if (!cfg.bridgeUrl) {
      throw new Error("Köprü URL gerekli. PC'de python3 scripts/ethernet_print_bridge.py → http://PC-IP:19100");
    }
    try {
      return normalize(await bridgePost(cfg.bridgeUrl, "/discover", body));
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : "Köprü hatası"}. `
        + `PC'de python3 scripts/ethernet_print_bridge.py çalıştırın; URL http://PC-IP:19100.`,
      );
    }
  }
  if (!client) throw new Error("API istemcisi yok.");
  return normalize(await post(client, "/network-printers/discover", body));
}

export async function sendEthernetRaw(
  payload: string,
  settings: EthernetPrinterSettings,
  client?: ApiClient | null,
): Promise<{ ok?: boolean; bytes?: number }> {
  const cfgErr = ethernetPrinterConfigError(settings);
  if (cfgErr) throw new Error(cfgErr);
  if (!payload?.trim()) throw new Error("Boş yazdırma verisi.");
  if (settings.mode === "bridge") {
    return bridgePost(settings.bridgeUrl, "/send", {
      host: settings.host,
      port: settings.port,
      data: payload,
    }) as Promise<{ ok?: boolean; bytes?: number }>;
  }
  if (!client) throw new Error("API istemcisi yok.");
  return post(client, "/network-printers/send", {
    host: settings.host,
    port: settings.port,
    data: payload,
  });
}

export async function printLabelEthernet(opts: {
  product: LabelProduct;
  companyName?: string;
  tpl?: LabelTpl | null;
  copies?: number;
  client?: ApiClient | null;
  settings?: EthernetPrinterSettings | null;
}): Promise<{ ok: boolean; bytes?: number }> {
  const settings = opts.settings || (await loadEthernetPrinter());
  if (!settings.host) throw new Error("Önce Ethernet yazıcı IP'sini kaydedin.");
  const payload = buildTsplLabel({
    product: opts.product,
    companyName: opts.companyName,
    tpl: opts.tpl,
    copies: opts.copies,
    dpi: settings.dpi,
  });
  const r = await sendEthernetRaw(payload, settings, opts.client);
  return { ok: true, bytes: r?.bytes };
}

/** Kayıtlı Ethernet yazıcı varsa onu kullan; yoksa false. */
export async function tryPrintLabelEthernet(opts: {
  product: LabelProduct;
  companyName?: string;
  tpl?: LabelTpl | null;
  copies?: number;
  client?: ApiClient | null;
}): Promise<boolean> {
  const settings = await loadEthernetPrinter();
  if (!settings.enabled || !settings.host) return false;
  await printLabelEthernet({ ...opts, settings });
  return true;
}

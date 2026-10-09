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

export async function loadEthernetPrinter(): Promise<EthernetPrinterSettings> {
  try {
    const raw = await AsyncStorage.getItem(ETHERNET_PRINTER_KEY);
    if (!raw) return defaultEthernetPrinter();
    return { ...defaultEthernetPrinter(), ...JSON.parse(raw) };
  } catch {
    return defaultEthernetPrinter();
  }
}

export async function saveEthernetPrinter(settings: Partial<EthernetPrinterSettings>): Promise<EthernetPrinterSettings> {
  const prev = await loadEthernetPrinter();
  const next: EthernetPrinterSettings = {
    ...prev,
    ...settings,
    port: Math.max(1, Math.min(65535, Number(settings.port ?? prev.port) || 9100)),
    dpi: Number(settings.dpi ?? prev.dpi) === 300 ? 300 : 203,
    protocol: (settings.protocol ?? prev.protocol) === "escpos" ? "escpos" : "tspl",
    mode: (settings.mode ?? prev.mode) === "api" ? "api" : "bridge",
    host: String(settings.host ?? prev.host ?? "").trim(),
    bridgeUrl: String(settings.bridgeUrl ?? prev.bridgeUrl ?? "").trim().replace(/\/$/, ""),
  };
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
  if (!settings.host) throw new Error("Yazıcı IP adresi girin.");
  if (settings.mode === "bridge") {
    return bridgePost(settings.bridgeUrl, "/probe", { host: settings.host, port: settings.port }) as Promise<{
      ok?: boolean;
      host?: string;
      port?: number;
    }>;
  }
  if (!client) throw new Error("API istemcisi yok.");
  return post(client, "/network-printers/probe", { host: settings.host, port: settings.port });
}

export async function sendEthernetRaw(
  payload: string,
  settings: EthernetPrinterSettings,
  client?: ApiClient | null,
): Promise<{ ok?: boolean; bytes?: number }> {
  if (!settings.host) throw new Error("Yazıcı IP adresi girin.");
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

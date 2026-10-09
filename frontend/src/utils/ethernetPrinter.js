/**
 * Ethernet / IP etiket yazıcı (Xprinter XP-490B vb. TSPL :9100).
 * Ayarlar localStorage'da; gönderim API veya yerel köprü üzerinden.
 */

import axios from "axios";
import { API_URL } from "../context/AuthContext";
import { labelFieldValue } from "./labelDesignFields";

export const ETHERNET_PRINTER_KEY = "tamkobi_ethernet_printer";

export const PRINTER_PRESETS = [
  { id: "xprinter-xp-490b", brand: "Xprinter", model: "XP-490B", port: 9100, protocol: "tspl", dpi: 203, width_mm: 100, height_mm: 30 },
  { id: "xprinter-xp-470b", brand: "Xprinter", model: "XP-470B", port: 9100, protocol: "tspl", dpi: 203, width_mm: 80, height_mm: 60 },
  { id: "generic-tspl-9100", brand: "Generic", model: "TSPL Ethernet", port: 9100, protocol: "tspl", dpi: 203, width_mm: 100, height_mm: 30 },
];

export const defaultEthernetPrinter = () => ({
  enabled: false,
  host: "",
  port: 9100,
  protocol: "tspl",
  dpi: 203,
  brand: "Xprinter",
  model: "XP-490B",
  presetId: "xprinter-xp-490b",
  /** api: TamKobi sunucusu → yazıcı | bridge: yerel HTTP köprü → yazıcı */
  mode: "api",
  bridgeUrl: "http://127.0.0.1:19100",
});

/** Yazıcı konfig etiketindeki Serial Port baud (9600) — Ethernet raw port değil. */
export const SERIAL_BAUD_PORTS = new Set([9600, 19200, 38400, 57600, 115200]);
export const ETHERNET_RAW_PORT = 9100;

/** 9600 vb. baud değerini Ethernet :9100'e çevir. */
export function normalizeEthernetPort(port) {
  const p = Number(port);
  if (!Number.isFinite(p) || p <= 0) return ETHERNET_RAW_PORT;
  if (SERIAL_BAUD_PORTS.has(p)) return ETHERNET_RAW_PORT;
  return Math.max(1, Math.min(65535, p));
}

export function isSerialBaudPort(port) {
  return SERIAL_BAUD_PORTS.has(Number(port));
}

export function loadEthernetPrinter() {
  try {
    const raw = JSON.parse(localStorage.getItem(ETHERNET_PRINTER_KEY) || "{}");
    const merged = { ...defaultEthernetPrinter(), ...raw };
    let dirty = false;
    if (isSerialBaudPort(merged.port)) {
      merged.port = ETHERNET_RAW_PORT;
      dirty = true;
    }
    // Köprü URL yazıcı IP'sine işaret ediyorsa (9100 veya 19100) düzelt
    if (merged.mode === "bridge" && isBridgeUrlOnPrinterHost(merged)) {
      merged.bridgeUrl = suggestedBridgeUrl(merged.host);
      dirty = true;
    }
    if (dirty) return saveEthernetPrinter(merged);
    return merged;
  } catch {
    return defaultEthernetPrinter();
  }
}

/** Köprü hostname yazıcı IP ile aynı mı? (yazıcıda HTTP köprü yok) */
export function isBridgeUrlOnPrinterHost(settings) {
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
export function isBridgeUrlPrinterRawPort(settings) {
  return isBridgeUrlOnPrinterHost(settings);
}

export function suggestedBridgeUrl(hostHint) {
  // Köprü her zaman PC:19100; yazıcı IP'si buraya yazılmaz
  void hostHint;
  return "http://127.0.0.1:19100";
}

/** Köprü / API ayarını doğrula; hata mesajı veya null. */
export function ethernetPrinterConfigError(settings) {
  const cfg = { ...defaultEthernetPrinter(), ...(settings || {}) };
  if (!cfg.host) return "Yazıcı IP adresi girin (örn. 192.168.1.117).";
  if (isSerialBaudPort(cfg.port)) {
    return (
      `Port ${cfg.port} seri baud hızıdır (yazıcı konfig etiketi), Ethernet ham port değil. `
      + `XP-490B Ethernet yazdırma için port 9100 kullanın.`
    );
  }
  if (cfg.mode !== "bridge") return null;
  if (!cfg.bridgeUrl) {
    return "Köprü URL gerekli. PC'de python3 scripts/ethernet_print_bridge.py çalıştırın → http://PC-IP:19100";
  }
  if (isBridgeUrlOnPrinterHost(cfg)) {
    return (
      `Köprü URL yazıcı IP'si olamaz (${cfg.bridgeUrl}). `
      + `Yazıcıda HTTP köprü çalışmaz — PC'de python3 scripts/ethernet_print_bridge.py açıp `
      + `http://PC-IP:19100 yazın. Yazıcı IP alanına ${cfg.host} kalsın, port 9100. `
      + `TamKobi aynı LAN'daysa Gönderim = «API sunucusu → yazıcı» deneyin (köprü gerekmez).`
    );
  }
  try {
    const u = new URL(cfg.bridgeUrl.includes("://") ? cfg.bridgeUrl : `http://${cfg.bridgeUrl}`);
    const port = Number(u.port || 80);
    if (port === 9100 || port === 9101) {
      return "Köprü portu 9100 olamaz (yazıcı portu). Köprü varsayılanı 19100.";
    }
  } catch {
    return "Köprü URL geçersiz. Örnek: http://192.168.1.50:19100";
  }
  return null;
}

export function saveEthernetPrinter(settings) {
  const next = { ...defaultEthernetPrinter(), ...(settings || {}) };
  next.port = normalizeEthernetPort(next.port);
  next.dpi = Number(next.dpi) === 300 ? 300 : 203;
  next.protocol = next.protocol === "escpos" ? "escpos" : "tspl";
  next.mode = next.mode === "bridge" ? "bridge" : "api";
  next.host = String(next.host || "").trim();
  next.bridgeUrl = String(next.bridgeUrl || "").trim().replace(/\/$/, "");
  // Köprü URL yazıcı IP'sine yazılmışsa PC localhost öner
  if (next.mode === "bridge" && isBridgeUrlOnPrinterHost(next)) {
    next.bridgeUrl = suggestedBridgeUrl(next.host);
  }
  try {
    localStorage.setItem(ETHERNET_PRINTER_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}

export function applyPrinterPreset(settings, presetId) {
  const preset = PRINTER_PRESETS.find((p) => p.id === presetId) || PRINTER_PRESETS[0];
  return saveEthernetPrinter({
    ...settings,
    presetId: preset.id,
    brand: preset.brand,
    model: preset.model,
    port: preset.port,
    protocol: preset.protocol,
    dpi: preset.dpi,
  });
}

/** mm → nokta (203 dpi ≈ 8 dot/mm). */
export function mmToDots(mm, dpi = 203) {
  const d = Number(dpi) === 300 ? 300 : 203;
  return Math.max(0, Math.round(Number(mm) * (d / 25.4)));
}

export function escapeTsplText(value) {
  return String(value ?? "")
    .replace(/"/g, "'")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 120);
}

export function sanitizeBarcodeData(value) {
  return String(value ?? "").replace(/[^0-9A-Za-z\-_.]/g, "").slice(0, 64);
}

/**
 * Ürün + şablon boyutundan TSPL komut dizisi (Xprinter / TSC uyumlu).
 */
export function buildTsplLabel({ product, company, tpl, copies = 1, dpi = 203 }) {
  const wMm = Math.max(20, Number(tpl?.width_mm) || 100);
  const hMm = Math.max(10, Number(tpl?.height_mm) || 30);
  const n = Math.max(1, Math.min(200, Number(copies) || 1));
  const gap = 2;
  const lines = [
    `SIZE ${wMm} mm,${hMm} mm`,
    `GAP ${gap} mm,0 mm`,
    "DIRECTION 1",
    "REFERENCE 0,0",
    "CLS",
  ];

  const elements = Array.isArray(tpl?.elements) ? tpl.elements : [];
  if (elements.length) {
    for (const el of elements) {
      const x = mmToDots(el.x ?? 2, dpi);
      const y = mmToDots(el.y ?? 2, dpi);
      if (el.type === "barcode") {
        const code = sanitizeBarcodeData(product?.barcode || product?.sku || "");
        if (!code) continue;
        const bh = Math.max(40, mmToDots(el.h ?? 12, dpi));
        const readable = el.showText === false ? 0 : 1;
        lines.push(`BARCODE ${x},${y},"128",${bh},${readable},0,2,2,"${code}"`);
      } else if (el.type === "qr") {
        const code = escapeTsplText(product?.barcode || product?.sku || product?.name || "");
        if (!code) continue;
        const cell = Math.max(3, Math.min(10, Math.round(mmToDots(Math.min(el.w || 15, el.h || 15), dpi) / 25)));
        lines.push(`QRCODE ${x},${y},L,${cell},A,0,"${code}"`);
      } else if (el.type === "field" || el.type === "text") {
        const text = escapeTsplText(labelFieldValue(el, product, company) || el.text || "");
        if (!text) continue;
        const font = Number(el.font) >= 14 ? "4" : Number(el.font) >= 10 ? "3" : "2";
        const mul = el.bold ? 2 : 1;
        lines.push(`TEXT ${x},${y},"${font}",0,${mul},${mul},"${text}"`);
      }
      // image/logo/line/box: ham TSPL bitmap karmaşık — v1'de atlanır
    }
  } else {
    const name = escapeTsplText(product?.name || "");
    const sku = escapeTsplText(product?.sku || "");
    const code = sanitizeBarcodeData(product?.barcode || product?.sku || "");
    const price = escapeTsplText(
      product?.sale_price != null ? `${Number(product.sale_price).toFixed(2)} TL` : "",
    );
    if (name) lines.push(`TEXT ${mmToDots(2, dpi)},${mmToDots(2, dpi)},"3",0,1,1,"${name}"`);
    if (code) {
      lines.push(`BARCODE ${mmToDots(2, dpi)},${mmToDots(9, dpi)},"128",${mmToDots(Math.max(8, hMm - 16), dpi)},1,0,2,2,"${code}"`);
    }
    if (sku) lines.push(`TEXT ${mmToDots(wMm - 34, dpi)},${mmToDots(10, dpi)},"2",0,1,1,"${sku}"`);
    if (price) lines.push(`TEXT ${mmToDots(wMm - 34, dpi)},${mmToDots(16, dpi)},"3",0,1,1,"${price}"`);
  }

  lines.push(`PRINT ${n},1`);
  return `${lines.join("\r\n")}\r\n`;
}

/** Basit ESC/POS etiket (birçok termal; XP-490B için TSPL tercih edilir). */
export function buildEscPosLabel({ product, copies = 1 }) {
  const ESC = "\x1b";
  const GS = "\x1d";
  const name = String(product?.name || "").slice(0, 40);
  const sku = String(product?.sku || "");
  const code = sanitizeBarcodeData(product?.barcode || product?.sku || "");
  const n = Math.max(1, Math.min(200, Number(copies) || 1));
  let out = "";
  out += `${ESC}@`; // init
  out += `${ESC}a\x01`; // center
  out += `${ESC}!\x10${name}\n`;
  if (sku) out += `${sku}\n`;
  if (code) {
    out += `${GS}h\x50`; // barcode height
    out += `${GS}w\x02`;
    out += `${GS}k\x49${String.fromCharCode(code.length + 2)}{B${code}`;
    out += "\n";
  }
  out += "\n\n";
  out += `${GS}V\x00`; // partial cut if supported
  return out.repeat(n);
}

export function buildPrinterPayload(settings, { product, company, tpl, copies }) {
  const dpi = settings?.dpi || 203;
  if (settings?.protocol === "escpos") {
    return buildEscPosLabel({ product, copies });
  }
  return buildTsplLabel({ product, company, tpl, copies, dpi });
}

function apiErrorDetail(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || x).join("; ");
  return err?.message || "Yazıcı hatası";
}

/** Bağlantı testi. */
export async function probeEthernetPrinter(settings = loadEthernetPrinter()) {
  const cfg = { ...defaultEthernetPrinter(), ...settings };
  cfg.port = normalizeEthernetPort(cfg.port);
  if (cfg.mode === "bridge" && isBridgeUrlOnPrinterHost(cfg)) {
    cfg.bridgeUrl = suggestedBridgeUrl(cfg.host);
  }
  const cfgErr = ethernetPrinterConfigError(cfg);
  if (cfgErr) throw new Error(cfgErr);
  if (cfg.mode === "bridge") {
    const url = `${cfg.bridgeUrl}/probe`;
    try {
      const { data } = await axios.post(url, { host: cfg.host, port: cfg.port }, { timeout: 8000 });
      return data;
    } catch (err) {
      const detail = apiErrorDetail(err);
      if (!err?.response) {
        throw new Error(
          `Köprüye ulaşılamadı (${cfg.bridgeUrl}). `
          + `Aynı Wi‑Fi'deki bir PC'de: python3 scripts/ethernet_print_bridge.py `
          + `— sonra Köprü URL = http://O-PC-IP:19100. Yazıcı IP = ${cfg.host} kalsın. `
          + `Veya Gönderim = API deneyin.`,
        );
      }
      throw new Error(detail || "Köprü bağlantı testi başarısız.");
    }
  }
  try {
    const { data } = await axios.post(
      `${API_URL}/network-printers/probe`,
      { host: cfg.host, port: cfg.port },
      { withCredentials: true, timeout: 10000 },
    );
    return data;
  } catch (err) {
    const detail = apiErrorDetail(err);
    throw new Error(
      detail
      || `API yazıcıya ulaşamadı (${cfg.host}:${cfg.port}). Sunucu yazıcıyla aynı LAN'da değilse Yerel köprü kullanın.`,
    );
  }
}

/** Ham komutu yazıcıya gönder. */
export async function sendEthernetRaw(payload, settings = loadEthernetPrinter()) {
  const cfg = { ...defaultEthernetPrinter(), ...settings };
  cfg.port = normalizeEthernetPort(cfg.port);
  if (cfg.mode === "bridge" && isBridgeUrlOnPrinterHost(cfg)) {
    cfg.bridgeUrl = suggestedBridgeUrl(cfg.host);
  }
  const cfgErr = ethernetPrinterConfigError(cfg);
  if (cfgErr) throw new Error(cfgErr);
  const text = typeof payload === "string" ? payload : String(payload || "");
  if (!text.trim()) throw new Error("Boş yazdırma verisi.");

  if (cfg.mode === "bridge") {
    const url = `${cfg.bridgeUrl}/send`;
    try {
      const { data } = await axios.post(
        url,
        { host: cfg.host, port: cfg.port, data: text },
        { timeout: 15000 },
      );
      return data;
    } catch (err) {
      if (!err?.response) {
        throw new Error(
          `Köprüye ulaşılamadı (${cfg.bridgeUrl}). `
          + `python3 scripts/ethernet_print_bridge.py çalıştırın; URL http://PC-IP:19100 olmalı `
          + `(yazıcı ${cfg.host}:9100 değil).`,
        );
      }
      throw new Error(apiErrorDetail(err) || "Köprü yazdırma başarısız.");
    }
  }

  try {
    const { data } = await axios.post(
      `${API_URL}/network-printers/send`,
      { host: cfg.host, port: cfg.port, data: text },
      { withCredentials: true, timeout: 15000 },
    );
    return data;
  } catch (err) {
    throw new Error(apiErrorDetail(err) || `Yazdırma başarısız (${cfg.host}:${cfg.port}).`);
  }
}

/** Etiket işlerini Ethernet yazıcıya gönder. */
export async function printLabelsEthernet({ product, company, tpl, copies = 1, settings } = {}) {
  const cfg = settings || loadEthernetPrinter();
  if (!cfg.host) throw new Error("Önce Ethernet yazıcı IP'sini kaydedin.");
  const payload = buildPrinterPayload(cfg, { product, company, tpl, copies });
  return sendEthernetRaw(payload, cfg);
}

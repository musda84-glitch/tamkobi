import { File as CacheFile, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";
import { officialLabelFileMeta } from "./orderPrint";

export type NativePrintSize = { width?: number; height?: number };

export const A4_PRINT_PX: NativePrintSize = { width: 595, height: 842 };
export const A5_PRINT_PX: NativePrintSize = { width: 420, height: 595 };
export const THERMAL_LABEL_PX: NativePrintSize = { width: 284, height: 425 };

export function paperPrintSize(paper?: string | null): NativePrintSize {
  return paper === "A5" ? A5_PRINT_PX : A4_PRINT_PX;
}

function triggerBlobDownload(blob: Blob, filename: string): boolean {
  if (typeof document === "undefined") return false;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
  return true;
}

function bytesToBase64(bytes: Uint8Array): string {
  const Buf = (globalThis as { Buffer?: { from: (b: Uint8Array) => { toString: (enc: string) => string } } }).Buffer;
  if (Buf) return Buf.from(bytes).toString("base64");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function writeCacheBytes(bytes: Uint8Array, filename: string): Promise<string> {
  const file = new CacheFile(Paths.cache, filename);
  file.create({ overwrite: true });
  await file.write(bytes);
  return file.uri;
}

export async function shareLocalFile(uri: string, mimeType: string, filename: string): Promise<boolean> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType,
      UTI: mimeType === "application/pdf" ? "com.adobe.pdf" : undefined,
      dialogTitle: filename,
    });
    return true;
  }
  await Share.share({ url: uri, title: filename }).catch(() => null);
  return true;
}

export async function sharePdfFile(bytes: Uint8Array, filename: string): Promise<boolean> {
  if (Platform.OS === "web") {
    const copy = Uint8Array.from(bytes);
    return triggerBlobDownload(new Blob([copy.buffer], { type: "application/pdf" }), filename);
  }
  const uri = await writeCacheBytes(bytes, filename);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: filename });
    return true;
  }
  const file = new CacheFile(uri);
  await file.preview();
  return true;
}

export async function printHtmlNative(html: string, size?: NativePrintSize): Promise<boolean> {
  if (Platform.OS === "web") return false;
  await Print.printAsync({ html, ...size });
  return true;
}

export async function htmlToPdfFile(html: string, filename: string, size?: NativePrintSize): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const printed = await Print.printToFileAsync({ html, ...size });
  if (printed.uri && await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(printed.uri, { mimeType: "application/pdf", dialogTitle: filename });
    return true;
  }
  if (printed.uri) {
    await Share.share({ url: printed.uri, title: filename }).catch(() => null);
    return true;
  }
  return false;
}

function officialImageHtml(src: string): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Kargo etiketi</title>
<style>@page{size:100mm 150mm;margin:0}html,body{margin:0;padding:0;background:#fff}img{display:block;width:100%;height:auto}</style>
</head><body><img src="${src}" alt="etiket"/></body></html>`;
}

/** Pazaryeri PDF / görsel etiketini yazıcıya veya dosya paylaşımına gönder; metin değil. */
export async function printOfficialBlob(blob: Blob, baseName: string): Promise<boolean> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const meta = officialLabelFileMeta(blob.type, bytes);
  const filename = `${baseName}.${meta.ext}`;
  if (Platform.OS === "web") {
    return triggerBlobDownload(new Blob([Uint8Array.from(bytes).buffer], { type: meta.mime }), filename);
  }
  if (meta.kind === "pdf") {
    const uri = await writeCacheBytes(bytes, filename);
    try {
      await Print.printAsync({ uri });
      return true;
    } catch {
      return shareLocalFile(uri, meta.mime, filename);
    }
  }
  if (meta.kind === "image") {
    const html = officialImageHtml(`data:${meta.mime};base64,${bytesToBase64(bytes)}`);
    try {
      if (await printHtmlNative(html, THERMAL_LABEL_PX)) return true;
    } catch {
      /* file share */
    }
    const uri = await writeCacheBytes(bytes, filename);
    return shareLocalFile(uri, meta.mime, filename);
  }
  const uri = await writeCacheBytes(bytes, filename);
  return shareLocalFile(uri, meta.mime, filename);
}

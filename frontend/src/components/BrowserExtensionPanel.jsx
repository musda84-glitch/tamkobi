import React, { useMemo, useState } from "react";
import { Chrome, Copy, Download, Puzzle } from "lucide-react";

const ZIP_HREF = "/downloads/tamkobi-browser-extension.zip";

/** Firma Ayarları — Chrome/Edge/Brave eklenti indirme ve kurulum. */
export function BrowserExtensionPanel() {
  const origin = useMemo(() => {
    try {
      return window.location.origin;
    } catch {
      return "https://tamkobi.com";
    }
  }, []);
  const [copied, setCopied] = useState(false);

  const copyOrigin = async () => {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-4 max-w-2xl" data-testid="browser-extension-panel">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0">
            <Puzzle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">TamKobi tarayıcı eklentisi</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Panel, Hızlı Satış, Faturalar, Stok, Siparişler, Cariler, Raporlar ve Ayarlar’a tek tıkla gidin.
              Chrome, Edge ve Brave (Manifest V3) ile Firefox desteklenir. Sürüm 1.2.0
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={ZIP_HREF}
            download="tamkobi-browser-extension.zip"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-bold hover:bg-sky-700"
            data-testid="browser-extension-download"
          >
            <Download className="w-4 h-4" />
            Eklentiyi indir (.zip)
          </a>
          <button
            type="button"
            onClick={copyOrigin}
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            data-testid="browser-extension-copy-origin"
          >
            <Copy className="w-3.5 h-3.5" />
            {copied ? "Kopyalandı" : "Kurulum adresini kopyala"}
          </button>
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3 text-xs text-slate-700">
        <div className="font-bold text-slate-900 flex items-center gap-1.5">
          <Chrome className="w-4 h-4 text-slate-500" /> Kurulum (Chrome / Edge / Brave)
        </div>
        <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
          <li>
            İndirdiğiniz <b>tamkobi-browser-extension.zip</b> dosyasını açıp klasöre çıkarın.
          </li>
          <li>
            Adres çubuğuna <code className="bg-white border px-1 rounded font-mono text-[11px]">chrome://extensions</code>
            {" "}(Edge: <code className="bg-white border px-1 rounded font-mono text-[11px]">edge://extensions</code>) yazın.
          </li>
          <li>
            Sağ üstten <b>Geliştirici modu</b>nu açın → <b>Paketlenmemiş öğe yükle</b> →
            {" "}çıkardığınız <b>tamkobi-browser-extension</b> klasörünü seçin.
          </li>
          <li>
            Eklenti ikonuna tıklayıp <b>Kurulum adresi</b> alanına şunu yazın (veya “Açık sekmeyi kullan”):{" "}
            <code className="bg-white border px-1 rounded font-mono text-[11px]" data-testid="browser-extension-origin">
              {origin}
            </code>
          </li>
        </ol>
        <p className="text-slate-500 pt-1">
          Firefox: <code className="bg-white border px-1 rounded font-mono text-[11px]">about:debugging#/runtime/this-firefox</code>
          {" "}→ Geçici eklenti yükle → klasördeki <b>manifest.json</b>.
        </p>
      </div>
    </div>
  );
}

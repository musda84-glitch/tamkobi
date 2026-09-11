
import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/** Bir panelin çizim hatası tüm platform sayfasını götürmesin.
 *
 * Hata sınırı yoksa React kökü tamamen boşaltır: ekranda ne panel ne menü
 * kalır, tarayıcı konsoluna bakmayan için sebebi belirsiz boş bir alan olur.
 * Burada hatayı yazıp yeniden denemeyi teklif ediyoruz; menü ve diğer
 * bölümler ayakta kalıyor.
 *
 * `key` olarak bölüm anahtarını verin, böylece başka bölüme geçildiğinde
 * sınır sıfırlanır.
 */
export class PanelBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error(`Platform bölümü çizilemedi: ${this.props.label || ""}`, err, info);
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    return (
      <div className="text-xs text-slate-600 space-y-2" data-testid="panel-boundary-error">
        <p className="font-semibold text-slate-900 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          {this.props.label ? `${this.props.label} bölümü açılamadı.` : "Bölüm açılamadı."}
        </p>
        <p>Sol menüdeki diğer bölümler çalışmaya devam eder. Sorun sürerse aşağıdaki satırı destek talebine ekleyin.</p>
        <code className="block bg-slate-100 rounded-lg px-2 py-1.5 text-[11px] text-rose-700 break-all">{String(err.message || err)}</code>
        <button type="button" onClick={() => this.setState({ err: null })} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-bold inline-flex items-center gap-1.5" data-testid="panel-boundary-retry">
          <RotateCcw className="w-3.5 h-3.5" /> Tekrar dene
        </button>
      </div>
    );
  }
}

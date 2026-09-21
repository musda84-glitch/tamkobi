import { useEffect, useRef, useState } from "react";
import { Scale, X } from "lucide-react";
import { toast } from "sonner";
import { readScaleOnce, scaleSupported } from "../utils/scaleBridge";
import { resolveImageUrl } from "../utils/imageUrl";
import { formatTrAmount } from "../utils/money";

function money(n) {
  return formatTrAmount(Number(n || 0));
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

/**
 * Tartılabilir (kg/lt) ürün seçildiğinde açılan tartı ekranı.
 * Manuel tuş takımı + isteğe bağlı Web Serial tartı okuma.
 */
export function ScalePromptModal({ product, initialKg = "", onCancel, onConfirm }) {
  const [kg, setKg] = useState(String(initialKg || ""));
  const [reading, setReading] = useState(false);
  const inputRef = useRef(null);
  const unit = product?.unit || "Kg";
  const price = Number(product?.sale_price || 0);
  const qty = Number(String(kg).replace(",", "."));
  const valid = Number.isFinite(qty) && qty > 0;
  const img = resolveImageUrl(product?.image_url);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const pushKey = (k) => {
    if (k === "⌫") {
      setKg((s) => s.slice(0, -1));
      return;
    }
    if (k === ".") {
      setKg((s) => (s.includes(".") || s.includes(",") ? s : `${s || "0"}.`));
      return;
    }
    setKg((s) => {
      if (s === "0") return k;
      return `${s}${k}`;
    });
  };

  const readScale = async () => {
    if (!scaleSupported()) {
      toast.error("Bu tarayıcı tartı bağlantısını desteklemiyor. Kg tutarını girin.");
      return;
    }
    setReading(true);
    try {
      const w = await readScaleOnce({});
      setKg(String(w));
      toast.success(`Tartı: ${w} ${unit}`);
    } catch (err) {
      toast.error(err?.message || "Tartı okunamadı");
    } finally {
      setReading(false);
    }
  };

  const submit = (e) => {
    e?.preventDefault?.();
    if (!valid) {
      toast.error("Geçerli bir miktar girin");
      return;
    }
    onConfirm?.(qty);
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-3 sm:p-6" data-testid="pos-scale-modal">
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50">
          <div className="flex items-center gap-2 min-w-0">
            <Scale className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-slate-900 truncate">Tartı</h3>
              <p className="text-xs text-slate-500 truncate">{product?.name}</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} className="p-2 rounded-lg hover:bg-slate-200" data-testid="pos-scale-cancel" aria-label="Kapat">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl bg-slate-100 border overflow-hidden flex items-center justify-center shrink-0">
              {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <Scale className="w-6 h-6 text-slate-300" />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">{product?.name}</div>
              <div className="text-xs text-slate-500">₺{money(price)} / {unit}</div>
            </div>
          </div>

          <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 px-4 py-5 text-center">
            <div className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700 mb-1">Miktar ({unit})</div>
            <input
              ref={inputRef}
              value={kg}
              onChange={(e) => setKg(e.target.value.replace(/[^0-9.,]/g, ""))}
              inputMode="decimal"
              placeholder="0.000"
              className="w-full text-center text-4xl font-black text-slate-900 bg-transparent outline-none"
              data-testid="pos-scale-kg-input"
            />
            <div className="mt-2 text-sm font-semibold text-slate-700" data-testid="pos-scale-line-total">
              Tutar: ₺{money(valid ? qty * price : 0)}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pushKey(k)}
                className="h-14 rounded-xl border border-slate-200 bg-white text-xl font-bold text-slate-800 active:scale-[0.98] hover:bg-slate-50"
                data-testid={`pos-scale-key-${k === "⌫" ? "back" : k === "." ? "dot" : k}`}
              >
                {k}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={reading || !scaleSupported()}
            onClick={readScale}
            className="w-full h-12 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            data-testid="pos-scale-read-btn"
          >
            <Scale className="w-4 h-4" />
            {reading ? "Okunuyor…" : scaleSupported() ? "Tartıdan Oku" : "Tartı desteklenmiyor"}
          </button>
        </div>

        <div className="px-4 py-3 border-t flex gap-2 bg-slate-50">
          <button type="button" onClick={onCancel} className="flex-1 h-12 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-white">
            İptal
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="flex-[1.4] h-12 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50"
            data-testid="pos-scale-confirm"
          >
            Sepete Ekle
          </button>
        </div>
      </form>
    </div>
  );
}

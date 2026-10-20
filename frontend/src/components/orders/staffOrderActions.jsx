import React from "react";
import { ORDER_STAFF_ACTIONS } from "../../utils/selfPersonnelNav";

const LABELS = {
  print: "Sipariş yazdır",
  missing: "Eksik bildir",
  produce: "Üretime al",
  cargo: "Kargola",
  label: "Kargo etiketi",
};

const TONE = {
  print: "bg-white text-slate-800 border-slate-200 hover:bg-slate-50",
  missing: "bg-amber-50 text-amber-950 border-amber-200 hover:bg-amber-100",
  produce: "bg-orange-50 text-orange-950 border-orange-200 hover:bg-orange-100",
  cargo: "bg-violet-50 text-violet-950 border-violet-200 hover:bg-violet-100",
  label: "bg-teal-50 text-teal-950 border-teal-200 hover:bg-teal-100",
};

/** Personel satırındaki beş işlem. Diğer roller bu bileşeni görmez. */
export function StaffFiveActions({
  ord,
  suffix = "",
  onPrint,
  onMissing,
  onProduce,
  onCargo,
  onLabel,
  layout = "row",
}) {
  const num = ord?.order_number || ord?.id || ord?._id || "x";
  const handlers = {
    print: onPrint,
    missing: onMissing,
    produce: onProduce,
    cargo: onCargo,
    label: onLabel,
  };
  const testId = {
    print: `print-order-btn${suffix}-${num}`,
    missing: `order-notify-missing${suffix}-${num}`,
    produce: `order-produce-choice${suffix}-${num}`,
    cargo: `create-cargo-btn${suffix}-${num}`,
    label: `print-label${suffix}-${num}`,
  };
  return (
    <>
      {ORDER_STAFF_ACTIONS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => handlers[id]?.(ord)}
          className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${TONE[id]} ${layout === "grid" ? "min-h-[44px]" : ""}`}
          data-testid={testId[id]}
          data-staff-action={id}
        >
          {LABELS[id]}
        </button>
      ))}
    </>
  );
}

/** Üretime al alt sayfası: eksik ürünler veya reçete emri. */
export function StaffProduceChoices({ onMissing, onRecipe, onCancel, busy = false }) {
  return (
    <div className="space-y-2" data-testid="order-produce-choice-sheet">
      <h2 className="text-sm font-bold text-slate-900">Üretime al</h2>
      <button
        type="button"
        onClick={onMissing}
        disabled={busy}
        className="w-full rounded-xl bg-orange-500 px-3 py-3 text-sm font-bold text-white disabled:opacity-60"
        data-testid="order-produce-missing"
      >
        Eksik ürünleri üretime al
      </button>
      <button
        type="button"
        onClick={onRecipe}
        disabled={busy}
        className="w-full rounded-xl bg-indigo-600 px-3 py-3 text-sm font-bold text-white disabled:opacity-60"
        data-testid="order-produce-btn"
      >
        Üretim emri ver
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700"
        data-testid="order-produce-cancel"
      >
        Vazgeç
      </button>
    </div>
  );
}

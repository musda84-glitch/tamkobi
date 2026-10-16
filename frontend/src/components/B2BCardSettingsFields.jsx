import React from "react";
import { MoneyInput } from "./MoneyInput";

export const CARD_SETTING_KEYS = [
  "card_payment_enabled",
  "card_max_installment",
  "card_commission_payer",
  "card_commission_rate",
];

export const CARD_COMPANY_DEFAULTS = {
  card_payment_enabled: false,
  card_max_installment: 1,
  card_commission_payer: "seller",
  card_commission_rate: 0,
  card_payment_required: false,
};

export function roundCardRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(20, Math.max(0, Math.round(n * 100) / 100));
}

export function cardInstallment(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(12, Math.max(1, n));
}

/**
 * Şirket varsayılanı veya cari override kart alanları.
 * Etkin sanal POS yoksa alanlar kilitlenir. Zorunlu ödeme PR-4b'ye kadar kapalıdır.
 */
export function B2BCardSettingsFields({
  settings,
  onChange,
  vposReady = false,
  showRequired = false,
  useCompanyDefault = false,
  onUseCompanyDefault,
  companyDefaults,
  testIdPrefix = "b2b-card",
}) {
  const locked = !vposReady || useCompanyDefault;
  const shown = useCompanyDefault && companyDefaults ? { ...CARD_COMPANY_DEFAULTS, ...companyDefaults } : (settings || {});
  const payer = shown.card_commission_payer === "buyer" ? "buyer" : "seller";
  const set = (key, value) => {
    if (locked) return;
    onChange?.(key, value);
  };
  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-fields`}>
      <div className="text-sm font-bold text-slate-900">Kartla bakiye ödemesi</div>
      {!vposReady && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2" data-testid={`${testIdPrefix}-vpos-hint`}>
          Önce Sanal POS ayarlayın
        </div>
      )}
      {onUseCompanyDefault && (
        <label className="flex items-start gap-2 bg-white border rounded-xl p-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={!!useCompanyDefault}
            onChange={(e) => onUseCompanyDefault(e.target.checked)}
            className="mt-0.5 rounded"
            data-testid={`${testIdPrefix}-use-default`}
          />
          <span>
            <span className="block font-semibold text-slate-800">Şirket varsayılanını kullan</span>
            <span className="block text-[10px] text-slate-500">İşaretliyken şirket ayarı geçerlidir. Kaldırınca bu cariye özel değer kaydedilir.</span>
          </span>
        </label>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className={`flex items-start gap-2 border rounded-xl p-2.5 ${locked ? "opacity-60" : "cursor-pointer"} bg-slate-50`}>
          <input
            type="checkbox"
            checked={!!shown.card_payment_enabled}
            disabled={locked}
            onChange={(e) => set("card_payment_enabled", e.target.checked)}
            className="mt-0.5 rounded"
            data-testid={`${testIdPrefix}-enabled`}
          />
          <span>
            <span className="block font-semibold text-slate-800">Kartla ödeme açık</span>
            <span className="block text-[10px] text-slate-500">Portalda açık bakiyeyi kartla tahsil eder</span>
          </span>
        </label>
        <div>
          <label className="block font-semibold mb-1">En fazla taksit</label>
          <select
            value={String(cardInstallment(shown.card_max_installment))}
            disabled={locked}
            onChange={(e) => set("card_max_installment", cardInstallment(e.target.value))}
            className="w-full bg-slate-50 border rounded-lg p-2 disabled:opacity-60"
            data-testid={`${testIdPrefix}-installment`}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={String(n)}>{n === 1 ? "Tek çekim" : `${n} taksit`}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1">Komisyonu ödeyen</label>
          <select
            value={payer}
            disabled={locked}
            onChange={(e) => set("card_commission_payer", e.target.value === "buyer" ? "buyer" : "seller")}
            className="w-full bg-slate-50 border rounded-lg p-2 disabled:opacity-60"
            data-testid={`${testIdPrefix}-payer`}
          >
            <option value="seller">Satıcı (müşteriye yansımaz)</option>
            <option value="buyer">Alıcı (tahsilata eklenir)</option>
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1">Komisyon oranı %</label>
          <MoneyInput
            value={roundCardRate(shown.card_commission_rate)}
            decimals={2}
            maxFractionDigits={2}
            disabled={locked}
            onChange={(n) => set("card_commission_rate", roundCardRate(n ?? 0))}
            className="w-full bg-slate-50 border rounded-lg p-2 disabled:opacity-60"
            data-testid={`${testIdPrefix}-rate`}
          />
        </div>
        {showRequired && (
          <label className="sm:col-span-2 flex items-start gap-2 border border-dashed rounded-xl p-2.5 opacity-60 bg-slate-50">
            <input
              type="checkbox"
              checked={!!shown.card_payment_required}
              disabled
              readOnly
              className="mt-0.5 rounded"
              data-testid={`${testIdPrefix}-required`}
            />
            <span>
              <span className="block font-semibold text-slate-800">Siparişte kart zorunlu</span>
              <span className="block text-[10px] text-slate-500">yakında</span>
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

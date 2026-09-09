
import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { SearchSelect } from "./SearchSelect";
import { VAT_OPTIONS, computeLine, emptyLine, fmtMoney, hydrateLine, lineFromProduct } from "../utils/documentLines";

const inp = "w-full bg-white border border-slate-200 rounded p-1.5 text-xs";

export function DocumentLineEditor({
  items,
  onChange,
  products = [],
  kind = "invoice",
  allowService = true,
  invoiceType = "sales",
  disabled = false,
  onAdd,
  testIdPrefix = "doc-line",
}) {
  const rows = (items || []).map((it) => hydrateLine(it));
  const setRows = (next) => onChange(next.map((it) => computeLine(it)));

  const patch = (index, field, value) => {
    const next = rows.map((it, i) => (i === index ? computeLine({ ...it, [field]: value }, field) : it));
    setRows(next);
  };

  const pickProduct = (index, id) => {
    const prod = products.find((p) => (p.id || p._id) === id);
    const next = rows.map((it, i) => {
      if (i !== index) return it;
      if (!prod) return { ...it, product_id: id };
      return lineFromProduct(prod, { invoiceType, quantity: it.quantity || 1 });
    });
    setRows(next);
  };

  const toggleService = (index) => {
    const next = rows.map((it, i) => {
      if (i !== index) return it;
      const is_service = !it.is_service;
      return computeLine({ ...it, is_service, product_id: is_service ? "" : it.product_id });
    });
    setRows(next);
  };

  const add = () => {
    if (onAdd) onAdd();
    else setRows([...rows, computeLine(emptyLine())]);
  };

  const remove = (index) => {
    if (rows.length <= 1 || disabled) return;
    setRows(rows.filter((_, i) => i !== index));
  };

  const nameOf = (it) => (kind === "order" ? it.product_name : it.name) || "";

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-editor`}>
      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full min-w-[980px] text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2 text-left min-w-[220px]">Stok adı / Hizmet</th>
              <th className="px-2 py-2 text-center w-20">Miktar</th>
              <th className="px-2 py-2 text-right w-28">Birim (KDV'siz)</th>
              <th className="px-2 py-2 text-right w-28">Birim (KDV'li)</th>
              <th className="px-2 py-2 text-center w-20 text-rose-500">İskonto %</th>
              <th className="px-2 py-2 text-center w-20">KDV %</th>
              <th className="px-2 py-2 text-right w-28">Tutar (Hariç)</th>
              <th className="px-2 py-2 text-right w-28">Tutar (Dahil)</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((item, idx) => (
              <tr key={idx} className="align-top" data-testid={`${testIdPrefix}-item-${idx}`}>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    {allowService && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleService(idx)}
                        className={`shrink-0 w-7 h-7 rounded-md text-[10px] font-bold border ${item.is_service ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-300"}`}
                        title={item.is_service ? "Hizmet satırı – ürüne çevir" : "Ürün satırı – hizmete çevir"}
                        data-testid={`${kind === "invoice" ? "inv-item-kind" : `${testIdPrefix}-kind`}-${idx}`}
                      >
                        {item.is_service ? "H" : "Ü"}
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      {item.is_service || !products.length ? (
                        <input
                          disabled={disabled}
                          value={nameOf(item)}
                          onChange={(e) => {
                            const v = e.target.value;
                            patch(idx, kind === "order" ? "product_name" : "name", v);
                          }}
                          placeholder="Hizmet / stok adı"
                          className={`${inp} ${item.is_service ? "border-indigo-200" : ""}`}
                          data-testid={kind === "invoice" && products.length ? `inv-item-service-name-${idx}` : `${testIdPrefix}-name-${idx}`}
                        />
                      ) : (
                        <>
                          <SearchSelect
                            value={item.product_id}
                            options={products}
                            placeholder="Ürün ara (ad / SKU / barkod)..."
                            getLabel={(p) => p.name}
                            getSub={(p) => `SKU ${p.sku || "—"} • Stok ${p.stock_quantity ?? "—"} • ${(p.sale_price || 0).toLocaleString("tr-TR")} ₺`}
                            getImage={(p) => p.image_url}
                            onChange={(id) => pickProduct(idx, id)}
                            testId={kind === "invoice" ? `inv-item-product-${idx}` : kind === "order" ? `new-order-product-${idx}` : `${testIdPrefix}-product-${idx}`}
                          />
                          {!item.product_id && (
                            <input
                              disabled={disabled}
                              value={nameOf(item)}
                              onChange={(e) => patch(idx, kind === "order" ? "product_name" : "name", e.target.value)}
                              placeholder="Stokta yoksa serbest ad yazın"
                              className={`${inp} mt-1`}
                              data-testid={kind === "order" ? `new-order-freename-${idx}` : `${testIdPrefix}-freename-${idx}`}
                            />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    disabled={disabled}
                    type="number"
                    min="0"
                    step="any"
                    value={item.quantity}
                    onChange={(e) => patch(idx, "quantity", e.target.value)}
                    className={`${inp} text-center`}
                    data-testid={kind === "order" ? `new-order-qty-${idx}` : `${testIdPrefix}-qty-${idx}`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    disabled={disabled}
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.unit_price}
                    onChange={(e) => patch(idx, "unit_price", e.target.value)}
                    className={`${inp} text-right`}
                    data-testid={kind === "order" ? `new-order-price-${idx}` : `${testIdPrefix}-price-excl-${idx}`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    disabled={disabled}
                    type="number"
                    step="0.01"
                    min="0"
                    value={Math.round((Number(item.unit_price_incl) || 0) * 10000) / 10000}
                    onChange={(e) => patch(idx, "unit_price_incl", e.target.value)}
                    className={`${inp} text-right`}
                    data-testid={`${testIdPrefix}-price-incl-${idx}`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    disabled={disabled}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={item.discount_rate || ""}
                    onChange={(e) => patch(idx, "discount_rate", e.target.value)}
                    className={`${inp} text-center text-rose-700 border-rose-200`}
                    data-testid={kind === "invoice" ? `inv-item-discount-${idx}` : `${testIdPrefix}-discount-${idx}`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    disabled={disabled}
                    value={item.vat_rate}
                    onChange={(e) => patch(idx, "vat_rate", e.target.value)}
                    className={inp}
                    data-testid={`${testIdPrefix}-vat-${idx}`}
                  >
                    {VAT_OPTIONS.map((v) => (
                      <option key={v} value={v}>%{v}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5 text-right font-semibold text-slate-800 whitespace-nowrap" data-testid={`${testIdPrefix}-total-excl-${idx}`}>
                  {fmtMoney(item.total)} ₺
                </td>
                <td className="px-2 py-1.5 text-right font-bold text-emerald-800 whitespace-nowrap" data-testid={`${testIdPrefix}-total-incl-${idx}`}>
                  {fmtMoney(item.total_incl)} ₺
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button
                    type="button"
                    disabled={disabled || rows.length <= 1}
                    onClick={() => remove(idx)}
                    className="p-1 text-rose-500 hover:bg-rose-50 rounded disabled:opacity-30"
                    data-testid={kind === "order" ? `new-order-remove-${idx}` : `${testIdPrefix}-remove-${idx}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={add}
          className="text-emerald-600 hover:text-emerald-700 font-semibold flex items-center gap-1"
          data-testid={kind === "invoice" ? "add-invoice-item-btn" : kind === "order" ? "new-order-add-item" : `${testIdPrefix}-add`}
        >
          <Plus className="w-3.5 h-3.5" /> Kalem Ekle
        </button>
      )}
    </div>
  );
}

export function LineTotalsFooter({ subtotal, vat, lineDiscount, grandTotal, extra }) {
  return (
    <div className="bg-slate-100 p-3 rounded-xl flex flex-col items-end space-y-1 text-slate-700 text-xs">
      <div className="flex justify-between w-80"><span>Mal / Hizmet Toplamı (KDV Hariç):</span><span className="font-semibold">{fmtMoney(subtotal + (lineDiscount || 0))} ₺</span></div>
      {lineDiscount > 0 && <div className="flex justify-between w-80 text-rose-600"><span>Satır İskontoları:</span><span>-{fmtMoney(lineDiscount)} ₺</span></div>}
      {extra}
      <div className="flex justify-between w-80 border-t border-slate-300 pt-1"><span>Ara Toplam (KDV Hariç):</span><span className="font-semibold">{fmtMoney(subtotal)} ₺</span></div>
      <div className="flex justify-between w-80"><span>Toplam KDV:</span><span className="font-semibold">{fmtMoney(vat)} ₺</span></div>
      <div className="flex justify-between w-80 text-sm font-bold text-slate-900 pt-1 border-t border-slate-300"><span>Genel Toplam (KDV Dahil):</span><span className="text-emerald-700">{fmtMoney(grandTotal)} ₺</span></div>
    </div>
  );
}

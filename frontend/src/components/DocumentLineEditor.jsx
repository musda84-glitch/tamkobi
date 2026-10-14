
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Plus, Trash2 } from "lucide-react";
import { SearchSelect } from "./SearchSelect";
import { API_URL, useAuth } from "../context/AuthContext";
import { VAT_OPTIONS, computeLine, emptyLine, fmtMoney, hydrateLine, lineFromProduct, productCardPrice } from "../utils/documentLines";
import { MoneyInput, QuantityInput } from "./MoneyInput";

const inp = "h-8 w-full bg-white border border-slate-200 rounded px-1.5 text-xs box-border";
const FALLBACK_UNITS = ["Adet", "Metre", "Kg", "Mt", "Paket", "Koli"];

const unitOptions = (units, current) => {
  const core = ["Adet", "Metre"];
  const list = [...core, ...(units || []).filter((u) => u && !core.includes(u))];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
};

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
  defaultVat = 20,
  currency = "TRY",
  getProductExtra,
  renderRowExtra,
}) {
  const ccy = currency || "TRY";
  const { activeCompany } = useAuth();
  const [units, setUnits] = useState(FALLBACK_UNITS);
  const [openExtra, setOpenExtra] = useState({});
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    const companyId = activeCompany?.id || activeCompany?._id;
    if (!companyId) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/products/units?company_id=${companyId}`).then((r) => {
      if (cancelled) return;
      const names = (r.data || []).map((u) => u.name).filter(Boolean);
      if (names.length) setUnits(unitOptions(names));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeCompany]);
  const rows = (items || []).map((it) => hydrateLine(it));
  const setRows = (next) => onChange(next.map((it) => computeLine(it)));

  const patch = (index, field, value) => {
    const next = rows.map((it, i) => {
      if (i !== index) return it;
      const updated = { ...it, [field]: value };
      // Ad alanları senkron kalsın; boşaltınca product_name eski değeri geri getirmesin.
      if (field === "name" || field === "product_name") {
        updated.name = value;
        updated.product_name = value;
      }
      return computeLine(updated, field);
    });
    setRows(next);
  };

  const setLineNumber = (index, field, n) => {
    if (n == null) return;
    patch(index, field, n);
  };

  const applyProductLine = (index, prod, id) => {
    const latest = (itemsRef.current || []).map((it) => hydrateLine(it));
    const qty = latest[index]?.quantity || 1;
    const next = latest.map((it, i) => {
      if (i !== index) return it;
      if (!prod) {
        // Seçim kaldırıldıysa product_id temizlensin ("" || eskiId hatası olmasın).
        const cleared = id == null || id === "";
        return {
          ...it,
          product_id: cleared ? "" : (id || it.product_id),
          ...(cleared ? { name: it.name || it.product_name || "", product_name: it.product_name || it.name || "" } : {}),
        };
      }
      return lineFromProduct(prod, { invoiceType, quantity: qty });
    });
    setRows(next);
  };

  const pickProduct = (index, id, selected) => {
    const sid = id != null && id !== "" ? String(id) : "";
    const prod =
      selected && (selected.id || selected._id || selected.name)
        ? selected
        : products.find((p) => String(p.id || p._id || "") === sid);
    applyProductLine(index, prod, sid);
    // Liste eksik/eskiyse veya fiyat 0 ise stok kartından güncel fiyatı çek
    if (!sid) return;
    if (productCardPrice(prod, invoiceType) > 0) return;
    axios
      .get(`${API_URL}/products/${encodeURIComponent(sid)}`)
      .then((r) => {
        const full = r.data;
        if (!full || productCardPrice(full, invoiceType) <= 0) return;
        applyProductLine(index, full, sid);
      })
      .catch(() => {});
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
    else setRows([...rows, computeLine(emptyLine({ vat_rate: defaultVat }))]);
  };

  const remove = (index) => {
    if (rows.length <= 1 || disabled) return;
    setRows(rows.filter((_, i) => i !== index));
  };

  const nameOf = (it) => (kind === "order" ? it.product_name : it.name) || "";
  const nameField = kind === "order" ? "product_name" : "name";
  const extraShown = (item, idx) => (openExtra[idx] != null ? !!openExtra[idx] : !!(item.gtip || item.origin_country));

  return (
    <div className="space-y-1" data-testid={`${testIdPrefix}-editor`}>
      <div className="border border-slate-200 rounded-xl min-w-0 doc-line-table" data-line-table>
        <table className="w-full min-w-[1080px] text-xs border-separate border-spacing-0">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 sticky top-0 z-[2] [&_th]:bg-slate-50">
            <tr>
              <th className="px-2 py-1.5 text-left min-w-[220px] sticky top-0 bg-slate-50">Stok adı / Hizmet</th>
              <th className="px-2 py-1.5 text-center w-20 sticky top-0 bg-slate-50">Miktar</th>
              <th className="px-2 py-1.5 text-center w-24 sticky top-0 bg-slate-50">Birim</th>
              <th className="px-2 py-1.5 text-right w-28 sticky top-0 bg-slate-50">Birim (KDV'siz)</th>
              <th className="px-2 py-1.5 text-right w-28 sticky top-0 bg-slate-50">Birim (KDV'li)</th>
              <th className="px-2 py-1.5 text-center w-20 text-rose-500 sticky top-0 bg-slate-50">İskonto %</th>
              <th className="px-2 py-1.5 text-center w-20 sticky top-0 bg-slate-50">KDV %</th>
              <th className="px-2 py-1.5 text-right w-28 sticky top-0 bg-slate-50">Tutar (Hariç)</th>
              <th className="px-2 py-1.5 text-right w-28 sticky top-0 bg-slate-50">Tutar (Dahil)</th>
              <th className="w-8 sticky top-0 bg-slate-50"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((item, idx) => (
              <React.Fragment key={idx}>
              <tr className="doc-line-row align-middle" data-line-row="" data-testid={`${testIdPrefix}-item-${idx}`}>
                <td className="px-1.5">
                  <div className="flex items-center gap-1 h-8">
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
                            patch(idx, nameField, v);
                          }}
                          placeholder={item.is_service ? "Hizmet / stok adı" : "Stokta yoksa serbest ad yazın"}
                          className={`${inp} ${item.is_service ? "border-indigo-200" : ""}`}
                          data-testid={kind === "invoice" && products.length ? `inv-item-service-name-${idx}` : `${testIdPrefix}-name-${idx}`}
                        />
                      ) : (
                        <SearchSelect
                          dense
                          value={item.product_id}
                          options={products}
                          placeholder="Ürün ara (ad / SKU / barkod)..."
                          getLabel={(p) => p.name}
                          getSub={(p) => `${p.unit || "Adet"} • SKU ${p.sku || "—"} • Stok ${p.stock_quantity ?? "—"}`}
                          getExtra={getProductExtra || ((p) => {
                            const price = productCardPrice(p, invoiceType);
                            if (!(price > 0)) return "";
                            const incl = invoiceType !== "purchase" && p.price_includes_vat;
                            return `Stok kartı: ${fmtMoney(price, ccy)}${incl ? " (KDV dahil)" : ""}`;
                          })}
                          getImage={(p) => p.image_url}
                          valueLabel={nameOf(item)}
                          onChange={(id, p) => pickProduct(idx, id, p)}
                          clearable
                          clearLabel="Ürün seçimini kaldır"
                          testId={kind === "invoice" ? `inv-item-product-${idx}` : kind === "order" ? `new-order-product-${idx}` : `${testIdPrefix}-product-${idx}`}
                          freeTextValue={nameOf(item)}
                          onFreeTextChange={(v) => patch(idx, nameField, v)}
                          freeTextPlaceholder="Stokta yoksa serbest ad yazın"
                          freeTextDisabled={disabled}
                          freeTextTestId={kind === "order" ? `new-order-freename-${idx}` : `${testIdPrefix}-name-${idx}`}
                        />
                      )}
                    </div>
                    {renderRowExtra ? (
                      <button
                        type="button"
                        onClick={() => setOpenExtra((s) => {
                          const current = s[idx] != null ? !!s[idx] : !!(item.gtip || item.origin_country);
                          return { ...s, [idx]: !current };
                        })}
                        className={`shrink-0 h-7 px-1.5 rounded-md border text-[10px] font-semibold ${extraShown(item, idx) ? "bg-slate-100 text-slate-700 border-slate-300" : "bg-white text-slate-400 border-slate-200"}`}
                        title="GTIP, menşe ve önceki alış"
                        data-testid={`${testIdPrefix}-extra-${idx}`}
                      >
                        GTIP
                      </button>
                    ) : null}
                  </div>
                </td>
                <td className="px-1.5">
                  <QuantityInput
                    disabled={disabled}
                    selectOnFocus
                    value={item.quantity}
                    onChange={(n) => setLineNumber(idx, "quantity", n)}
                    className={`${inp} text-center`}
                    data-testid={kind === "order" ? `new-order-qty-${idx}` : `${testIdPrefix}-qty-${idx}`}
                  />
                </td>
                <td className="px-1.5">
                  <select
                    disabled={disabled}
                    value={item.unit || "Adet"}
                    onChange={(e) => patch(idx, "unit", e.target.value)}
                    className={inp}
                    data-testid={`${testIdPrefix}-unit-${idx}`}
                  >
                    {(unitOptions(units, item.unit || "Adet")).map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </td>
                <td className="px-1.5">
                  <MoneyInput
                    disabled={disabled}
                    selectOnFocus
                    value={item.unit_price}
                    onChange={(n) => setLineNumber(idx, "unit_price", n)}
                    className={`${inp} text-right`}
                    data-testid={kind === "order" ? `new-order-price-${idx}` : testIdPrefix === "inv-item" ? `inv-item-unit-price-${idx}` : `${testIdPrefix}-price-excl-${idx}`}
                  />
                </td>
                <td className="px-1.5">
                  <MoneyInput
                    disabled={disabled}
                    selectOnFocus
                    value={item.unit_price_incl}
                    onChange={(n) => setLineNumber(idx, "unit_price_incl", n)}
                    className={`${inp} text-right`}
                    data-testid={`${testIdPrefix}-price-incl-${idx}`}
                  />
                </td>
                <td className="px-1.5">
                  <MoneyInput
                    disabled={disabled}
                    selectOnFocus
                    value={item.discount_rate || ""}
                    onChange={(n) => setLineNumber(idx, "discount_rate", n)}
                    className={`${inp} text-center text-rose-700 border-rose-200`}
                    data-testid={kind === "invoice" ? `inv-item-discount-${idx}` : `${testIdPrefix}-discount-${idx}`}
                  />
                </td>
                <td className="px-1.5">
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
                <td className="px-1.5 text-right font-semibold text-slate-800 whitespace-nowrap" data-testid={`${testIdPrefix}-total-excl-${idx}`}>
                  {fmtMoney(item.total, ccy)}
                </td>
                <td className="px-1.5">
                  <MoneyInput
                    disabled={disabled}
                    selectOnFocus
                    value={item.total_incl}
                    onChange={(n) => setLineNumber(idx, "total_incl", n)}
                    className={`${inp} text-right font-bold text-emerald-800`}
                    title="Satır toplamını (KDV dahil) düzenle — birim fiyata yansır"
                    data-testid={`${testIdPrefix}-total-incl-${idx}`}
                  />
                </td>
                <td className="px-1 text-center">
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
              {renderRowExtra && extraShown(item, idx) ? (
                <tr className="bg-slate-50/60" data-line-extra="">
                  <td colSpan={10} className="px-2 py-1">
                    {renderRowExtra(item, idx, {
                      patch: (field, value) => patch(idx, field, value),
                    })}
                  </td>
                </tr>
              ) : null}
              </React.Fragment>
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

export function LineTotalsFooter({ subtotal, vat, lineDiscount, grandTotal, extra, currency = "TRY" }) {
  const ccy = currency || "TRY";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-700 min-w-0" data-testid="line-totals-footer">
      <span>Mal/Hizmet <b className="text-slate-900">{fmtMoney(subtotal + (lineDiscount || 0), ccy)}</b></span>
      {lineDiscount > 0 && <span className="text-rose-600">İskonto <b>-{fmtMoney(lineDiscount, ccy)}</b></span>}
      {extra}
      <span>Ara toplam <b>{fmtMoney(subtotal, ccy)}</b></span>
      <span>KDV <b>{fmtMoney(vat, ccy)}</b></span>
      <span className="font-bold text-slate-900">Genel Toplam <b className="text-emerald-700">{fmtMoney(grandTotal, ccy)}</b></span>
    </div>
  );
}

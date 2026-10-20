import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL, useAuth } from "../../context/AuthContext";
import { PrintDocument } from "../PrintDocument";
import { CreateShipmentModal } from "../CreateShipmentModal";
import { OrderProduceRecipeModal } from "../OrderProduceRecipeModal";
import { OrderCancelRequestBadge } from "../OrderCancelRequestDialog";
import { activeCompanyId } from "../../utils/activeCompanyId";
import { channelTr, marketplaceStatusTr, orderStatusBadgeClass, statusTr } from "../../utils/labels";
import { formatTrAmount } from "../../utils/money";
import { orderInvoiceBadge } from "../../utils/orderMoreMenu";
import { formatOrderDateTime } from "../../utils/orderTermin";
import { pickLineNote } from "../../utils/pickLineNote";
import { isOrderStaffMode } from "../../utils/selfPersonnelNav";
import { orderStatusLabel, isWarehouseShipped } from "../../utils/warehouseShip";
import { printCargoLabelsPreferIntegrator } from "../../utils/cargoLabelPrint";
import {
  ORDER_LIST_FILTERS,
  ORDER_LIST_FILTER_DEFAULT,
  filterOrders,
  orderListEmptyTitle,
  orderListFilterCounts,
} from "../../utils/orderListFilter";
import { StaffFiveActions, StaffProduceChoices } from "./staffOrderActions";

const CHANNEL_LOGO = {
  trendyol: "https://cdn.dsmcdn.com/web/logo/ty-web.svg",
  hepsiburada: "https://images.hepsiburada.net/assets/sfstatic/Content/images/favicon.ico",
  n11: "https://www.google.com/s2/favicons?domain=n11.com&sz=64",
  shopify: "https://cdn.shopify.com/shopifycloud/web/assets/v1/favicon.ico",
  ciceksepeti: "https://www.google.com/s2/favicons?domain=ciceksepeti.com&sz=64",
  pazarama: "https://www.google.com/s2/favicons?domain=pazarama.com&sz=64",
};

function orderIdOf(row) {
  return String(row?.id || row?._id || "");
}

function ChannelMark({ channel, testId, size = 36 }) {
  const key = String(channel || "").toLowerCase();
  const url = CHANNEL_LOGO[key];
  const label = channelTr(key);
  if (url) {
    return (
      <img
        src={url}
        alt={label}
        width={size}
        height={size}
        data-testid={testId}
        className="rounded-lg border border-slate-200 bg-white object-contain p-0.5 shrink-0"
      />
    );
  }
  const letter = String(label || "?").replace("—", "?").slice(0, 1).toUpperCase();
  return (
    <span
      data-testid={testId}
      aria-label={label}
      className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 shrink-0"
      style={{ width: size, height: size }}
    >
      {letter}
    </span>
  );
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}

/**
 * Personel + portal_orders, dar ekran.
 * Liste → detay (5 işlem) → Üretime al. Gizli işlemler kutusu yok.
 */
export default function OrdersStaffMobile() {
  const { user, loading, feature, activeCompany } = useAuth();
  const showPrices = feature("view_prices");
  const companyId = activeCompanyId(activeCompany);
  const allowed = loading !== true && !!user && isOrderStaffMode(user);
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(ORDER_LIST_FILTER_DEFAULT);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [view, setView] = useState("list");
  const [order, setOrder] = useState(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [printDoc, setPrintDoc] = useState(null);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const epochRef = useRef(0);

  const load = useCallback(async (epoch, signal) => {
    if (!companyId) return;
    setListLoading(true);
    try {
      const r = await axios.get(`${API_URL}/orders`, { params: { company_id: companyId }, signal });
      if (epoch !== epochRef.current) return;
      setRows(rowsOf(r.data));
      setError("");
    } catch (err) {
      if (epoch !== epochRef.current) return;
      if (axios.isCancel?.(err) || err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
      setError(err.response?.data?.detail || "Siparişler yüklenemedi.");
    } finally {
      if (epoch === epochRef.current) setListLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    epochRef.current += 1;
    setRows([]);
    setOrder(null);
    setView("list");
    setError("");
  }, [companyId]);

  useEffect(() => {
    if (!allowed || !companyId) return undefined;
    const epoch = epochRef.current;
    const controller = new AbortController();
    load(epoch, controller.signal);
    return () => controller.abort();
  }, [allowed, companyId, load]);

  const counts = useMemo(() => orderListFilterCounts(rows), [rows]);
  const filtered = useMemo(() => filterOrders(rows, filter, q), [rows, filter, q]);

  const openOrder = async (row) => {
    const epoch = epochRef.current;
    setOrder(row);
    setView("detail");
    setError("");
    setMessage("");
    const id = orderIdOf(row);
    if (!id) return;
    try {
      const r = await axios.get(`${API_URL}/orders/${id}`);
      if (epoch !== epochRef.current) return;
      if (r.data && typeof r.data === "object" && !Array.isArray(r.data)) setOrder(r.data);
    } catch (err) {
      if (epoch !== epochRef.current) return;
      setError(err.response?.data?.detail || "Sipariş yüklenemedi.");
    }
  };

  const refreshOrder = async () => {
    const epoch = epochRef.current;
    const id = orderIdOf(order);
    await load(epoch);
    if (epoch !== epochRef.current || !id) return;
    try {
      const r = await axios.get(`${API_URL}/orders/${id}`);
      if (epoch !== epochRef.current) return;
      if (r.data) setOrder(r.data);
    } catch { /* liste yenilendi */ }
  };

  const notifyMissing = async (ord) => {
    const id = orderIdOf(ord);
    if (!id) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/order-picks/${id}/notify-missing`, {});
      const msg = r.data?.message || "Eksik bildirimi gönderildi.";
      setMessage(msg);
      toast.success(msg);
      await refreshOrder();
    } catch (err) {
      const msg = err.response?.data?.detail || "Eksik bildirimi gönderilemedi.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const produceMissing = async (ord) => {
    const id = orderIdOf(ord);
    if (!id) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/order-picks/${id}/to-production`, {});
      const msg = r.data?.message || "Eksik ürünler üretime alındı.";
      setMessage(msg);
      toast.success(msg);
      setView("detail");
      await refreshOrder();
    } catch (err) {
      const msg = err.response?.data?.detail || "Eksik ürünler üretime alınamadı.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const openCargo = (ord) => {
    if (ord?.cargo_tracking_number || isWarehouseShipped(ord)) {
      const msg = "Bu sipariş zaten kargolandı.";
      setError(msg);
      toast.error(msg);
      return;
    }
    setShipOpen(true);
  };

  const printLabel = async (ord) => {
    const id = orderIdOf(ord);
    setBusy(true);
    try {
      const r = await printCargoLabelsPreferIntegrator([ord], activeCompany, {
        apiUrl: API_URL,
        axiosClient: axios,
        size: "100x150",
      });
      if (r.ok || r.thermal) {
        if (id) {
          axios.post(`${API_URL}/orders/mark-labels-printed`, { ids: [id] }).catch(() => {});
        }
        const msg = r.message || "Kargo etiketi yazdırmaya gönderildi.";
        setMessage(msg);
        toast.success(msg);
      } else {
        const msg = r.message || "Etiket yazdırılamadı.";
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) return null;

  const money = (n) => `${formatTrAmount(n)} ₺`;

  return (
    <div className="space-y-3" data-testid="orders-staff-mobile">
      {printDoc && (
        <PrintDocument
          docType="order"
          doc={printDoc}
          company={activeCompany}
          onClose={() => setPrintDoc(null)}
          onPrinted={(doc) => {
            const id = doc?.id || doc?._id;
            if (!id) return;
            axios.post(`${API_URL}/orders/mark-form-printed`, { ids: [id] }).catch(() => {});
          }}
        />
      )}
      {shipOpen && order && (
        <CreateShipmentModal
          order={order}
          companyId={companyId}
          onClose={() => setShipOpen(false)}
          onDone={() => { setShipOpen(false); refreshOrder(); }}
        />
      )}
      {recipeOpen && order && (
        <OrderProduceRecipeModal
          order={order}
          companyId={companyId}
          lineCount={(order.items || []).length}
          busy={busy}
          onClose={() => !busy && setRecipeOpen(false)}
          onConfirm={async (station) => {
            const id = orderIdOf(order);
            const st = String(station || "").trim();
            if (!id || !st) return;
            setBusy(true);
            try {
              const r = await axios.post(`${API_URL}/orders/${id}/production-recipe`, {
                station: st,
                default_station: st,
              });
              const msg = r.data?.message || `Reçete ve üretim emri oluşturuldu (${st}).`;
              setMessage(msg);
              toast.success(msg);
              setRecipeOpen(false);
              setView("detail");
              await refreshOrder();
            } catch (err) {
              const msg = err.response?.data?.detail || "Reçete / üretim emri oluşturulamadı.";
              setError(msg);
              toast.error(msg);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {view === "list" && (
        <>
          <div className="grid grid-cols-3 gap-1.5" data-testid="order-filter">
            {ORDER_LIST_FILTERS.map((tab) => {
              const active = filter === tab.key;
              const count = counts[tab.key] || 0;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilter(tab.key)}
                  aria-pressed={active}
                  data-testid={`order-filter-${tab.key}`}
                  className={`rounded-xl border px-2 py-2 text-left text-[11px] font-bold ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200"}`}
                >
                  <span className="block">{tab.label}</span>
                  <span className={`text-[10px] font-semibold ${active ? "text-slate-200" : "text-slate-400"}`} data-testid={`order-filter-count-${tab.key}`}>{count}</span>
                </button>
              );
            })}
          </div>
          <label className="block text-xs font-semibold text-slate-600">
            Ara
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Sipariş no / müşteri"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
              data-testid="order-search"
            />
          </label>
          {error ? <p className="text-xs text-rose-700" data-testid="order-staff-error">{error}</p> : null}
          {message ? <p className="text-xs text-slate-500">{message}</p> : null}
          {listLoading && rows.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">Yükleniyor…</p>
          ) : null}
          {!listLoading && filtered.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8" data-testid="order-staff-empty">{orderListEmptyTitle(filter)}</p>
          ) : null}
          <div className="space-y-2">
            {filtered.map((row) => {
              const id = orderIdOf(row);
              const held = !!(row.is_held_cart || row.is_active_cart || row.order_status === "held_cart" || row.order_status === "active_cart");
              const title = held ? (row.held_label || row.order_number) : (row.order_number || "Sipariş");
              const date = formatOrderDateTime(row.order_date || row.created_at);
              const subtitle = [
                row.customer_name,
                row.marketplace_status ? marketplaceStatusTr(row.marketplace_status) : null,
                orderStatusLabel(row, statusTr(row.order_status)),
                date,
              ].filter(Boolean).join(" · ");
              const inv = orderInvoiceBadge(row);
              return (
                <button
                  key={id || row.order_number}
                  type="button"
                  onClick={() => openOrder(row)}
                  data-testid={`order-row-${id || row.order_number}`}
                  className={`w-full text-left bg-white border border-slate-200 rounded-2xl p-3 space-y-1.5 ${held ? "opacity-70" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <ChannelMark channel={row.channel} testId={`order-channel-${id || row.order_number}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-bold text-slate-900 truncate">{title}</div>
                      <div className="text-[11px] text-slate-500 truncate">{subtitle}</div>
                    </div>
                    {showPrices ? (
                      <div className="shrink-0 text-xs font-bold text-slate-900" data-testid={`order-amount-${id || row.order_number}`}>
                        {money(row.grand_total ?? row.total_amount)}
                      </div>
                    ) : null}
                  </div>
                  {inv?.label ? (
                    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${inv.className}`} data-testid={`order-invoice-badge-${row.order_number}`}>
                      {inv.label}
                    </span>
                  ) : null}
                  <OrderCancelRequestBadge ord={row} />
                </button>
              );
            })}
          </div>
        </>
      )}

      {view === "detail" && order && (
        <OrderStaffDetail
          order={order}
          showPrices={showPrices}
          busy={busy}
          error={error}
          message={message}
          onBack={() => { setView("list"); setError(""); setMessage(""); }}
          onPrint={() => setPrintDoc(order)}
          onMissing={notifyMissing}
          onProduce={() => setView("produce")}
          onCargo={openCargo}
          onLabel={printLabel}
        />
      )}

      {view === "produce" && order && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="orders-staff-produce">
          <p className="text-[11px] text-slate-500">{order.held_label || order.order_number}</p>
          <StaffProduceChoices
            busy={busy}
            onMissing={() => produceMissing(order)}
            onRecipe={() => setRecipeOpen(true)}
            onCancel={() => setView("detail")}
          />
          {error ? <p className="text-xs text-rose-700">{error}</p> : null}
        </div>
      )}
    </div>
  );
}

function OrderStaffDetail({
  order,
  showPrices,
  busy,
  error,
  message,
  onBack,
  onPrint,
  onMissing,
  onProduce,
  onCargo,
  onLabel,
}) {
  const date = formatOrderDateTime(order.order_date || order.created_at);
  const status = orderStatusLabel(order, statusTr(order.order_status));
  const cargo = order.cargo_carrier_name || order.cargo_carrier;
  return (
    <div className="space-y-3" data-testid="orders-staff-detail">
      <button type="button" onClick={onBack} className="text-sm font-semibold text-slate-700" data-testid="order-staff-back">
        ‹ Sipariş
      </button>
      <div className="flex items-center gap-2.5">
        <ChannelMark channel={order.channel} testId="order-detail-channel" size={40} />
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{order.held_label || order.order_number || "Sipariş"}</h1>
          <p className="text-xs text-slate-500 truncate">{order.customer_name}</p>
          {date ? <p className="text-xs text-slate-400">{date}</p> : null}
        </div>
      </div>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      {message ? <p className="text-xs text-slate-500">{message}</p> : null}
      <div className="grid grid-cols-2 gap-2" data-testid="order-staff-actions">
        <StaffFiveActions
          ord={order}
          layout="grid"
          onPrint={onPrint}
          onMissing={onMissing}
          onProduce={onProduce}
          onCargo={onCargo}
          onLabel={onLabel}
        />
      </div>
      {busy ? <p className="text-[11px] text-slate-400">Hazırlanıyor…</p> : null}
      <p className="text-[11px] text-slate-500" data-testid="order-staff-note">
        Personel görünümü: yalnız 5 işlem. Diğer işlemler gizli.
      </p>
      <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2 text-xs" data-testid="order-staff-info">
        <div className="flex flex-wrap gap-1">
          <span className="px-1.5 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-800 font-semibold">{channelTr(order.channel)}</span>
          <span className={`px-1.5 py-0.5 rounded border font-semibold ${orderStatusBadgeClass(order.order_status)}`}>{status}</span>
          {cargo ? <span className="px-1.5 py-0.5 rounded border border-teal-200 bg-teal-50 text-teal-800 font-semibold">{cargo}</span> : null}
          {order.cargo_tracking_number ? <span className="px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 font-mono">{order.cargo_tracking_number}</span> : null}
        </div>
        {showPrices ? (
          <div className="text-lg font-extrabold text-slate-900" data-testid="order-detail-total">
            {`${formatTrAmount(order.grand_total || order.total_amount)} ₺`}
          </div>
        ) : null}
        {order.shipping_address ? <p className="text-slate-500">{order.shipping_address} {order.city || ""}</p> : null}
        {order.notes ? <p className="text-slate-500">{order.notes}</p> : null}
      </div>
      <h2 className="text-sm font-bold text-slate-900">Kalemler</h2>
      <div className="space-y-2">
        {(order.items || []).map((it, i) => {
          const stockNote = pickLineNote(it);
          const qty = it.quantity ?? "";
          return (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-3" data-testid={`order-item-${i}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{it.product_name || it.name || "Kalem"}</div>
                  <div className="text-[11px] text-slate-500">
                    {showPrices ? `${qty} × ${formatTrAmount(it.unit_price)} ₺` : String(qty)}
                  </div>
                  {stockNote ? <div className="text-[11px] text-slate-500">Sipariş stok notu · {stockNote}</div> : null}
                </div>
                {showPrices ? (
                  <div className="text-xs font-bold text-slate-900 shrink-0" data-testid={`order-item-total-${i}`}>
                    {`${formatTrAmount(it.total_incl || it.total)} ₺`}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

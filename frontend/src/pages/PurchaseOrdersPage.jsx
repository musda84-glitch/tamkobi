import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { ShoppingCart, RefreshCw, Trash2, FileText, Send, PackageCheck, X } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";

const fmt = (n) => formatTrAmount((Number(n) || 0));

const STATUS = {
  draft: ["Taslak", "bg-slate-100 text-slate-700"],
  sent: ["Gönderildi", "bg-blue-50 text-blue-700"],
  received: ["Teslim alındı", "bg-amber-50 text-amber-800"],
  invoiced: ["Faturalandı", "bg-emerald-50 text-emerald-700"],
  cancelled: ["İptal", "bg-rose-50 text-rose-700"],
};

const Badge = ({ s }) => {
  const [l, c] = STATUS[s] || [s, "bg-slate-100"];
  return <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${c}`}>{l}</span>;
};

export default function PurchaseOrdersPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id;
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/purchase-orders?company_id=${companyId}`);
      setRows(r.data || []);
    } catch {
      toast.error("Verilen siparişler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id, order_status) => {
    setBusyId(id);
    try {
      await axios.put(`${API_URL}/purchase-orders/${id}/status`, { order_status });
      toast.success("Durum güncellendi.");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Güncellenemedi.");
    } finally {
      setBusyId(null);
    }
  };

  const toInvoice = async (id) => {
    if (!window.confirm("Bu verilen siparişten taslak alış faturası oluşturulsun mu?")) return;
    setBusyId(id);
    try {
      const r = await axios.post(`${API_URL}/purchase-orders/${id}/convert-to-invoice`);
      toast.success(r.data.message || "Alış faturası oluşturuldu.");
      await load();
      const invId = r.data?.invoice?.id;
      if (invId) navigate(`/invoices?type=purchase`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Fatura oluşturulamadı.");
    } finally {
      setBusyId(null);
    }
  };

  const del = async (id, number) => {
    if (!window.confirm(`${number} silinsin mi?`)) return;
    setBusyId(id);
    try {
      await axios.delete(`${API_URL}/purchase-orders/${id}`);
      toast.success("Silindi.");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    } finally {
      setBusyId(null);
    }
  };

  const visible = rows.filter((r) => !filter || r.order_status === filter);

  return (
    <div className="space-y-6" data-testid="purchase-orders-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-amber-700" /> Verilen Siparişler
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Tedarikçiye verilen alış siparişleri. Stok kartından kritik stok siparişi buraya düşer; faturalama ayrı adımdır.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/stock" className="px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-slate-50" data-testid="po-go-stock">
            Stoktan sipariş
          </Link>
          <button type="button" onClick={load} className="px-3 py-1.5 border rounded-lg text-xs font-semibold flex items-center gap-1" data-testid="po-refresh">
            <RefreshCw className="w-3.5 h-3.5" /> Yenile
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="po-status-filter">
        {[["", "Tümü"], ["draft", "Taslak"], ["sent", "Gönderildi"], ["received", "Teslim"], ["invoiced", "Faturalı"], ["cancelled", "İptal"]].map(([k, l]) => (
          <button
            key={k || "all"}
            type="button"
            onClick={() => setFilter(k)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${filter === k ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-xs text-slate-400 py-12">Yükleniyor…</div>
      ) : visible.length === 0 ? (
        <div className="text-center text-xs text-slate-400 py-12 bg-white border border-dashed rounded-2xl" data-testid="po-empty">
          Henüz verilen sipariş yok. Stok listesinde kritik stoktan sipariş oluşturun.
        </div>
      ) : (
        <>
          <div className="md:hidden space-y-3">
            {visible.map((o) => (
              <div key={o.id} className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2 text-xs" data-testid={`po-card-${o.order_number}`}>
                <div className="flex justify-between gap-2 items-start">
                  <div>
                    <div className="font-mono font-bold">{o.order_number}</div>
                    <div className="font-semibold mt-0.5">{o.supplier_name}</div>
                    <div className="text-slate-500">{(o.order_date || "").slice(0, 10)} · {(o.items || []).length} kalem</div>
                  </div>
                  <Badge s={o.order_status} />
                </div>
                <div className="font-bold text-slate-900">{fmt(o.grand_total)} ₺</div>
                <PoActions o={o} busy={busyId === o.id} setStatus={setStatus} toInvoice={toInvoice} del={del} />
              </div>
            ))}
          </div>
          <div className="hidden md:block bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="min-w-[800px] w-full text-left text-xs">
              <thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-semibold">
                <tr>
                  <th className="px-4 py-2">Sipariş</th>
                  <th className="px-4 py-2">Tedarikçi</th>
                  <th className="px-4 py-2">Kalem</th>
                  <th className="px-4 py-2 text-right">Tutar</th>
                  <th className="px-4 py-2">Durum</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((o) => (
                  <tr key={o.id} data-testid={`po-row-${o.order_number}`}>
                    <td className="px-4 py-2">
                      <div className="font-mono font-bold">{o.order_number}</div>
                      <div className="text-slate-400">{(o.order_date || "").slice(0, 10)}</div>
                      {o.source_channel === "stock_reorder" && <div className="text-[10px] text-amber-700 font-semibold">Stok siparişi</div>}
                    </td>
                    <td className="px-4 py-2 font-semibold">{o.supplier_name}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {(o.items || []).slice(0, 3).map((it) => (
                        <div key={`${it.product_id}-${it.product_name}`}>{it.quantity}× {it.product_name}</div>
                      ))}
                      {(o.items || []).length > 3 && <div className="text-slate-400">+{(o.items || []).length - 3} kalem</div>}
                    </td>
                    <td className="px-4 py-2 text-right font-bold">{fmt(o.grand_total)} ₺</td>
                    <td className="px-4 py-2"><Badge s={o.order_status} /></td>
                    <td className="px-4 py-2"><PoActions o={o} busy={busyId === o.id} setStatus={setStatus} toInvoice={toInvoice} del={del} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PoActions({ o, busy, setStatus, toInvoice, del }) {
  const done = o.order_status === "invoiced" || o.order_status === "cancelled";
  return (
    <div className="flex flex-wrap justify-end gap-1" data-testid={`po-actions-${o.order_number}`}>
      {o.order_status === "draft" && (
        <button type="button" disabled={busy} onClick={() => setStatus(o.id, "sent")} className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid={`po-send-${o.order_number}`}>
          <Send className="w-3 h-3" /> Gönder
        </button>
      )}
      {(o.order_status === "sent" || o.order_status === "draft") && (
        <button type="button" disabled={busy} onClick={() => setStatus(o.id, "received")} className="flex items-center gap-1 px-2 py-1 border border-amber-200 bg-amber-50 text-amber-900 rounded-lg font-semibold disabled:opacity-50" data-testid={`po-receive-${o.order_number}`}>
          <PackageCheck className="w-3 h-3" /> Teslim al
        </button>
      )}
      {!done && (
        <button type="button" disabled={busy} onClick={() => toInvoice(o.id)} className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid={`po-invoice-${o.order_number}`}>
          <FileText className="w-3 h-3" /> Alış faturası
        </button>
      )}
      {o.invoice_number && (
        <Link to="/invoices?type=purchase" className="px-2 py-1 border rounded-lg font-semibold text-emerald-700" data-testid={`po-inv-link-${o.order_number}`}>
          {o.invoice_number}
        </Link>
      )}
      {!done && o.order_status !== "cancelled" && (
        <button type="button" disabled={busy} onClick={() => setStatus(o.id, "cancelled")} className="p-1.5 text-slate-300 hover:text-rose-600" title="İptal" data-testid={`po-cancel-${o.order_number}`}>
          <X className="w-4 h-4" />
        </button>
      )}
      {!o.invoice_id && (
        <button type="button" disabled={busy} onClick={() => del(o.id, o.order_number)} className="p-1.5 text-slate-300 hover:text-rose-600" data-testid={`po-del-${o.order_number}`}>
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

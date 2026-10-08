import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Link2, PackagePlus, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { SearchSelect } from "./SearchSelect";
import { ProductDetailModal } from "./ProductDetailModal";
import { resolveImageUrl } from "../utils/imageUrl";
import { backdropDismissProps } from "../utils/modalBackdrop";

/**
 * Sipariş satırı tıklanınca:
 * - eşleşmişse stok kartı (ProductDetailModal)
 * - eşleşmemişse stok seç / kart aç
 */
export function OrderLineStockModal({
  order,
  item,
  itemIndex,
  product,
  products = [],
  companyId,
  onClose,
  onMatched,
  onProductUpdated,
}) {
  const [matchId, setMatchId] = useState("");
  const [busy, setBusy] = useState("");
  const [detailProduct, setDetailProduct] = useState(product || null);

  const lineName = item?.product_name || item?.name || "Ürün";
  const orderId = order?.id || order?._id;

  const matchLine = async (pid) => {
    const productId = pid || matchId;
    if (!productId || !orderId) {
      toast.error("Stok kartı seçin.");
      return;
    }
    setBusy("match");
    try {
      const r = await axios.post(`${API_URL}/orders/${orderId}/items/match`, {
        idx: itemIndex,
        product_id: productId,
      });
      const data = r?.data || {};
      toast.success(data.message || "Eşleştirildi.");
      const full = data.product || products.find((p) => (p.id || p._id) === productId) || null;
      onMatched?.(data.order);
      if (full) setDetailProduct(full);
      else onClose?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Eşleştirilemedi.");
    } finally {
      setBusy("");
    }
  };

  const createCard = async () => {
    if (!companyId) {
      toast.error("Şirket bulunamadı.");
      return;
    }
    setBusy("create");
    try {
      const created = await axios.post(`${API_URL}/marketplace/product-create`, {
        company_id: companyId,
        product_name: lineName,
        barcode: item?.barcode || "",
        sku: item?.sku || "",
        sale_price: Number(item?.unit_price) || 0,
        purchase_price: 0,
        stock_quantity: 0,
        vat_rate: Number(item?.vat_rate) || 20,
        category: "Pazaryeri",
        channel: order?.channel || "order",
      });
      const pid = created.data?.product?.id || created.data?.product?._id;
      if (!pid) throw new Error("Kart oluşturulamadı");
      toast.success(created.data.message || "Stok kartı açıldı.");
      await matchLine(pid);
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || "Stok kartı açılamadı.");
      setBusy("");
    }
  };

  if (detailProduct) {
    return (
      <ProductDetailModal
        product={detailProduct}
        initialTab="general"
        onClose={onClose}
        onUpdated={(p) => {
          setDetailProduct(p);
          onProductUpdated?.(p);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <div
        className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
        data-testid="order-line-match-modal"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Stok kartı eşleştir</div>
            <h3 className="text-sm font-bold text-slate-900 truncate" title={lineName}>{lineName}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {order?.order_number ? `${order.order_number} · ` : ""}
              {Number(item?.quantity) || 1} adet
              {item?.sku ? ` · SKU ${item.sku}` : ""}
              {item?.barcode ? ` · ${item.barcode}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 shrink-0" data-testid="order-line-match-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
          {item?.image_url ? (
            <img src={resolveImageUrl(item.image_url)} alt="" className="w-14 h-14 rounded-lg object-cover border bg-white" />
          ) : (
            <div className="w-14 h-14 rounded-lg border bg-white flex items-center justify-center text-slate-300">
              <PackagePlus className="w-5 h-5" />
            </div>
          )}
          <p className="text-xs text-slate-600 leading-relaxed">
            Bu satır henüz stok kartına bağlı değil. Mevcut bir kart seçin veya yeni kart açıp bağlayın.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-700">Stok kartı seç</label>
          <SearchSelect
            value={matchId}
            onChange={(id) => setMatchId(id || "")}
            options={products}
            placeholder="Ürün ara (ad / SKU / barkod)…"
            searchPlaceholder="Ad, SKU veya barkod ara…"
            getLabel={(p) => p.name}
            getSub={(p) => [p.sku, p.barcode].filter(Boolean).join(" · ")}
            getImage={(p) => p.image_url}
            testId="order-line-match-select"
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-1 border-t border-slate-100">
          <button
            type="button"
            disabled={!!busy}
            onClick={createCard}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            data-testid="order-line-create-card-btn"
          >
            <PackagePlus className="w-3.5 h-3.5" />
            {busy === "create" ? "Açılıyor…" : "Stok kartı aç"}
          </button>
          <button
            type="button"
            disabled={!!busy || !matchId}
            onClick={() => { void matchLine(); }}
            className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            data-testid="order-line-match-btn"
          >
            <Link2 className="w-3.5 h-3.5" />
            {busy === "match" ? "Eşleniyor…" : "Eşleştir"}
          </button>
        </div>
      </div>
    </div>
  );
}

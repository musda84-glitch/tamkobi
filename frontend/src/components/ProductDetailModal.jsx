import React, { useState } from "react";
import { X, Package, Images, Layers, Pencil, Printer, Factory } from "lucide-react";
import { ProductionOrderModal } from "./ProductionOrderModal";
import { ProductEditForm } from "./ProductEditForm";
import { ProductImageGallery } from "./ProductImageGallery";
import { VariantManager } from "./VariantManager";
import { BarcodeLabelPrint } from "./BarcodeLabelPrint";
import { resolveImageUrl } from "../utils/imageUrl";
import { useAuth } from "../context/AuthContext";

const TABS = [
  { key: "general", label: "Genel & Barkod", icon: Pencil },
  { key: "images", label: "Görseller", icon: Images },
  { key: "variants", label: "Varyantlar", icon: Layers }
];

export const ProductDetailModal = ({ product, initialTab = "images", onClose, onUpdated }) => {
  const [tab, setTab] = useState(initialTab);
  const [showLabel, setShowLabel] = useState(false);
  const [showProduce, setShowProduce] = useState(false);
  const { activeCompany } = useAuth();
  if (!product) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      {showLabel && <BarcodeLabelPrint product={product} company={activeCompany} onClose={() => setShowLabel(false)} />}
      {showProduce && <ProductionOrderModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} product={product} onClose={() => setShowProduce(false)} />}
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200" data-testid="product-detail-modal">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center text-slate-400">
              {product.image_url ? <img src={resolveImageUrl(product.image_url)} alt={product.name} className="w-full h-full object-cover" /> : <Package className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">{product.name}</h3>
              <p className="text-[11px] font-mono text-indigo-600 font-semibold">SKU: {product.sku} • Stok: {product.stock_quantity} {product.unit}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="close-product-detail-btn"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex items-center gap-1 px-6 pt-3 border-b">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition ${tab === key ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
              data-testid={`product-tab-${key}`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
              {key === "variants" && product.variants?.length > 0 && <span className="bg-slate-100 text-slate-700 rounded-full px-1.5 text-[10px]">{product.variants.length}</span>}
            </button>
          ))}
          {product.type !== "service" && product.type !== "raw_material" && <button onClick={() => setShowProduce(true)} className={`ml-auto mb-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${(product.stock_quantity || 0) <= 0 ? "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100" : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"}`} data-testid="produce-product-btn"><Factory className="w-3.5 h-3.5" /> {(product.stock_quantity || 0) <= 0 ? "Stokta Yok — Üretim Emri" : "Üretim Emri Ver"}</button>}
          <button onClick={() => setShowLabel(true)} className={`${product.type !== "service" && product.type !== "raw_material" ? "" : "ml-auto "}mb-1.5 flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition`} data-testid="print-barcode-label-btn">
            <Printer className="w-3.5 h-3.5" /> Barkod Yazdır
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {tab === "general" && <ProductEditForm key={product.id} product={product} onUpdated={onUpdated} onSaved={onClose} />}
          {tab === "images" && <ProductImageGallery product={product} onUpdated={onUpdated} />}
          {tab === "variants" && <VariantManager key={product.id} product={product} onUpdated={onUpdated} />}
        </div>
      </div>
    </div>
  );
};

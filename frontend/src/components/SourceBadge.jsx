
import React from "react";
import { Globe, ShoppingBag, User, Landmark, Sparkles, Store, Truck } from "lucide-react";

const MAP = {
  manual: { label: "Kullanıcı", Icon: User, cls: "bg-slate-100 text-slate-600" },
  b2b: { label: "B2B Portal", Icon: Globe, cls: "bg-sky-100 text-sky-700" },
  trendyol: { label: "Trendyol", Icon: ShoppingBag, cls: "bg-orange-100 text-orange-700" },
  hepsiburada: { label: "Hepsiburada", Icon: ShoppingBag, cls: "bg-orange-100 text-orange-700" },
  amazon: { label: "Amazon", Icon: ShoppingBag, cls: "bg-amber-100 text-amber-800" },
  n11: { label: "N11", Icon: ShoppingBag, cls: "bg-purple-100 text-purple-700" },
  shopify: { label: "Shopify", Icon: Store, cls: "bg-lime-100 text-lime-700" },
  shopphp: { label: "ShopPHP", Icon: Store, cls: "bg-lime-100 text-lime-700" },
  woocommerce: { label: "WooCommerce", Icon: Store, cls: "bg-violet-100 text-violet-700" },
  gib: { label: "GİB Gelen", Icon: Landmark, cls: "bg-rose-100 text-rose-700" },
  e_invoice_inbound: { label: "GİB Gelen", Icon: Landmark, cls: "bg-rose-100 text-rose-700" },
  ai_pdf: { label: "AI PDF", Icon: Sparkles, cls: "bg-violet-100 text-violet-700" },
  order: { label: "Sipariş", Icon: Truck, cls: "bg-emerald-100 text-emerald-700" },
};

export const SourceBadge = ({ channel, testId }) => {
  const m = MAP[channel] || MAP.manual;
  const Icon = m.Icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${m.cls}`} title={`Kaynak: ${m.label}`} data-testid={testId}>
      <Icon className="w-3 h-3" /> {m.label}
    </span>
  );
};

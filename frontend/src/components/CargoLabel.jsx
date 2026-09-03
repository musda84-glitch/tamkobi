import React from "react";
import { X, Printer } from "lucide-react";
import { BarcodeRenderer } from "./BarcodeRenderer";

export const CargoLabel = ({ order, company, onClose }) => (
  <div className="fixed inset-0 z-[70] bg-slate-900/70 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" data-testid="cargo-label-modal">
      <div className="flex items-center justify-between px-4 py-3 border-b no-print">
        <span className="text-xs font-bold text-slate-700">Kargo Etiketi — {order.order_number}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="cargo-label-print-btn"><Printer className="w-3.5 h-3.5" /> Yazdır</button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="cargo-label-close-btn"><X className="w-5 h-5" /></button>
        </div>
      </div>
      <div id="print-area" className="p-5 text-xs text-slate-900" style={{ width: "100%" }}>
        <div className="border-2 border-slate-900 rounded-lg p-4 space-y-3">
          <div className="flex justify-between items-start border-b-2 border-slate-900 pb-2">
            <div><div className="text-base font-black uppercase">{order.cargo_carrier || "KARGO"}</div><div className="text-[10px] text-slate-500">Gönderi Türü: Standart • Ödeme: Gönderici</div></div>
            <div className="text-right"><div className="text-[10px] text-slate-500">Sipariş</div><div className="font-mono font-bold">{order.order_number}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-slate-300 rounded p-2"><div className="text-[9px] uppercase text-slate-400 font-bold">Gönderici</div><div className="font-bold">{company?.name}</div><div className="text-[10px]">{company?.address} {company?.city}</div><div className="text-[10px]">{company?.phone}</div></div>
            <div className="border-2 border-slate-900 rounded p-2 bg-slate-50"><div className="text-[9px] uppercase text-slate-400 font-bold">Alıcı</div><div className="font-black text-sm">{order.customer_name}</div><div>{order.shipping_address}</div><div className="font-bold">{order.city}</div><div className="font-mono">{order.customer_phone}</div></div>
          </div>
          <div className="text-[10px] text-slate-600">İçerik: {(order.items || []).map((i) => `${i.quantity}x ${i.product_name}`).join(", ")} • {order.items?.length || 0} kalem</div>
          <div className="flex flex-col items-center border-t-2 border-slate-900 pt-3">
            <div className="text-[9px] uppercase text-slate-400 font-bold mb-1">Takip Numarası</div>
            <BarcodeRenderer code={order.cargo_tracking_number || order.order_number.replace(/\D/g, "").padEnd(12, "0").slice(0, 12)} width={260} height={60} />
            <div className="font-mono font-black text-base mt-1 tracking-widest">{order.cargo_tracking_number || "Kargo oluşturulmadı"}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

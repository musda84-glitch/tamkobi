import type { Company, Order } from "../types";
import { fmtDate, fmtMoney } from "./money";

export type PrintCompany = Pick<Company, "name"> & { address?: string; city?: string; phone?: string };

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function itemsOf(order: Order): { name: string; qty: number; price: unknown; total: unknown; sku?: string }[] {
  return (order.items || []).map((it) => ({
    name: String(it.product_name || it.name || "Kalem"),
    qty: Number(it.quantity) || 0,
    price: it.unit_price,
    total: it.total_incl ?? it.total,
    sku: it.sku ? String(it.sku) : undefined,
  }));
}

export function orderFormHtml(order: Order, company?: PrintCompany | null): string {
  const rows = itemsOf(order)
    .map((it) => `<tr><td>${esc(it.name)}${it.sku ? ` <span style="color:#64748b">[${esc(it.sku)}]</span>` : ""}</td><td style="text-align:right">${esc(it.qty)}</td><td style="text-align:right">${esc(fmtMoney(it.price))}</td><td style="text-align:right">${esc(fmtMoney(it.total))}</td></tr>`)
    .join("");
  return `
    <h1 style="margin:0 0 4px">SİPARİŞ FORMU</h1>
    <div style="color:#64748b">${esc(company?.name || "")}</div>
    <div style="margin:12px 0"><b>${esc(order.order_number || "Sipariş")}</b> · ${esc(fmtDate(order.order_date))}</div>
    <div><b>Müşteri:</b> ${esc(order.customer_name || "—")}</div>
    <div>${esc(order.shipping_address || "")} ${esc(order.city || "")}</div>
    <div>${esc(order.customer_phone || "")}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:16px" cellpadding="6">
      <thead><tr style="border-bottom:2px solid #0f172a;text-align:left"><th>Kalem</th><th style="text-align:right">Adet</th><th style="text-align:right">Birim</th><th style="text-align:right">Tutar</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='4'>Kalem yok</td></tr>"}</tbody>
    </table>
    <div style="margin-top:16px;font-size:18px;font-weight:800;text-align:right">Toplam ${esc(fmtMoney(order.grand_total || order.total_amount))}</div>
    ${order.notes ? `<div style="margin-top:12px"><b>Not:</b> ${esc(order.notes)}</div>` : ""}
  `;
}

export function cargoLabelHtml(order: Order, company?: PrintCompany | null): string {
  const track = order.cargo_tracking_number || order.order_number || "—";
  const pieces = itemsOf(order).reduce((s, it) => s + it.qty, 0);
  const lines = itemsOf(order).map((it) => `${it.qty}× ${esc(it.name)}`).join(", ");
  return `
    <div style="border:2px solid #0f172a;padding:16px;max-width:420px">
      <div style="display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:8px">
        <div><div style="font-size:18px;font-weight:900">${esc(order.cargo_carrier_name || order.cargo_carrier || "KARGO")}</div><div style="color:#64748b">${esc(order.channel || "")} · ${esc(order.order_number || "")}</div></div>
        <div style="font-weight:800;border:2px solid #0f172a;padding:4px 8px">${esc(pieces)} adet</div>
      </div>
      <div style="margin-top:12px;border:2px solid #0f172a;padding:8px;background:#f8fafc">
        <div style="font-size:10px;font-weight:800;color:#64748b">ALICI</div>
        <div style="font-size:16px;font-weight:900">${esc(order.customer_name || "—")}</div>
        <div>${esc(order.shipping_address || "")}</div>
        <div style="font-weight:800">${esc([order.district, order.city].filter(Boolean).join(" / "))}</div>
        <div>${esc(order.customer_phone || "")}</div>
      </div>
      <div style="margin-top:8px;border:1px dashed #0f172a;padding:8px;font-size:12px">
        <div style="font-size:10px;font-weight:800;color:#64748b">GÖNDERİCİ</div>
        <b>${esc(company?.name || "")}</b> ${esc(company?.address || "")} ${esc(company?.city || "")} ${esc(company?.phone || "")}
      </div>
      <div style="margin-top:8px;font-size:12px">${lines}</div>
      <div style="margin-top:16px;text-align:center;border-top:2px solid #0f172a;padding-top:8px">
        <div style="font-size:10px;font-weight:800;color:#64748b">TAKİP</div>
        <div style="font-family:monospace;font-size:20px;font-weight:900;letter-spacing:2px">${esc(track)}</div>
      </div>
    </div>
  `;
}

export function orderFormText(order: Order, company?: PrintCompany | null): string {
  const lines = itemsOf(order).map((it) => `  ${it.qty} × ${it.name}  ${fmtMoney(it.total)}`);
  return [
    "SİPARİŞ FORMU",
    company?.name || "",
    `${order.order_number || "Sipariş"} · ${fmtDate(order.order_date)}`,
    `Müşteri: ${order.customer_name || "—"}`,
    [order.shipping_address, order.city, order.customer_phone].filter(Boolean).join(" · "),
    "",
    ...lines,
    "",
    `Toplam ${fmtMoney(order.grand_total || order.total_amount)}`,
    order.notes ? `Not: ${order.notes}` : "",
  ].filter((x) => x !== "").join("\n");
}

export function cargoLabelText(order: Order, company?: PrintCompany | null): string {
  return [
    `KARGO ETİKETİ · ${order.order_number || ""}`,
    `Alıcı: ${order.customer_name || "—"}`,
    [order.shipping_address, order.city, order.customer_phone].filter(Boolean).join(" · "),
    `Gönderici: ${company?.name || ""}`,
    `Takip: ${order.cargo_tracking_number || "Kargo oluşturulmadı"}`,
  ].filter(Boolean).join("\n");
}

export function openPrintHtml(title: string, bodyHtml: string): boolean {
  if (typeof window === "undefined" || typeof window.open !== "function") return false;
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:16px;margin:0}@media print{body{padding:8px}}</style>
    </head><body>${bodyHtml}<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`);
  w.document.close();
  return true;
}

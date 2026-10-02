import { fmtMoney } from "./money";
/** Compact invoice slip used by the orders bulk menu (local HTML fallback). */

export const miniInvoiceSize = (key) => (key === "8x20" ? { w: 80, h: 200, label: "8×20 cm" } : { w: 100, h: 150, label: "10×15 cm" });

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const buildMiniInvoiceHtml = (orders, company = {}, sizeKey = "10x15") => {
  const { w, h } = miniInvoiceSize(sizeKey);
  const pages = (orders || []).map((o) => {
    const ccy = o.currency || company.currency || "TRY";
    const money = (n) => fmtMoney(n, ccy);
    const rows = (o.items || []).map((it) => `<tr><td>${esc(it.product_name || it.name)}</td><td class="r">${esc(it.quantity)} ${esc(it.unit || "ad")}</td><td class="r">${money(it.total_incl ?? it.total)}</td></tr>`).join("");
    const total = o.grand_total ?? o.total_amount ?? 0;
    return `<section class="slip">
      <div class="co">${esc(company.name || "")}</div>
      <div class="title">${esc(o.invoice_number || o.order_number)}</div>
      <div class="who">${esc(o.customer_name || "")}</div>
      <table>${rows}</table>
      <div class="tot">Toplam <b>${money(total)}</b></div>
    </section>`;
  }).join("");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Mini fatura</title>
  <style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111}
  .slip{width:${w}mm;height:${h}mm;box-sizing:border-box;padding:4mm;page-break-after:always}
  .co{font-weight:800;font-size:11pt}.title{font-size:9pt;margin:1mm 0}.who{font-weight:700;font-size:10pt;margin-bottom:2mm}
  table{width:100%;border-collapse:collapse;font-size:8pt}td{border-bottom:1px solid #ddd;padding:1mm 0;vertical-align:top}
  .r{text-align:right;white-space:nowrap}.tot{margin-top:2mm;text-align:right;font-size:11pt}</style></head><body>${pages}</body></html>`;
};

/** Yerel HTML fiş (kağıt / entegratörsüz). */
export const printMiniInvoices = (orders, company, sizeKey) => {
  const list = (orders || []).filter((o) => o.invoice_id || o.invoice_number);
  if (!list.length || typeof window === "undefined") return false;
  const w0 = window.open("", "_blank", "width=720,height=900");
  if (!w0) return false;
  w0.document.write(buildMiniInvoiceHtml(list, company, sizeKey));
  w0.document.close();
  w0.onload = () => setTimeout(() => w0.print(), 250);
  return true;
};

const blobErrorDetail = async (err, fallback = "Entegratör PDF alınamadı.") => {
  const blob = err?.response?.data;
  if (blob instanceof Blob) {
    try {
      const j = JSON.parse(await blob.text());
      if (j?.detail) return typeof j.detail === "string" ? j.detail : fallback;
    } catch { /* ignore */ }
  }
  const d = err?.response?.data?.detail || err?.message;
  return typeof d === "string" && d.trim() ? d.trim() : fallback;
};

/**
 * Mini E-Fatura / E-Arşiv yazdır — resmi entegratör PDF (İşNet GetInvoicePdf).
 * sizeKey (10x15 / 8x20) yazıcı kağıdı için bilgi; belge GİB PDF'idir.
 *
 * @returns {Promise<{ ok: number, fail: number, blocked?: boolean, message?: string }>}
 */
export async function printMiniInvoicesFromIntegrator(orders, { apiUrl, axiosClient } = {}) {
  const ids = [...new Set((orders || []).map((o) => o.invoice_id).filter(Boolean))];
  if (!ids.length) return { ok: 0, fail: 0, message: "Yazdırılacak e-fatura yok." };
  if (typeof window === "undefined" || !apiUrl || !axiosClient) {
    return { ok: 0, fail: ids.length, message: "PDF yazdırma ortamı hazır değil." };
  }

  let ok = 0;
  let fail = 0;
  const failMsgs = [];
  const openUrls = [];

  for (const id of ids.slice(0, 12)) {
    try {
      const fetchPdf = (url, params) => axiosClient.get(url, {
        responseType: "blob",
        headers: { Accept: "application/pdf" },
        params,
      });
      let r;
      try {
        r = await fetchPdf(`${apiUrl}/e-invoice/${id}/pdf`, { download: 0 });
        const src0 = String(r.headers?.["x-document-source"] || "").toLowerCase();
        // Yerel şablona düştüyse zorunlu entegratör uçunu dene
        if (src0 === "local") {
          r = await fetchPdf(`${apiUrl}/invoices/${id}/pdf`, { require_integrator: 1 });
        }
      } catch (firstErr) {
        try {
          r = await fetchPdf(`${apiUrl}/invoices/${id}/pdf`, { require_integrator: 1 });
        } catch (secondErr) {
          throw secondErr?.response ? secondErr : firstErr;
        }
      }
      const ct = String(r.headers?.["content-type"] || "").toLowerCase();
      const source = String(r.headers?.["x-document-source"] || "").toLowerCase();
      if (ct.includes("json")) {
        const text = typeof r.data?.text === "function" ? await r.data.text() : await new Response(r.data).text();
        let detail = "Entegratör PDF alınamadı.";
        try { detail = JSON.parse(text)?.detail || detail; } catch { /* ignore */ }
        failMsgs.push(typeof detail === "string" ? detail : "Entegratör PDF alınamadı.");
        fail++;
        continue;
      }
      if (source === "local") {
        failMsgs.push("Entegratör e-belge PDF gelmedi — yerel şablon yazdırılmadı.");
        fail++;
        continue;
      }
      const url = URL.createObjectURL(r.data);
      openUrls.push(url);
      const w = window.open(url, "_blank", "noopener");
      if (!w) {
        failMsgs.push("Açılır pencere engellendi.");
        fail++;
        continue;
      }
      try {
        w.addEventListener("load", () => {
          setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 350);
        });
      } catch { /* ignore */ }
      ok++;
    } catch (err) {
      fail++;
      failMsgs.push(await blobErrorDetail(err));
    }
  }

  // Object URL'leri biraz sonra serbest bırak (yazdırma penceresi yüklenene kadar)
  if (openUrls.length) {
    setTimeout(() => openUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* ignore */ } }), 120_000);
  }

  return {
    ok,
    fail,
    blocked: failMsgs.some((m) => /açılır pencere/i.test(m)),
    message: failMsgs[0] || (ok ? `${ok} entegratör PDF yazdırmaya açıldı.` : "PDF yazdırılamadı."),
  };
}

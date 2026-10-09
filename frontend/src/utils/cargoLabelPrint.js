/**
 * Mini kargo etiketi — pazaryeri / kargo entegratöründen resmi etiket.
 * Yerel termal HTML (thermalLabels) yalnızca yedek.
 */

import { printThermalLabels } from "./thermalLabels";
import { isIntegrationOrder } from "./orderMoreMenu";

const blobErrorDetail = async (err, fallback = "Entegratör kargo etiketi alınamadı.") => {
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

const orderIdOf = (o) => String(o?.id || o?._id || "").trim();

/**
 * Siparişlerin resmi kargo etiketini (Trendyol common-label / Geliver vb.) yazdırır.
 * @returns {Promise<{ ok: number, fail: number, skipped: number, blocked?: boolean, message?: string, failedIds: string[] }>}
 */
export async function printCargoLabelsFromIntegrator(orders, { apiUrl, axiosClient } = {}) {
  const list = (orders || []).filter((o) => orderIdOf(o));
  const ids = [...new Set(list.map(orderIdOf))];
  if (!ids.length) {
    return { ok: 0, fail: 0, skipped: 0, failedIds: [], message: "Etiket için sipariş yok." };
  }
  if (typeof window === "undefined" || !apiUrl || !axiosClient) {
    return { ok: 0, fail: ids.length, skipped: 0, failedIds: ids, message: "Etiket yazdırma ortamı hazır değil." };
  }

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  const failedIds = [];
  const failMsgs = [];
  const openUrls = [];

  for (const id of ids.slice(0, 12)) {
    try {
      const meta = await axiosClient.get(`${apiUrl}/orders/${id}/cargo-label`);
      if (!meta?.data?.has_file) {
        skipped += 1;
        failedIds.push(id);
        failMsgs.push("Pazaryeri veya oluşturulan kargo etiketi yok.");
        continue;
      }
      const r = await axiosClient.get(`${apiUrl}/orders/${id}/cargo-label/file`, {
        responseType: "blob",
        headers: { Accept: "application/pdf,image/*,*/*" },
      });
      const ct = String(r.headers?.["content-type"] || r.data?.type || "").toLowerCase();
      if (ct.includes("json")) {
        const text = typeof r.data?.text === "function" ? await r.data.text() : await new Response(r.data).text();
        let detail = "Entegratör kargo etiketi alınamadı.";
        try { detail = JSON.parse(text)?.detail || detail; } catch { /* ignore */ }
        failMsgs.push(typeof detail === "string" ? detail : "Entegratör kargo etiketi alınamadı.");
        fail += 1;
        failedIds.push(id);
        continue;
      }
      const url = URL.createObjectURL(r.data);
      openUrls.push(url);
      const w = window.open(url, "_blank", "noopener");
      if (!w) {
        failMsgs.push("Açılır pencere engellendi.");
        fail += 1;
        failedIds.push(id);
        continue;
      }
      try {
        w.addEventListener("load", () => {
          setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 350);
        });
      } catch { /* ignore */ }
      ok += 1;
    } catch (err) {
      fail += 1;
      failedIds.push(id);
      failMsgs.push(await blobErrorDetail(err));
    }
  }

  if (openUrls.length) {
    setTimeout(() => openUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* ignore */ } }), 120_000);
  }

  return {
    ok,
    fail,
    skipped,
    failedIds,
    blocked: failMsgs.some((m) => /açılır pencere/i.test(m)),
    message: failMsgs[0] || (ok ? `${ok} entegratör kargo etiketi yazdırmaya açıldı.` : "Kargo etiketi yazdırılamadı."),
  };
}

/**
 * Entegrasyon siparişlerinde resmi etiketi dene; yoksa (veya panel siparişi) yerel termal.
 * size: thermalLabels boyutları ("100x150" | "100x100").
 */
export async function printCargoLabelsPreferIntegrator(orders, company, {
  apiUrl,
  axiosClient,
  size = "100x150",
} = {}) {
  const list = Array.isArray(orders) ? orders.filter(Boolean) : [];
  if (!list.length) {
    return { ok: 0, thermal: 0, fail: 0, message: "Etiket için sipariş seçilmedi." };
  }

  const integration = list.filter(isIntegrationOrder);
  const panel = list.filter((o) => !isIntegrationOrder(o));

  let ok = 0;
  let thermal = 0;
  let fail = 0;
  const msgs = [];
  let needThermal = [...panel];

  if (integration.length && apiUrl && axiosClient) {
    const r = await printCargoLabelsFromIntegrator(integration, { apiUrl, axiosClient });
    ok += r.ok || 0;
    fail += r.fail || 0;
    if (r.message && r.ok === 0 && (r.fail || r.skipped)) msgs.push(r.message);
    if (r.failedIds?.length) {
      const byId = Object.fromEntries(integration.map((o) => [orderIdOf(o), o]));
      for (const id of r.failedIds) {
        if (byId[id]) needThermal.push(byId[id]);
      }
    }
  } else if (integration.length) {
    needThermal.push(...integration);
  }

  // Aynı siparişi iki kez yazdırma
  const seen = new Set();
  needThermal = needThermal.filter((o) => {
    const id = orderIdOf(o) || o.order_number;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  if (needThermal.length) {
    if (printThermalLabels(needThermal, company, { size })) {
      thermal += needThermal.length;
    } else {
      fail += needThermal.length;
      msgs.push("Yerel etiket yazdırılamadı (açılır pencere engellenmiş olabilir).");
    }
  }

  const parts = [];
  if (ok) parts.push(`${ok} entegratör`);
  if (thermal) parts.push(`${thermal} yerel termal`);
  return {
    ok,
    thermal,
    fail,
    message: parts.length
      ? `${parts.join(" + ")} etiket yazdırmaya gönderildi.`
      : (msgs[0] || "Kargo etiketi yazdırılamadı."),
  };
}

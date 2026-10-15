/** Şirket detay sekmeleri — URL (?tab=) ile iç id eşlemesi. */

export const COMPANY_DETAIL_TABS = [
  { id: "license", label: "Lisans", url: "license" },
  { id: "einvoice", label: "Entegratör", url: "entegrator" },
  { id: "sms", label: "SMS", url: "sms" },
  { id: "notify", label: "Bildirimler", url: "notify" },
  { id: "storage", label: "Depolama", url: "storage" },
  { id: "ai", label: "Yapay zekâ", url: "ai" },
];

export const COMPANY_DETAIL_TAB_IDS = new Set(COMPANY_DETAIL_TABS.map((t) => t.id));

const URL_TO_ID = Object.fromEntries(
  COMPANY_DETAIL_TABS.flatMap((t) => [
    [t.url, t.id],
    [t.id, t.id],
  ])
);

/** URL ?tab= değeri → iç sekme id (license|einvoice|…). */
export function companyDetailTabFromUrl(raw) {
  const key = String(raw || "").trim().toLowerCase();
  return URL_TO_ID[key] || "license";
}

/** İç sekme id → URL’de saklanan değer. */
export function companyDetailTabToUrl(tabId) {
  const t = COMPANY_DETAIL_TABS.find((x) => x.id === tabId);
  return t?.url || "license";
}

export function companyDetailPath(companyId, tabId) {
  const id = encodeURIComponent(String(companyId || ""));
  const tab = companyDetailTabToUrl(tabId || "license");
  const base = `/sistem/sirketler/${id}`;
  return tab === "license" ? base : `${base}?tab=${tab}`;
}

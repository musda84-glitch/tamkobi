/** Logo / Mikro / BizimHesap tarzı sol menü grupları.
 * Grup yalnızca görünüm içindir; RBAC ve lisans anahtarları değişmez.
 */
export const NAV_GROUPS = [
  { id: "overview", label: null },
  { id: "ticari", label: "Satış / Alış" },
  { id: "finans", label: "Finans" },
  { id: "stok", label: "Stok / Lojistik" },
  { id: "uretim", label: "Üretim" },
  { id: "ik", label: "Personel" },
  { id: "sistem", label: "Sistem" },
];

const PATH_GROUP = {
  "/": "overview",
  "/invoices": "ticari",
  "/edoc-inbox": "ticari",
  "/dispatches": "ticari",
  "/dis-ticaret": "ticari",
  "/b2b-yonetim": "ticari",
  "/quotes": "ticari",
  "/projects": "ticari",
  "/surveys": "ticari",
  "/contacts": "finans",
  "/installments": "finans",
  "/banking": "finans",
  "/expenses": "finans",
  "/loans": "finans",
  "/cheques": "finans",
  "/reports": "finans",
  "/accountant": "finans",
  "/stock": "stok",
  "/sayim": "stok",
  "/orders": "stok",
  "/saha": "stok",
  "/sevk": "stok",
  "/warehouses": "stok",
  "/ecommerce": "stok",
  "/cargo": "stok",
  "/production": "uretim",
  "/atolye": "uretim",
  "/personnel": "ik",
  "/mesai": "ik",
  "/communication": "sistem",
  "/ai-advisor": "sistem",
  "/settings": "sistem",
  "/trash": "sistem",
  "/sistem": "sistem",
};

export function groupIdOf(path) {
  return PATH_GROUP[path] || "sistem";
}

export function groupMenuItems(items) {
  const buckets = Object.fromEntries(NAV_GROUPS.map((g) => [g.id, []]));
  for (const item of items || []) {
    const id = groupIdOf(item.path);
    (buckets[id] || buckets.sistem).push(item);
  }
  return NAV_GROUPS.map((g) => ({ ...g, items: buckets[g.id] || [] })).filter((g) => g.items.length);
}

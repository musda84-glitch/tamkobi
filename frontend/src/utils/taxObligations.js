export const TAX_SOURCE_KINDS = [
  { id: "bordro", label: "Bordro", hint: "Aylık bordro PDF — SGK, GV, damga ve net maaş" },
  { id: "mizan", label: "Mizan", hint: "Dönem mizanı — 360/361/335 alacak bakiyeleri" },
  { id: "tahakkuk", label: "Tahakkuk", hint: "GİB / SGK tahakkuk fişi — ödenecek vergi" },
];

export const TAX_KIND_LABELS = {
  sgk: "SGK primi",
  issizlik: "İşsizlik sigortası",
  gelir_vergisi: "Gelir vergisi (muhtasar)",
  damga: "Damga vergisi",
  kdv: "KDV",
  muhtasar: "Muhtasar",
  kurumlar: "Kurumlar vergisi",
  personel: "Personel net maaş",
  vergi: "Ödenecek vergi",
  diger: "Diğer yükümlülük",
};

export function taxKindLabel(kind) {
  return TAX_KIND_LABELS[kind] || TAX_KIND_LABELS.diger;
}

export function guessTaxSourceKind(file) {
  const name = String(file?.name || "").toLowerCase();
  if (/bordro|maas|maa[sş]|puantaj/.test(name)) return "bordro";
  if (/mizan|kebir|balance/.test(name)) return "mizan";
  if (/tahakkuk|tahakuk|muhtasar|kdv|sgk/.test(name)) return "tahakkuk";
  return "";
}

export function taxSourceById(id) {
  return TAX_SOURCE_KINDS.find((k) => k.id === id) || TAX_SOURCE_KINDS[0];
}

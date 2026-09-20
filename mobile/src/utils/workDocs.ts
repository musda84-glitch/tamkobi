import { coordValue } from "./geo";
import { idOf } from "./money";
import { productImage } from "./productDisplay";

export type WorkKind = "quote" | "project" | "survey";

export type WorkItem = {
  product_id?: string;
  name: string;
  quantity: number;
  unit_price: number;
  unit_price_incl?: number;
  vat_rate: number;
  unit: string;
  price_includes_vat?: boolean;
  image_url?: string;
  thumbnail_url?: string;
};

export type QuoteApproval = {
  status?: string;
  link?: string;
  token?: string;
  view_count?: number;
  sent_count?: number;
  responder_name?: string;
  results?: Record<string, { status?: string; detail?: string; wa_link?: string }>;
};

export type QuoteDoc = {
  id?: string;
  _id?: string;
  quote_number?: string;
  title?: string;
  contact_id?: string;
  contact_name?: string;
  status?: string;
  valid_until?: string;
  issue_date?: string;
  notes?: string;
  terms?: string;
  subtotal?: number;
  vat_total?: number;
  grand_total?: number;
  items?: WorkItem[];
  project_id?: string;
  invoice_id?: string;
  survey_id?: string;
  approval?: QuoteApproval;
};

export type ProjectDoc = {
  id?: string;
  _id?: string;
  project_number?: string;
  name?: string;
  contact_id?: string;
  contact_name?: string;
  status?: string;
  budget?: number;
  start_date?: string;
  end_date?: string;
  description?: string;
  address?: string;
  quoted_total?: number;
  invoiced_total?: number;
  expense_total?: number;
  quote_count?: number;
  quote_number?: string;
  can_invoice?: boolean;
  invoice_id?: string;
  location_url?: string;
  latitude?: number | null;
  longitude?: number | null;
  images?: string[];
};

export type SurveyDoc = {
  id?: string;
  _id?: string;
  survey_number?: string;
  contact_id?: string;
  contact_name?: string;
  address?: string;
  survey_date?: string;
  assigned_to?: string;
  status?: string;
  notes?: string;
  measurements?: WorkItem[];
  quote_id?: string;
  location_url?: string;
  latitude?: number | null;
  longitude?: number | null;
  images?: string[];
};

export const QUOTE_STATUSES = [
  { key: "draft", label: "Taslak" },
  { key: "sent", label: "Gönderildi" },
  { key: "accepted", label: "Kabul" },
  { key: "rejected", label: "Red" },
];

export const PROJECT_STATUSES = [
  { key: "planning", label: "Planlama" },
  { key: "active", label: "Devam Ediyor" },
  { key: "on_hold", label: "Beklemede" },
  { key: "completed", label: "Tamamlandı" },
];

export const SURVEY_STATUSES = [
  { key: "planned", label: "Planlandı" },
  { key: "done", label: "Yapıldı" },
  { key: "quoted", label: "Teklife Dönüştü" },
];

export function emptyItem(): WorkItem {
  return { name: "", quantity: 1, unit_price: 0, vat_rate: 20, unit: "Adet" };
}

export function namedItems(items: WorkItem[]): WorkItem[] {
  return items.filter((i) => (i.name || "").trim());
}

/** Drops a quote / survey line; keeps one empty row so the editor stays usable. */
export function removeWorkItem(items: WorkItem[], index: number): WorkItem[] {
  const next = items.filter((_, i) => i !== index);
  return next.length ? next : [emptyItem()];
}

/** Stok kartı KDV dahilse birim fiyat brüttür; net+KDV ayrıca eklenmez. */
export function workItemFromProduct(prod: {
  id?: string;
  _id?: string;
  name?: string;
  sale_price?: number;
  vat_rate?: number;
  unit?: string;
  price_includes_vat?: boolean;
  thumbnail_url?: string;
  image_url?: string;
  images?: string[];
}): WorkItem {
  const photo = productImage(prod);
  return {
    ...emptyItem(),
    product_id: idOf(prod),
    name: String(prod.name || ""),
    unit_price: Number(prod.sale_price) || 0,
    vat_rate: Number(prod.vat_rate) || 20,
    unit: prod.unit || "Adet",
    price_includes_vat: !!prod.price_includes_vat,
    image_url: photo || undefined,
    thumbnail_url: prod.thumbnail_url || undefined,
  };
}

export function workItemImage(
  item: Pick<WorkItem, "image_url" | "thumbnail_url">,
  product?: { thumbnail_url?: string; image_url?: string; images?: string[] } | null,
): string {
  return item.thumbnail_url || item.image_url || (product ? productImage(product) : "");
}

function nearly(a: number, b: number, eps = 0.05): boolean {
  return Math.abs(a - b) <= eps;
}

export function hydrateWorkItem(
  item: WorkItem,
  product?: { price_includes_vat?: boolean; sale_price?: number; thumbnail_url?: string; image_url?: string; images?: string[] } | null,
): WorkItem {
  if (!item.image_url && !item.thumbnail_url && product) {
    const photo = productImage(product);
    if (photo) item = { ...item, image_url: photo };
  }
  const fromProd = !!product?.price_includes_vat;
  const net = Number(item.unit_price || 0);
  const incl = Number(item.unit_price_incl || 0);
  const hasIncl = item.unit_price_incl != null && incl > 0;
  const sale = Number(product?.sale_price || 0);

  // KDV dahil rafta 260 dururken satıra 260 + unit_price_incl=286 yazılmışsa tekrar KDV ekleme.
  if (fromProd && sale && nearly(net, sale) && hasIncl) {
    return { ...item, price_includes_vat: true, unit_price_incl: undefined };
  }
  if (hasIncl && fromProd && sale && nearly(incl, sale)) {
    return { ...item, price_includes_vat: false };
  }
  if (hasIncl) return { ...item, price_includes_vat: false };
  if (item.price_includes_vat != null) return item;
  if (fromProd) return { ...item, price_includes_vat: true };
  return item;
}

export function workItemLineGross(it: WorkItem): number {
  const qty = Number(it.quantity || 0);
  const rate = Number(it.vat_rate || 0);
  const price = Number(it.unit_price || 0);
  const inclusive = !!it.price_includes_vat && !(Number(it.unit_price_incl) > 0);
  if (inclusive) return Math.round(qty * price * 100) / 100;
  return Math.round(qty * price * (1 + rate / 100) * 100) / 100;
}

export function workItemTotals(items: WorkItem[]) {
  const rows = namedItems(items);
  let subtotal = 0;
  let vat = 0;
  for (const it of rows) {
    const qty = Number(it.quantity || 0);
    const rate = Number(it.vat_rate || 0);
    const price = Number(it.unit_price || 0);
    const inclusive = !!it.price_includes_vat && !(Number(it.unit_price_incl) > 0);
    if (inclusive) {
      const incl = qty * price;
      const excl = rate ? incl / (1 + rate / 100) : incl;
      subtotal += excl;
      vat += incl - excl;
    } else {
      const excl = qty * price;
      subtotal += excl;
      vat += excl * (rate / 100);
    }
  }
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    grandTotal: Math.round((subtotal + vat) * 100) / 100,
  };
}

export function validateQuoteItems(items: WorkItem[]): string | null {
  if (!namedItems(items).length) return "En az bir kalem ekleyin.";
  return null;
}

export function validateProjectName(name: string): string | null {
  if (!name.trim()) return "Proje adı gerekli.";
  return null;
}

export function quotePayload(companyId: string, form: { contact_id: string; contact_name: string; title: string; valid_until: string; notes: string; project_id?: string }, items: WorkItem[]) {
  return {
    company_id: companyId,
    contact_id: form.contact_id || null,
    contact_name: form.contact_name,
    title: form.title.trim() || "Fiyat Teklifi",
    valid_until: form.valid_until || null,
    notes: form.notes,
    project_id: form.project_id || undefined,
    items: namedItems(items),
  };
}

export function quoteUpdateBody(form: { contact_id: string; contact_name: string; title: string; valid_until: string; notes: string; project_id?: string }, items: WorkItem[]) {
  const { company_id: _c, ...rest } = quotePayload("", form, items);
  void _c;
  return rest;
}

export function projectPayload(companyId: string, form: { name: string; contact_id: string; contact_name: string; budget: string; start_date: string; end_date: string; notes: string; address: string; location_url: string; latitude?: string; longitude?: string }) {
  return {
    company_id: companyId,
    name: form.name.trim(),
    contact_id: form.contact_id || null,
    contact_name: form.contact_name,
    budget: Number(String(form.budget).replace(",", ".")) || 0,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    description: form.notes,
    address: form.address,
    location_url: form.location_url || null,
    latitude: coordValue(form.latitude || ""),
    longitude: coordValue(form.longitude || ""),
  };
}

export function surveyPayload(companyId: string, form: { contact_id: string; contact_name: string; address: string; survey_date: string; notes: string; location_url: string; latitude?: string; longitude?: string }, items: WorkItem[]) {
  return {
    company_id: companyId,
    contact_id: form.contact_id || null,
    contact_name: form.contact_name,
    address: form.address,
    survey_date: form.survey_date,
    notes: form.notes,
    location_url: form.location_url || null,
    latitude: coordValue(form.latitude || ""),
    longitude: coordValue(form.longitude || ""),
    measurements: namedItems(items).map((i) => ({
      name: i.name,
      quantity: Number(i.quantity) || 1,
      unit: i.unit || "Adet",
      unit_price: Number(i.unit_price) || 0,
    })),
  };
}

/** Web proje kartı: no + teklif no, cari / adres, bütçe-teklif-fatura. */
export function projectCardBits(p: ProjectDoc) {
  return {
    codes: [p.project_number, p.quote_number].filter(Boolean).join(" · "),
    name: p.name || p.project_number || "Proje",
    contact: [p.contact_name || "—", p.address].filter(Boolean).join(" · "),
    quoteCount: Number(p.quote_count) || 0,
    budget: Number(p.budget) || 0,
    quoted: Number(p.quoted_total) || 0,
    invoiced: Number(p.invoiced_total) || 0,
    expense: Number(p.expense_total) || 0,
  };
}

export function newButtonLabel(kind: WorkKind): string {
  if (kind === "quote") return "Yeni Teklif";
  if (kind === "project") return "Yeni Proje";
  return "Yeni Keşif";
}

/** Kalem satırlarını birbirinden ayıran zebra tonları. */
export function itemStripe(index: number): { backgroundColor: string } {
  return { backgroundColor: index % 2 === 0 ? "#F1F5F9" : "#EEF2FF" };
}

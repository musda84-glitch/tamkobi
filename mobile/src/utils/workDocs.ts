export type WorkKind = "quote" | "project" | "survey";

export type WorkItem = {
  product_id?: string;
  name: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  unit: string;
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
  notes?: string;
  grand_total?: number;
  items?: WorkItem[];
  project_id?: string;
  invoice_id?: string;
  survey_id?: string;
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
  can_invoice?: boolean;
  invoice_id?: string;
  location_url?: string;
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

export function workItemTotals(items: WorkItem[]) {
  const rows = namedItems(items);
  const subtotal = rows.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);
  const vat = rows.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0) * (Number(it.vat_rate || 0) / 100), 0);
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

export function projectPayload(companyId: string, form: { name: string; contact_id: string; contact_name: string; budget: string; start_date: string; end_date: string; notes: string; address: string; location_url: string }) {
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
  };
}

export function surveyPayload(companyId: string, form: { contact_id: string; contact_name: string; address: string; survey_date: string; notes: string; location_url: string }, items: WorkItem[]) {
  return {
    company_id: companyId,
    contact_id: form.contact_id || null,
    contact_name: form.contact_name,
    address: form.address,
    survey_date: form.survey_date,
    notes: form.notes,
    location_url: form.location_url || null,
    measurements: namedItems(items).map((i) => ({
      name: i.name,
      quantity: Number(i.quantity) || 1,
      unit: i.unit || "Adet",
      unit_price: Number(i.unit_price) || 0,
    })),
  };
}

export function newButtonLabel(kind: WorkKind): string {
  if (kind === "quote") return "Yeni Teklif";
  if (kind === "project") return "Yeni Proje";
  return "Yeni Keşif";
}

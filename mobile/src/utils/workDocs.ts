import { normalizeApiBase } from "../api/url";
import { coordValue } from "./geo";
import { fmtDate, idOf } from "./money";
import { newTaskId, normalizeProjectTasks, type Employee, type ProjectTask } from "./personnel";
import { productImage } from "./productDisplay";
import { isCompletedProjectStatus, type ProjectStage } from "./projectStages";
import type { StagePhoto } from "./stagePhotos";
import { approvalPayload, approvalPublicOrigin } from "./quoteApproval";

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
  is_service?: boolean;
  description?: string;
};

export const QUOTE_ITEM_THUMB = { width: 48, height: 104 };
export const QUOTE_ITEM_THUMB_SIZE = QUOTE_ITEM_THUMB.height;

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
  images?: string[];
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
  quote_id?: string;
  can_invoice?: boolean;
  invoice_id?: string;
  location_url?: string;
  latitude?: number | null;
  longitude?: number | null;
  images?: string[];
  stage_photos?: StagePhoto[];
  tasks?: ProjectTask[];
  tracking?: ProjectTracking;
};

export type ProjectTracking = {
  token?: string;
  link?: string;
  sent_count?: number;
  view_count?: number;
  last_viewed_at?: string;
};

export type ProjectTrackingResult = {
  status?: string;
  link?: string;
  token?: string;
  message?: string;
  results?: Record<string, { status?: string; detail?: string; wa_link?: string }>;
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

function withCurrentOption(options: { value: string; label: string }[], current?: string | null) {
  const cur = String(current || "").trim();
  if (cur && !options.some((o) => o.value === cur)) {
    options.push({ value: cur, label: cur });
  }
  return options;
}

/** Kart / form açılır listesi — listeye yeni aşama eklenince dropdown da büyür. */
export function projectStatusSelectGroups(current?: string | null, stages?: ProjectStage[] | null) {
  const list = stages?.length ? stages : PROJECT_STATUSES;
  const options = withCurrentOption(list.map((s) => ({ value: s.key, label: s.label })), current);
  return [{ label: "Aşamalar", options }];
}

export function workStatusSelectGroups(
  kind: WorkKind,
  current?: string | null,
  projectStages?: ProjectStage[] | null,
) {
  if (kind === "project") return projectStatusSelectGroups(current, projectStages);
  const list = kind === "quote" ? QUOTE_STATUSES : SURVEY_STATUSES;
  return [{ label: "Durum", options: withCurrentOption(list.map((s) => ({ value: s.key, label: s.label })), current) }];
}

export const SURVEY_STATUSES = [
  { key: "planned", label: "Planlandı" },
  { key: "done", label: "Yapıldı" },
  { key: "quoted", label: "Teklife Dönüştü" },
];

export function emptyItem(): WorkItem {
  return { name: "", quantity: 1, unit_price: 0, vat_rate: 20, unit: "Adet", is_service: false, description: "" };
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
  type?: string;
  price_includes_vat?: boolean;
  thumbnail_url?: string;
  image_url?: string;
  images?: string[];
}): WorkItem {
  const photo = productImage(prod);
  const is_service = prod.type === "service";
  return {
    ...emptyItem(),
    product_id: is_service ? "" : idOf(prod),
    name: String(prod.name || ""),
    unit_price: Number(prod.sale_price) || 0,
    vat_rate: Number(prod.vat_rate) || 20,
    unit: prod.unit || "Adet",
    price_includes_vat: !!prod.price_includes_vat,
    image_url: photo || undefined,
    thumbnail_url: prod.thumbnail_url || undefined,
    is_service,
  };
}

export function toggleWorkItemService(item: WorkItem): WorkItem {
  const is_service = !item.is_service;
  if (is_service) {
    return { ...item, is_service: true, product_id: "", image_url: undefined, thumbnail_url: undefined };
  }
  return { ...item, is_service: false };
}

/** Ad alanındaki uzun metinden SKU / kelime parçaları (stok araması). */
export function workItemSearchTokens(name: string): string[] {
  const raw = String(name || "").trim();
  if (raw.length < 2) return [];
  const parts = raw
    .split(/[\s*,;|/]+/)
    .map((t) => t.replace(/[():]+/g, "").trim())
    .filter((t) => t.length >= 2);
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(key);
  }
  if (!seen.has(raw.toLowerCase()) && raw.length >= 2 && raw.length <= 40) tokens.unshift(raw.toLowerCase());
  return tokens;
}

function productSearchHay<T extends { name?: string; sku?: string; barcode?: string; category?: string }>(p: T): string[] {
  return [p.name, p.sku, p.barcode, p.category].map((v) => String(v || "").toLowerCase()).filter(Boolean);
}

export function workItemNameHits<T extends { id?: string; _id?: string; name?: string; sku?: string; barcode?: string; category?: string }>(
  products: T[] | null | undefined,
  item: Pick<WorkItem, "name" | "is_service" | "product_id">,
  limit = 6,
): T[] {
  if (item.is_service) return [];
  const q = String(item.name || "").trim();
  if (q.length < 2) return [];
  const pid = item.product_id || "";
  const tokens = workItemSearchTokens(q);
  const full = q.toLowerCase();
  return (products || [])
    .filter((p) => {
      if (pid && idOf(p) === pid) return false;
      const hay = productSearchHay(p);
      if (hay.some((h) => h.includes(full) || (full.length <= 48 && full.includes(h)))) return true;
      return tokens.some((t) => hay.some((h) => h.includes(t) || (t.length >= 4 && t.includes(h))));
    })
    .slice(0, limit);
}

export function workItemNoteOpen(item: Pick<WorkItem, "description">, forced?: boolean): boolean {
  if (forced != null) return forced;
  return Boolean(String(item.description || "").trim());
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

/** Kaydet teklifi cariye taslak fatura olarak da işler; ikinci kez çağrılmaz. */
export function shouldAttachQuoteDraftInvoice(
  quote?: { invoice_id?: string } | null,
  contactId?: string,
): boolean {
  return !quote?.invoice_id && Boolean(String(contactId || "").trim());
}

export function quoteSaveMessage(opts: {
  createdInvoiceNumber?: string;
  hasContact: boolean;
  alreadyInvoiced: boolean;
}): string {
  if (opts.createdInvoiceNumber) {
    return `Teklif kaydedildi. Taslak fatura ${opts.createdInvoiceNumber} cariye işlendi.`;
  }
  if (opts.alreadyInvoiced) return "Teklif güncellendi.";
  if (!opts.hasContact) return "Teklif kaydedildi. Taslak fatura için cari seçin.";
  return "Teklif kaydedildi.";
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

/** Quotes created for a project, or the source quote that became the project. */
export function quotesForProject(
  quotes: QuoteDoc[] | null | undefined,
  project: Pick<ProjectDoc, "id" | "_id" | "quote_id"> | null | undefined
): QuoteDoc[] {
  const pid = idOf(project);
  const sourceId = String(project?.quote_id || "").trim();
  return (quotes || []).filter((q) => {
    if (pid && q.project_id === pid) return true;
    return Boolean(sourceId && idOf(q) === sourceId);
  });
}

export type ProjectMetricSection = "quotes" | "invoices" | "expenses";

export function projectMetricSectionOrder(focus?: string | null): ProjectMetricSection[] {
  const all: ProjectMetricSection[] = ["quotes", "invoices", "expenses"];
  const key = String(focus || "").trim() as ProjectMetricSection;
  if (!all.includes(key)) return all;
  return [key, ...all.filter((s) => s !== key)];
}

/** Web proje kartı: no + teklif no, cari / adres, bütçe-teklif-fatura-masraf. */
export function projectCardBits(p: ProjectDoc) {
  return {
    codes: [p.project_number, p.quote_number].filter(Boolean).join(" · "),
    name: p.name || p.project_number || "Proje",
    contactName: p.contact_name || "—",
    address: String(p.address || "").trim(),
    contact: [p.contact_name || "—", p.address].filter(Boolean).join(" · "),
    quoteCount: Number(p.quote_count) || 0,
    budget: Number(p.budget) || 0,
    quoted: Number(p.quoted_total) || 0,
    invoiced: Number(p.invoiced_total) || 0,
    expense: Number(p.expense_total) || 0,
  };
}

export function addressToggleLabel(expanded: boolean): string {
  return expanded ? "Gizle" : "Göster";
}

/** Uzun saha adresi kartta gizle/göster ile açılır. */
export function shouldCollapseAddress(address?: string | null, min = 36): boolean {
  return String(address || "").trim().length > min;
}

/** Cari detay / liste: company-wide light satırlardan bu carinin projeleri. */
export function projectsForContact(rows: ProjectDoc[] | null | undefined, contactId?: string | null): ProjectDoc[] {
  const id = String(contactId || "").trim();
  if (!id) return [];
  return (rows || []).filter((p) => String(p.contact_id || "") === id);
}

/** Overview satırlarını light metriklerle birleştir; yüklenene kadar overlay kalsın. */
export function mergeContactProjects(overlay: ProjectDoc[] | null | undefined, light: ProjectDoc[] | null | undefined): ProjectDoc[] {
  const base = overlay || [];
  const extra = light || [];
  if (!extra.length) return base;
  if (!base.length) return extra;
  const byId = new Map(extra.map((p) => [idOf(p), p]));
  const seen = new Set<string>();
  const merged = base.map((p) => {
    const id = idOf(p);
    seen.add(id);
    const richer = byId.get(id);
    return richer ? { ...p, ...richer } : p;
  });
  for (const p of extra) {
    const id = idOf(p);
    if (!seen.has(id)) merged.push(p);
  }
  return merged;
}

export function projectTaskSummary(tasks?: ProjectTask[] | null) {
  const rows = normalizeProjectTasks(tasks);
  if (!rows.length) return null;
  const assigned = rows.filter((t) => t.assignee_id || t.assignee_name).length;
  const done = rows.filter((t) => t.done).length;
  return {
    done,
    total: rows.length,
    assigned,
    label: `${done}/${rows.length} görev${assigned ? ` · ${assigned} atanmış` : ""}`,
  };
}

export function emptyProjectTask(id?: string): ProjectTask {
  return { id: id || newTaskId(), title: "", done: false, assignee_id: null, assignee_name: null };
}

export function projectTaskRows(tasks?: ProjectTask[] | null): ProjectTask[] {
  const rows = normalizeProjectTasks(tasks);
  return rows.length ? rows : [emptyProjectTask()];
}

export function cleanProjectTasks(tasks: ProjectTask[]): ProjectTask[] {
  return tasks
    .map((t) => ({
      id: t.id,
      title: (t.title || "").trim(),
      done: !!t.done,
      assignee_id: t.assignee_id || null,
      assignee_name: t.assignee_name || null,
    }))
    .filter((t) => t.title);
}

export function applyTaskAssignee(
  task: ProjectTask,
  employees: Pick<Employee, "id" | "_id" | "full_name">[],
  employeeId: string,
): ProjectTask {
  const emp = employees.find((e) => idOf(e) === employeeId);
  return {
    ...task,
    assignee_id: employeeId || null,
    assignee_name: emp?.full_name || null,
  };
}

export function assigneeSelectGroups(employees: Pick<Employee, "id" | "_id" | "full_name" | "position">[]) {
  return [{
    label: "Personel",
    options: (employees || []).map((e) => ({
      value: idOf(e),
      label: [e.full_name || "Personel", e.position].filter(Boolean).join(" · "),
    })),
  }];
}

export function trackingAbsoluteLink(
  tracking?: Pick<ProjectTracking, "token" | "link"> | null,
  minted?: Pick<ProjectTrackingResult, "token" | "link"> | null,
  apiBase?: string,
): string {
  const raw = String(minted?.link || tracking?.link || "").trim();
  const token = String(minted?.token || tracking?.token || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin = approvalPublicOrigin(normalizeApiBase(apiBase), raw);
  if (raw.startsWith("/")) return `${origin}${raw}`;
  if (token) return `${origin}/proje/${token}`;
  return "";
}

export function trackingBadgeLabel(tracking?: Pick<ProjectTracking, "token" | "sent_count" | "view_count"> | null): string | null {
  if (!tracking?.token) return null;
  const views = tracking.view_count || 0;
  const sent = tracking.sent_count || 0;
  if (sent) return views ? `Takip · ${views} görüntüleme` : "Takip linki gönderildi";
  return "Takip linki hazır";
}

export function projectTrackingPayload(channels: string[], phone: string, email: string, baseUrl: string) {
  return approvalPayload(channels, phone, email, baseUrl);
}

export function trackingShareMessage(
  project: Pick<ProjectDoc, "name" | "project_number" | "contact_name">,
  link: string,
): string {
  const who = project.contact_name || "müşterimiz";
  const label = [project.project_number, project.name].filter(Boolean).join(" — ");
  return `Sayın ${who}, ${label} projenizin güncel durumunu bu linkten takip edebilirsiniz: ${link}`;
}

/** Liste: cari üstte; geçerlilik varsa eklenir, boşsa tire yok. */
export function quoteListTitle(quote: Pick<QuoteDoc, "contact_name" | "valid_until">): string {
  const date = quote.valid_until ? fmtDate(quote.valid_until) : "";
  return [quote.contact_name || "—", date].filter(Boolean).join(" · ");
}

export type QuoteStatusTone = "slate" | "green" | "red" | "amber";

/** Gönderildi amber, kabul yeşil, red kırmızı, taslak gri. */
export function quoteStatusTone(status?: string | null): QuoteStatusTone {
  const key = String(status || "").trim().toLowerCase();
  if (key === "sent") return "amber";
  if (key === "accepted") return "green";
  if (key === "rejected") return "red";
  return "slate";
}

export type WorkStatusTone = QuoteStatusTone | "indigo";

const STATUS_DOT: Record<WorkStatusTone, string> = {
  slate: "#94A3B8",
  green: "#059669",
  red: "#E11D48",
  amber: "#F59E0B",
  indigo: "#4F46E5",
};

export function workStatusTone(kind: WorkKind, status?: string | null): WorkStatusTone {
  if (kind === "quote") return quoteStatusTone(status);
  if (kind === "survey") return surveyStatusTone(status);
  const key = String(status || "").trim().toLowerCase();
  if (key === "active") return "green";
  if (key === "on_hold") return "amber";
  if (key === "completed") return "indigo";
  return "slate";
}

export function workStatusDotColor(kind: WorkKind, status?: string | null): string {
  return STATUS_DOT[workStatusTone(kind, status)];
}

export function quoteListSubtitle(quote: Pick<QuoteDoc, "quote_number" | "title">): string {
  return quote.quote_number || quote.title || "Teklif";
}

export type SurveyStatusTone = "slate" | "indigo" | "green";

export function surveyStatusTone(status?: string | null): SurveyStatusTone {
  const key = String(status || "").trim().toLowerCase();
  if (key === "done") return "indigo";
  if (key === "quoted") return "green";
  return "slate";
}

/** Teklife dönüşen keşif listede durmaz. */
export function isSurveyConverted(survey: Pick<SurveyDoc, "status" | "quote_id">): boolean {
  const status = String(survey.status || "").trim().toLowerCase();
  return status === "quoted" || Boolean(survey.quote_id);
}

export function surveyListSubtitle(survey: Pick<SurveyDoc, "contact_name" | "address" | "survey_date">): string {
  return [survey.contact_name || "—", survey.address, survey.survey_date ? fmtDate(survey.survey_date) : ""].filter(Boolean).join(" · ");
}

export function newButtonLabel(kind: WorkKind): string {
  if (kind === "quote") return "Yeni Teklif";
  if (kind === "project") return "Yeni Proje";
  return "Yeni Keşif";
}

/** Proje kartındaki tamamla aksiyonu. */
export const PROJECT_QUOTE_ACTION = "Projeyi Tamamla";
export const PROJECT_NEW_QUOTE_ACTION = "Yeni Teklif";
export const PROJECT_MAPS_ACTION = "Konuma Git";
export const SURVEY_MAPS_ACTION = PROJECT_MAPS_ACTION;

/** Karttan teklif formuna proje + cariyi taşır. */
export function projectQuoteNavParams(p: ProjectDoc) {
  return {
    project_id: idOf(p),
    contact_id: String(p.contact_id || ""),
    contact_name: String(p.contact_name || ""),
    title: String(p.name || ""),
  };
}

export function canCompleteProject(status?: string | null, stages?: ProjectStage[] | null): boolean {
  return !isCompletedProjectStatus(status, stages);
}

/** Kalem satırlarını birbirinden ayıran zebra tonları. */
export function itemStripe(index: number): { backgroundColor: string } {
  return { backgroundColor: index % 2 === 0 ? "#F1F5F9" : "#EEF2FF" };
}

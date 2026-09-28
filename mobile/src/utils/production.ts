/** Üretim emri / reçete (BOM) — web ProductionPage ile aynı API. */

export type RecipeMaterial = {
  product_id?: string;
  product_name?: string;
  quantity?: number;
  unit?: string;
  wastage_percent?: number;
};

export type ProductionRecipe = {
  id?: string;
  _id?: string;
  code?: string;
  name?: string;
  finished_product_id?: string;
  finished_product_name?: string;
  target_quantity?: number;
  unit?: string;
  unit_cost?: number;
  total_estimated_cost?: number;
  materials?: RecipeMaterial[];
  is_active?: boolean;
  one_time?: boolean;
  contact_name?: string;
  job_file_name?: string;
};

export type ProductionOrder = {
  id?: string;
  _id?: string;
  order_code?: string;
  recipe_id?: string;
  recipe_name?: string;
  finished_product_id?: string;
  finished_product_name?: string;
  planned_quantity?: number;
  completed_quantity?: number;
  unit?: string;
  planned_date?: string;
  status?: string;
  notes?: string;
  source?: string;
  estimated_total_cost?: number;
  shortages?: unknown[];
};

export type ProductionKpis = {
  open?: number;
  in_production?: number;
  completed_this_month?: number;
  recipes?: number;
  missing_notifications?: number;
};

export type RequirementRow = {
  product_id?: string;
  product_name?: string;
  needed?: number;
  in_stock?: number;
  shortage?: number;
  unit?: string;
};

export type Requirements = {
  rows?: RequirementRow[];
  estimated_total_cost?: number;
  unit_cost?: number;
  has_shortage?: boolean;
};

const ORDER_STATUS: Record<string, { label: string; tone: "slate" | "amber" | "green" | "rose" }> = {
  planned: { label: "Planlandı", tone: "slate" },
  in_production: { label: "Üretimde", tone: "amber" },
  completed: { label: "Tamamlandı", tone: "green" },
  cancelled: { label: "İptal", tone: "rose" },
};

export function productionOrderStatus(status?: string) {
  return ORDER_STATUS[String(status || "")] || ORDER_STATUS.planned;
}

export function recipeIdOf(r?: { id?: string; _id?: string } | null) {
  return String(r?.id || r?._id || "");
}

export function formatBomQty(n?: number | null) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
}

import { parseScanQtyInput } from "./scanQty";

export type CountItem = {
  product_id?: string;
  variant_id?: string | null;
  product_name?: string;
  sku?: string;
  barcode?: string;
  expected?: number;
  counted?: number;
  scanned?: boolean;
};

export type CountSession = {
  id?: string;
  _id?: string;
  name?: string;
  warehouse_id?: string | null;
  warehouse_name?: string;
  status?: string;
  items?: CountItem[];
  created_at?: string;
  message?: string;
};

export type CountListRow = CountSession;

export function countIdOf(row?: { id?: string; _id?: string } | null): string {
  return String(row?.id || row?._id || "");
}

export function scannedItems(session?: CountSession | null): CountItem[] {
  return (session?.items || []).filter((i) => i.scanned);
}

export function diffItems(session?: CountSession | null): CountItem[] {
  return scannedItems(session).filter((i) => Number(i.counted) !== Number(i.expected));
}

export function countDiff(item: CountItem): number {
  return Number(item.counted || 0) - Number(item.expected || 0);
}

export function scanCountPayload(barcode: string, qtyRaw?: string | number | null) {
  return { barcode: String(barcode || "").trim(), quantity: parseScanQtyInput(qtyRaw) };
}

export function adjustCountPayload(item: CountItem, counted: number) {
  return {
    product_id: item.product_id,
    variant_id: item.variant_id ?? null,
    counted: Math.max(0, Number(counted) || 0),
  };
}

export type WarehouseOption = { id?: string; _id?: string; name?: string };

/** Web kiosk depo seçici: boş değer tüm depolar. */
export function warehouseSelectGroups(rows?: WarehouseOption[] | null) {
  const options = (rows || [])
    .map((w) => ({ value: String(w.id || w._id || ""), label: String(w.name || "Depo").trim() || "Depo" }))
    .filter((o) => o.value);
  return options.length ? [{ label: "Depolar", options }] : [];
}

export function stockCountCreatePayload(companyId: string, name: string, warehouseId?: string | null) {
  const warehouse = String(warehouseId || "").trim();
  return {
    company_id: companyId,
    name: name.trim() || undefined,
    warehouse_id: warehouse || null,
    preload_all: false,
  };
}

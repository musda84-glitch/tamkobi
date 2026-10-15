import { isIncomingDispatch } from "./despatchShipment";

export function dispatchRowKey(inv) {
  return inv?.id || inv?._id || inv?.invoice_number || "";
}

/** Görünür listedeki seçili giden irsaliye id'leri (liste sırası). */
export function selectedOutgoingDispatchIds(rows, selectedIds) {
  const picked = new Set(selectedIds || []);
  const ids = [];
  for (const row of rows || []) {
    const key = dispatchRowKey(row);
    const id = String(row?.id || row?._id || "");
    if (!key || !picked.has(key)) continue;
    if (row?.invoice_type !== "dispatch" && row?.e_type !== "e_dispatch") continue;
    if (isIncomingDispatch(row)) continue;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

import { isIncomingDispatch } from "./despatchShipment";

type MergeRow = {
  id?: string;
  _id?: string;
  invoice_type?: string;
  e_type?: string;
  direction?: string;
  source?: string;
  edoc_id?: string;
  gib_status?: string;
};

export function outgoingMergeIds(rows: MergeRow[], selected: string[]): string[] {
  const picked = new Set(selected || []);
  const ids: string[] = [];
  for (const row of rows || []) {
    const id = String(row?.id || row?._id || "");
    if (!id || !picked.has(id)) continue;
    if (row.invoice_type !== "dispatch" && row.e_type !== "e_dispatch") continue;
    if (isIncomingDispatch(row)) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function canMergeOutgoingDispatches(ids: string[]): boolean {
  return ids.length >= 2;
}

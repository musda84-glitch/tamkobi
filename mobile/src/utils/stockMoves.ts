export type StockMove = {
  id?: string;
  _id?: string;
  change?: number;
  qty?: number;
  quantity?: number;
  reason?: string;
  date?: string;
  source?: string;
};

export function moveChange(row?: StockMove | null): number {
  const n = Number(row?.change ?? row?.qty ?? row?.quantity);
  return Number.isFinite(n) ? n : 0;
}

export function parseStockMoves(data?: { movements?: StockMove[] | null; items?: StockMove[] | null } | StockMove[] | null): StockMove[] {
  const raw = Array.isArray(data) ? data : data?.movements || data?.items || [];
  return raw.filter((row) => row && (moveChange(row) || row.reason));
}

/** Sunucu tarafı cari arama — web ContactSearchSelect ile aynı uç. */

export const CONTACT_SEARCH_DEBOUNCE_MS = 300;
export const CONTACT_SEARCH_PAGE_SIZE = 20;

export type ContactSearchQuery = {
  companyId: string;
  q?: string;
  page?: number;
  suggest?: string;
  counterparty?: string;
  excludeType?: string;
};

export function contactSearchQuery(opts: ContactSearchQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {
    company_id: opts.companyId,
    q: String(opts.q || "").trim(),
    page: opts.page || 1,
    limit: CONTACT_SEARCH_PAGE_SIZE,
  };
  const suggest = String(opts.suggest || "").trim();
  const counterparty = String(opts.counterparty || "").trim();
  const excludeType = String(opts.excludeType || "").trim();
  if (suggest) params.suggest = suggest;
  if (counterparty) params.counterparty = counterparty;
  if (excludeType) params.exclude_type = excludeType;
  return params;
}

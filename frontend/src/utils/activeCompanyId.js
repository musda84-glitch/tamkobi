/** Active company id, or "" when none is selected. */
export function activeCompanyId(activeCompany) {
  return String(activeCompany?.id || activeCompany?._id || "");
}

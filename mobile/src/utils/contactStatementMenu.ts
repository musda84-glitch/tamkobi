/** Web `frontend/src/utils/contactStatementMenu.js` — Hesap Ekstresi menüsü. */

export type StatementMenuAction = "link" | "statement" | "detailed" | "reconciliation";

export type StatementMenuItem = {
  id: string;
  label: string;
  icon: string;
  color: string;
  action: StatementMenuAction;
  badge?: string;
};

export const CONTACT_STATEMENT_MENU_ITEMS: StatementMenuItem[] = [
  { id: "link", label: "Ekstre Linki", icon: "link-outline", color: "#059669", action: "link", badge: "yeni" },
  { id: "statement", label: "Ekstre", icon: "document-text-outline", color: "#B45309", action: "statement" },
  { id: "detailed", label: "Detaylı Ekstre", icon: "documents-outline", color: "#B45309", action: "detailed" },
  { id: "reconciliation", label: "Mutabakat Mektubu", icon: "document-outline", color: "#E11D48", action: "reconciliation" },
];

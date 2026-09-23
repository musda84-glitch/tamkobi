import { FileStack, FileText, Link2, FileType } from "lucide-react";

export const CONTACT_STATEMENT_MENU_ITEMS = [
  { id: "link", label: "Ekstre Linki", icon: Link2, iconClass: "text-emerald-600", badge: "yeni", action: "link" },
  { id: "statement", label: "Ekstre", icon: FileText, iconClass: "text-amber-700", action: "statement" },
  { id: "detailed", label: "Detaylı Ekstre", icon: FileStack, iconClass: "text-amber-700", action: "detailed" },
  { id: "reconciliation", label: "Mutabakat Mektubu", icon: FileType, iconClass: "text-rose-600", action: "reconciliation" },
];

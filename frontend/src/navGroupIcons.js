import {
  BarChart3,
  Calculator,
  Factory,
  LayoutGrid,
  MessageSquare,
  Package,
  Settings2,
  ShoppingBag,
  Sparkles,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import { NAV_GROUPS } from "./navGroups";

/** Sol menü paket başlığı ikonları (akordeon satırı). */
export const NAV_GROUP_ICONS = {
  muhasebe: Calculator,
  finans: Wallet,
  raporlama: BarChart3,
  satis: ShoppingBag,
  stok: Package,
  uretim: Factory,
  eticaret: Store,
  ik: Users,
  iletisim: MessageSquare,
  ai: Sparkles,
  sistem: Settings2,
};

export function iconForNavGroup(id) {
  return NAV_GROUP_ICONS[id] || LayoutGrid;
}

/** Etiketli her paket grubunun bir ikonu olmalı. */
export function labeledNavGroupsMissingIcons() {
  return NAV_GROUPS.filter((g) => g.label && !NAV_GROUP_ICONS[g.id]).map((g) => g.id);
}

import React from "react";
import { ChevronDown, Menu } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { ORDER_BULK_ACTIONS, bulkActionNeedsSelection } from "../utils/orderBulkActions";

export const OrdersBulkMenu = ({ selectedCount = 0, busy = false, onAction }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white rounded-lg text-xs font-semibold shadow-sm"
        data-testid="orders-bulk-menu-btn"
      >
        <Menu className="w-3.5 h-3.5" />
        Toplu İşlemler
        {selectedCount > 0 && <span className="bg-white/20 rounded px-1.5 py-0.5 text-[10px]">{selectedCount}</span>}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="z-[80] w-80 max-h-[70vh] overflow-y-auto rounded-xl p-1 shadow-lg" data-testid="orders-bulk-menu">
      {ORDER_BULK_ACTIONS.map((action) => {
        const locked = bulkActionNeedsSelection(action.id) && selectedCount < 1;
        const Icon = action.icon;
        return (
          <DropdownMenuItem
            key={action.id}
            disabled={locked || busy}
            onSelect={() => onAction?.(action.id)}
            className={`gap-2 text-xs ${locked ? "text-slate-400" : "text-slate-700"}`}
            data-testid={`bulk-action-${action.id}`}
          >
            <Icon className={`w-4 h-4 shrink-0 ${locked ? "text-slate-300" : "text-slate-500"}`} />
            <span className="truncate">{action.label}</span>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  </DropdownMenu>
);

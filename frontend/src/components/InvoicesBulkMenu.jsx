import React from "react";
import { ChevronDown, Menu } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { INVOICE_BULK_ACTIONS, invoiceBulkNeedsSelection } from "../utils/invoiceBulkActions";

const runBulkAction = (onAction, id) => {
  if (!onAction) return;
  window.setTimeout(() => {
    try {
      const result = onAction(id);
      if (result && typeof result.catch === "function") {
        result.catch((err) => {
          console.error("invoices bulk action failed", id, err);
        });
      }
    } catch (err) {
      console.error("invoices bulk action failed", id, err);
    }
  }, 0);
};

export const InvoicesBulkMenu = ({ selectedCount = 0, busy = false, onAction }) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white rounded-lg text-xs font-semibold shadow-sm"
        data-testid="invoices-bulk-menu-btn"
      >
        <Menu className="w-3.5 h-3.5" />
        Toplu İşlemler
        {selectedCount > 0 && <span className="bg-white/20 rounded px-1.5 py-0.5 text-[10px]">{selectedCount}</span>}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="z-[80] w-80 max-h-[70vh] overflow-y-auto rounded-xl p-1 shadow-lg" data-testid="invoices-bulk-menu">
      {INVOICE_BULK_ACTIONS.map((action) => {
        const locked = invoiceBulkNeedsSelection(action.id) && selectedCount < 1;
        const Icon = action.icon;
        return (
          <DropdownMenuItem
            key={action.id}
            disabled={locked || busy}
            onSelect={(e) => {
              if (locked || busy) {
                e.preventDefault();
                return;
              }
              runBulkAction(onAction, action.id);
            }}
            className={`gap-2 text-xs cursor-pointer ${locked ? "text-slate-400" : "text-slate-700"}`}
            data-testid={`inv-bulk-action-${action.id}`}
          >
            <Icon className={`w-4 h-4 shrink-0 ${locked ? "text-slate-300" : "text-slate-500"}`} />
            <span className="truncate">{action.label}</span>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  </DropdownMenu>
);

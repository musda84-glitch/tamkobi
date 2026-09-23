import React from "react";
import { ChevronDown, List } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { CONTACT_STATEMENT_MENU_ITEMS } from "../utils/contactStatementMenu";

export function ContactStatementMenu({ onSelect, disabled = false, busy = false }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 text-slate-800 rounded-lg text-xs font-semibold transition"
          data-testid="detail-statement-menu-btn"
          title="Hesap ekstresi"
        >
          <List className="w-3.5 h-3.5 text-slate-500" />
          {busy ? "…" : "Hesap Ekstresi"}
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="z-[80] w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        data-testid="detail-statement-menu"
      >
        {CONTACT_STATEMENT_MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => onSelect?.(item)}
              className="gap-2.5 text-xs text-slate-800 cursor-pointer rounded-md px-2.5 py-2 focus:bg-slate-50"
              data-testid={`detail-statement-${item.id}`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${item.iconClass || "text-slate-500"}`} />
              <span className="flex-1 truncate font-medium">{item.label}</span>
              {item.badge ? (
                <span className="shrink-0 rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                  {item.badge}
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

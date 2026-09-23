import React from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { CONTACT_PAY_MENU_SECTIONS } from "../utils/contactPayMenu";

export function ContactPayMenu({ onSelect, disabled = false }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg text-xs font-semibold transition"
          data-testid="detail-collect-btn"
          title="Tahsilat / Ödeme"
        >
          <span aria-hidden="true">₺</span>
          Tahsilat/Ödeme
          <ChevronDown className="w-3.5 h-3.5 opacity-90" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="z-[80] w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        data-testid="detail-collect-menu"
      >
        {CONTACT_PAY_MENU_SECTIONS.map((section, idx) => (
          <React.Fragment key={section.id}>
            {idx > 0 ? <DropdownMenuSeparator className="my-1 bg-slate-100" /> : null}
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => onSelect?.(item)}
                  className="gap-2.5 text-xs text-slate-800 cursor-pointer rounded-md px-2.5 py-2 focus:bg-slate-50"
                  data-testid={`detail-collect-${item.id}`}
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
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

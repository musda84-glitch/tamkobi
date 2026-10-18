import React from "react";
import { MoreHorizontal, Pencil, Printer, Receipt, Users, Link2, Images, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

function printTitle(linked) {
  if (linked.length > 1) return `${linked.length} teklif — yazdırılacak olanı seçin`;
  if (linked.length === 1) return `${linked[0].quote_number} teklifini yazdır`;
  return "Bu projede yazdırılacak teklif yok";
}

export function ProjectPrintQuoteControl({ project, quotes = [], onPrintQuote, variant = "menu" }) {
  const number = project?.project_number;
  const linked = Array.isArray(quotes) ? quotes : [];
  const printTestId = `project-print-quote-${number}`;
  const menuTestId = `project-print-quote-menu-${number}`;
  const title = printTitle(linked);
  const items = linked.map((quote) => (
    <DropdownMenuItem
      key={quote.id || quote.quote_number}
      onSelect={() => onPrintQuote?.(quote)}
      className="text-xs font-semibold"
      data-testid={`project-print-quote-item-${quote.quote_number}`}
    >
      {quote.quote_number}{quote.title ? ` · ${quote.title}` : ""}
    </DropdownMenuItem>
  ));

  if (linked.length > 1 && variant === "button") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-2.5 py-1.5 font-semibold text-sky-800 hover:bg-sky-100" data-testid={printTestId} title={title}>
            <Printer className="h-3.5 w-3.5" /> Teklif Yazdır
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[80] w-56 rounded-xl p-1" data-testid={menuTestId}>
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (linked.length > 1) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="text-xs font-semibold" data-testid={printTestId} title={title}>
          <Printer className="h-3.5 w-3.5" /> Teklif Yazdır
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="z-[80] w-56 rounded-xl p-1" data-testid={menuTestId}>
          {items}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  if (variant === "button") {
    return (
      <button
        type="button"
        disabled={!linked.length}
        onClick={() => linked[0] && onPrintQuote?.(linked[0])}
        className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-2.5 py-1.5 font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-40"
        data-testid={printTestId}
        title={title}
      >
        <Printer className="h-3.5 w-3.5" /> Teklif Yazdır
      </button>
    );
  }

  return (
    <DropdownMenuItem
      disabled={!linked.length}
      onSelect={() => linked[0] && onPrintQuote?.(linked[0])}
      className="text-xs font-semibold"
      data-testid={printTestId}
      title={title}
    >
      <span className="flex min-w-0 flex-col items-start">
        <span className="inline-flex items-center gap-1.5"><Printer className="h-3.5 w-3.5" /> Teklif Yazdır</span>
        {!linked.length ? <span className="text-[10px] font-normal text-slate-400">Bu projede yazdırılacak teklif yok</span> : null}
      </span>
    </DropdownMenuItem>
  );
}

export function ProjectActionsMenu({
  project,
  quotes = [],
  onEdit,
  onPrintQuote,
  onExpense,
  onTeam,
  onTrack,
  onOpenDetail,
  onDelete,
}) {
  const number = project?.project_number;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
          data-testid={`project-more-${number}`}
          aria-label="Diğer işlemler"
          title="Diğer işlemler"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[80] w-56 rounded-xl p-1">
        <DropdownMenuItem className="text-xs font-semibold" data-testid={`project-edit-${number}`} onSelect={() => onEdit?.(project)}>
          <Pencil className="h-3.5 w-3.5" /> Proje Düzenle
        </DropdownMenuItem>
        <ProjectPrintQuoteControl project={project} quotes={quotes} onPrintQuote={onPrintQuote} />
        <DropdownMenuItem className="text-xs font-semibold" data-testid={`project-expense-${number}`} onSelect={() => onExpense?.(project)}>
          <Receipt className="h-3.5 w-3.5" /> Masraf Ekle
        </DropdownMenuItem>
        <DropdownMenuItem className="text-xs font-semibold" data-testid={`project-team-${number}`} onSelect={() => onTeam?.(project)}>
          <Users className="h-3.5 w-3.5" /> Personel / Görev
        </DropdownMenuItem>
        <DropdownMenuItem className="text-xs font-semibold" data-testid={`project-track-${number}`} onSelect={() => onTrack?.(project)}>
          <Link2 className="h-3.5 w-3.5" /> Takip Linki gönder
        </DropdownMenuItem>
        <DropdownMenuItem className="text-xs font-semibold" data-testid={`project-open-detail-${number}`} onSelect={() => onOpenDetail?.("photos")}>
          <Images className="h-3.5 w-3.5" /> Detay / tüm fotoğraflar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs font-semibold text-rose-700 focus:text-rose-700" data-testid={`project-delete-${number}`} onSelect={() => onDelete?.(project)}>
          <Trash2 className="h-3.5 w-3.5" /> Projeyi sil
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import React from "react";
import { CircleHelp } from "lucide-react";
import { useHelpOptional } from "../../context/HelpContext";
import { HelpPopover } from "./HelpPopover";

export function HelpButton({ tone = "app" }) {
  const help = useHelpOptional();
  if (!help) return null;
  const active = help.popoverOpen;
  const cls =
    tone === "system"
      ? `p-2 rounded-lg transition ${active ? "bg-amber-400 text-slate-900" : "text-slate-400 hover:bg-white/10 hover:text-white"}`
      : `p-2 rounded-lg transition ${active ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`;
  return (
    <div className="relative" data-help-id="help-button">
      <button
        type="button"
        className={cls}
        aria-label="Sayfa yardımı"
        title="Sayfa yardımı"
        data-testid="help-page-btn"
        onClick={() => (help.popoverOpen ? help.closeHelp() : help.openHelp())}
      >
        <CircleHelp className="w-4 h-4" />
      </button>
      {help.popoverOpen && <HelpPopover tone={tone} />}
    </div>
  );
}

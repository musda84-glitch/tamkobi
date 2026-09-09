
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { groupIdOf, groupMenuItems } from "../navGroups";

const OPEN_KEY = "nav_groups_open_v2";

function loadOpen() {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_KEY) || "null");
    if (Array.isArray(raw)) return raw;
  } catch { /* ignore */ }
  return [];
}

export default function AppSidebarNav({ items, onNavigate, onReorder }) {
  const location = useLocation();
  const groups = useMemo(() => groupMenuItems(items), [items]);
  const activePath = location.pathname;
  const activeGroup = groups.find((g) => g.items.some((m) => m.path === activePath))?.id;
  const [open, setOpen] = useState(loadOpen);
  const [dragPath, setDragPath] = useState(null);

  useEffect(() => {
    if (activeGroup && !open.includes(activeGroup)) {
      setOpen((prev) => [...prev, activeGroup]);
    }
  }, [activeGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  }, [open]);

  const toggle = (id) => {
    setOpen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const linkClass = (item, isActive) =>
    `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
      isActive
        ? item.isAi
          ? "bg-gradient-to-r from-purple-600/90 to-indigo-600/90 text-white shadow-md shadow-purple-900/40"
          : item.isSystem
            ? "bg-amber-500 text-slate-900 shadow-md shadow-amber-900/40"
            : "bg-emerald-600 text-white shadow-md shadow-emerald-950/40"
        : item.isAi
          ? "text-purple-300 hover:bg-purple-950/40 hover:text-white"
          : item.isSystem
            ? "text-amber-300 hover:bg-amber-950/40 hover:text-white border border-amber-500/20"
            : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
    }`;

  const renderItem = (item) => {
    const Icon = item.icon;
    const isActive = activePath === item.path;
    return (
      <Link
        key={item.path}
        to={item.path}
        draggable
        onDragStart={() => setDragPath(item.path)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          if (dragPath && dragPath !== item.path && groupIdOf(dragPath) === groupIdOf(item.path)) onReorder?.(dragPath, item.path);
          setDragPath(null);
        }}
        title="Aynı paket içinde sürükleyip sıralayabilirsiniz"
        onClick={() => onNavigate?.()}
        data-testid={`nav-item-${item.path.replace("/", "") || "dashboard"}`}
        className={linkClass(item, isActive)}
      >
        <div className="flex items-center gap-2.5 truncate">
          {Icon && (
            <Icon
              className={`w-4 h-4 shrink-0 ${
                isActive
                  ? item.isSystem
                    ? "text-slate-900"
                    : "text-white"
                  : item.isAi
                    ? "text-purple-400"
                    : item.isSystem
                      ? "text-amber-400"
                      : "text-slate-400"
              }`}
            />
          )}
          <span className="truncate">{item.label}</span>
        </div>
        {item.badge && (
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold shrink-0 ${
              isActive ? "bg-white/20 text-white" : item.isAi ? "bg-purple-500/20 text-purple-300" : "bg-slate-800 text-slate-400"
            }`}
          >
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="space-y-1.5">
      {groups.map((g) => {
        const isOpen = !g.label || open.includes(g.id);
        const groupActive = g.items.some((m) => m.path === activePath);
        if (!g.label) {
          return (
            <div key={g.id} className="space-y-0.5" data-testid={`nav-group-${g.id}`}>
              {g.items.map(renderItem)}
            </div>
          );
        }
        return (
          <div
            key={g.id}
            className={`rounded-lg border overflow-hidden ${
              groupActive ? "border-emerald-800/60 bg-slate-800/40" : "border-slate-800 bg-slate-800/20"
            }`}
            data-testid={`nav-group-${g.id}`}
          >
            <button
              type="button"
              onClick={() => toggle(g.id)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
                groupActive ? "text-emerald-300" : "text-slate-500 hover:text-slate-300"
              }`}
              data-testid={`nav-group-toggle-${g.id}`}
              aria-expanded={isOpen}
            >
              <span>{g.label}</span>
              <span className="flex items-center gap-1 font-mono font-semibold normal-case tracking-normal text-slate-500">
                {g.items.length}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`} />
              </span>
            </button>
            {isOpen && <div className="px-1 pb-1 space-y-0.5">{g.items.map(renderItem)}</div>}
          </div>
        );
      })}
    </div>
  );
}

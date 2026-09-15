import React, { useCallback, useEffect, useState } from "react";
import { GripVertical, RotateCcw } from "lucide-react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";

const STORAGE_KEY = "dashboard_layout";

export const DEFAULT_DASHBOARD_LAYOUT = [
  "alerts",
  "overview",
  "decision",
  "demo",
  "ai",
  "kpis",
  "charts",
  "bottom",
];

const SECTION_LABELS = {
  alerts: "Personel & Operasyon",
  overview: "Tahsilat / Ödeme / Fatura",
  decision: "Yönetici karar özeti",
  demo: "Demo içerik",
  ai: "AI finans özeti",
  kpis: "KPI kartları",
  charts: "Grafikler",
  bottom: "Faturalar & kritik stok",
};

export function normalizeLayout(raw) {
  const known = new Set(DEFAULT_DASHBOARD_LAYOUT);
  const seen = new Set();
  const out = [];
  for (const id of raw || []) {
    const s = String(id);
    if (known.has(s) && !seen.has(s)) {
      out.push(s);
      seen.add(s);
    }
  }
  for (const id of DEFAULT_DASHBOARD_LAYOUT) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

function readLocalLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(raw) && raw.length) return normalizeLayout(raw);
  } catch { /* ignore */ }
  return [...DEFAULT_DASHBOARD_LAYOUT];
}

/** Genel Bakış bölüm sırası — kullanıcı başına tercihler + localStorage. */
export function useDashboardLayout() {
  const { user } = useAuth();
  const [order, setOrder] = useState(() => {
    const fromUser = user?.preferences?.dashboard_layout;
    if (Array.isArray(fromUser) && fromUser.length) return normalizeLayout(fromUser);
    return readLocalLayout();
  });
  const [editMode, setEditMode] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  useEffect(() => {
    const fromUser = user?.preferences?.dashboard_layout;
    if (Array.isArray(fromUser) && fromUser.length) setOrder(normalizeLayout(fromUser));
  }, [user?.preferences?.dashboard_layout]);

  const persist = useCallback(async (next) => {
    const layout = normalizeLayout(next);
    setOrder(layout);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
    try {
      await axios.put(`${API_URL}/auth/me/preferences`, { dashboard_layout: layout }, { withCredentials: true });
    } catch { /* offline */ }
  }, []);

  const onDragStart = (id) => (e) => {
    if (!editMode) return;
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragOver = (id) => (e) => {
    if (!editMode || !dragId || dragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverId(id);
  };
  const onDrop = (id) => (e) => {
    e.preventDefault();
    if (!editMode || !dragId || dragId === id) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const from = order.indexOf(dragId);
    const to = order.indexOf(id);
    if (from < 0 || to < 0) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persist(next);
    setDragId(null);
    setOverId(null);
  };
  const onDragEnd = () => {
    setDragId(null);
    setOverId(null);
  };

  const reset = () => persist([...DEFAULT_DASHBOARD_LAYOUT]);

  const wrap = useCallback((id, node) => {
    if (node == null) return null;
    return (
      <div
        key={id}
        data-testid={`dashboard-section-${id}`}
        data-section={id}
        draggable={editMode}
        onDragStart={onDragStart(id)}
        onDragOver={onDragOver(id)}
        onDrop={onDrop(id)}
        onDragEnd={onDragEnd}
        className={`relative transition ${editMode ? "ring-1 ring-dashed ring-slate-300 rounded-2xl pt-3" : ""} ${dragId === id ? "opacity-50 scale-[0.99]" : ""} ${overId === id && dragId !== id ? "ring-2 ring-emerald-400 rounded-2xl" : ""}`}
      >
        {editMode && (
          <div
            className="absolute -top-2 left-3 z-10 flex items-center gap-1 bg-slate-900 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full shadow cursor-grab active:cursor-grabbing select-none"
            data-testid={`dashboard-drag-${id}`}
          >
            <GripVertical className="w-3 h-3" />
            {SECTION_LABELS[id] || id}
          </div>
        )}
        {node}
      </div>
    );
  }, [editMode, dragId, overId, order, persist]);

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="dashboard-layout-toolbar">
      <div className="text-xs text-slate-500">
        {editMode ? "Bölümleri sürükleyerek kendi düzeninizi oluşturun — bu hesaba kaydedilir." : null}
      </div>
      <div className="flex items-center gap-2">
        {editMode && (
          <button
            type="button"
            onClick={reset}
            className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1"
            data-testid="dashboard-layout-reset"
          >
            <RotateCcw className="w-3 h-3" /> Varsayılan
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition ${editMode ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"}`}
          data-testid="dashboard-layout-toggle"
        >
          {editMode ? "Düzeni bitir" : "Düzeni düzenle"}
        </button>
      </div>
    </div>
  );

  return { order, editMode, wrap, toolbar, reset };
}

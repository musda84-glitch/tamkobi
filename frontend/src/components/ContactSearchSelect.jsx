import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { ChevronDown, Search, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export const CONTACT_SEARCH_DEBOUNCE_MS = 300;
export const CONTACT_SEARCH_PAGE_SIZE = 20;

const TYPE_LABEL = {
  customer: "Müşteri",
  supplier: "Tedarikçi",
  both: "Müşteri & Tedarikçi",
};

const placeMenu = (anchor) => {
  const rect = anchor.getBoundingClientRect();
  const width = Math.max(rect.width, 320);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = window.innerHeight - rect.bottom;
  const openUp = below < 240 && rect.top > below;
  return {
    left,
    width,
    top: openUp ? undefined : rect.bottom + 4,
    bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
    maxHeight: Math.max(160, Math.min(360, openUp ? rect.top - 16 : below - 16)),
  };
};

const optionId = (o) => o?.id ?? o?._id;

const contactSub = (c) => {
  const kind = TYPE_LABEL[c?.type] || "Cari";
  return [kind, c?.tax_number_or_id, c?.phone, c?.email].filter(Boolean).join(" · ");
};

/**
 * Sunucu tarafı cari seçici. Boş sorgu son kullanılanları getirir.
 * Yazarken 300 ms bekler; ünvan, kısa ad, cari kodu, VKN, telefon ve e-posta aranır.
 */
export const ContactSearchSelect = ({
  companyId,
  value,
  onChange,
  placeholder = "Cari ara…",
  searchPlaceholder = "Ünvan, cari kodu, VKN, telefon veya e-posta",
  valueLabel = "",
  testId,
  className = "",
  inline = false,
  clearable = false,
  clearLabel = "Seçimi kaldır",
  leadingAction = null,
}) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [box, setBox] = useState(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const reqId = useRef(0);

  useEffect(() => {
    const h = (e) => {
      if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useLayoutEffect(() => {
    if (!open || !ref.current) return undefined;
    const update = () => setBox(placeMenu(ref.current));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !companyId) return undefined;
    const query = String(q || "");
    const ctrl = new AbortController();
    let timer = null;
    let cancelled = false;
    const run = () => {
      const id = ++reqId.current;
      setLoading(true);
      axios.get(`${API_URL}/contacts/search`, {
        params: { company_id: companyId, q: query, page: 1, limit: CONTACT_SEARCH_PAGE_SIZE },
        signal: ctrl.signal,
      }).then((r) => {
        if (cancelled || id !== reqId.current) return;
        const data = r.data || {};
        setItems(Array.isArray(data.items) ? data.items : []);
        setPage(1);
        setHasMore(!!data.has_more);
      }).catch((err) => {
        if (cancelled || ctrl.signal.aborted || err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
        if (id !== reqId.current) return;
        setItems([]);
        setHasMore(false);
      }).finally(() => {
        if (!cancelled && id === reqId.current) setLoading(false);
      });
    };
    if (query.trim()) timer = setTimeout(run, CONTACT_SEARCH_DEBOUNCE_MS);
    else run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, q, companyId]);

  const loadMore = () => {
    if (!companyId || loading || !hasMore) return;
    const next = page + 1;
    const id = ++reqId.current;
    setLoading(true);
    axios.get(`${API_URL}/contacts/search`, {
      params: { company_id: companyId, q, page: next, limit: CONTACT_SEARCH_PAGE_SIZE },
    }).then((r) => {
      if (id !== reqId.current) return;
      const data = r.data || {};
      const more = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => {
        const seen = new Set(prev.map((c) => optionId(c)));
        return [...prev, ...more.filter((c) => !seen.has(optionId(c)))];
      });
      setPage(next);
      setHasMore(!!data.has_more);
    }).catch(() => {
      if (id === reqId.current) setHasMore(false);
    }).finally(() => {
      if (id === reqId.current) setLoading(false);
    });
  };

  const selected = items.find((o) => optionId(o) === value) || (picked && optionId(picked) === value ? picked : null);
  const displayLabel = selected ? (selected.name || selected.company_title || "") : (value && valueLabel ? valueLabel : "");
  const hasValue = Boolean(value);
  const clear = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setPicked(null);
    onChange("", null);
    setOpen(false);
    setQ("");
  };
  const panel = (
    <>
      <div className="relative border-b">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full pl-8 p-2 text-xs outline-none"
          data-testid={testId ? `${testId}-search` : undefined}
        />
      </div>
      {leadingAction?.label && (
        <button
          type="button"
          onClick={async () => {
            try {
              await leadingAction.onSelect?.();
            } finally {
              setOpen(false);
              setQ("");
            }
          }}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs text-rose-800 hover:bg-rose-50 border-b border-rose-100 font-bold bg-rose-50/40"
          data-testid={leadingAction.testId || (testId ? `${testId}-leading` : undefined)}
        >
          {leadingAction.icon || null}
          <span className="flex-1 min-w-0">
            <span className="block truncate">{leadingAction.label}</span>
            {leadingAction.sub ? <span className="block text-[10px] font-medium text-rose-700/80 truncate">{leadingAction.sub}</span> : null}
          </span>
        </button>
      )}
      {clearable && hasValue && (
        <button
          type="button"
          onClick={clear}
          className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-rose-700 hover:bg-rose-50 border-b border-slate-100 font-semibold"
          data-testid={testId ? `${testId}-clear` : undefined}
        >
          <X className="w-3.5 h-3.5 shrink-0" />
          {clearLabel}
        </button>
      )}
      <div className="max-h-48 overflow-y-auto">
        {loading && items.length === 0 && <div className="p-3 text-xs text-slate-400 text-center">Aranıyor…</div>}
        {!loading && items.length === 0 && <div className="p-3 text-xs text-slate-400 text-center">Sonuç yok</div>}
        {items.map((o) => (
          <button
            type="button"
            key={optionId(o) || o.name}
            onClick={() => {
              setPicked(o);
              onChange(optionId(o), o);
              setOpen(false);
              setQ("");
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-emerald-50 ${optionId(o) === value ? "bg-emerald-50/60" : ""}`}
            data-testid={testId ? `${testId}-option-${optionId(o)}` : undefined}
          >
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-900 truncate">{o.name || o.company_title || "Cari"}</div>
              <div className="text-[10px] text-slate-500 truncate">{contactSub(o)}</div>
            </div>
          </button>
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="w-full px-3 py-2 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
            data-testid={testId ? `${testId}-more` : undefined}
          >
            {loading ? "Yükleniyor…" : "Daha fazla"}
          </button>
        )}
      </div>
    </>
  );
  return (
    <div ref={ref} className={`relative ${className}`} data-testid={testId}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-1.5 text-left text-xs" data-testid={testId ? `${testId}-trigger` : undefined}>
        <span className={`flex-1 truncate ${displayLabel ? "font-medium text-slate-900" : "text-slate-400"}`}>{displayLabel || placeholder}</span>
        {clearable && hasValue && (
          <span
            role="button"
            tabIndex={0}
            onClick={clear}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") clear(e); }}
            className="p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
            title={clearLabel}
            data-testid={testId ? `${testId}-clear-btn` : undefined}
          >
            <X className="w-3.5 h-3.5" />
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>
      {open && inline && (
        <div ref={menuRef} className="mt-1 w-full min-w-[280px] bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden" data-testid={testId ? `${testId}-menu` : undefined}>
          {panel}
        </div>
      )}
      {open && !inline && box && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
          style={{ top: box.top, bottom: box.bottom, left: box.left, width: box.width, maxHeight: box.maxHeight }}
          data-testid={testId ? `${testId}-menu` : undefined}
        >
          {panel}
        </div>,
        document.body
      )}
    </div>
  );
};

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { ChevronDown, Search, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { BALANCE_TONE_CLASS, contactBalanceBadge } from "../utils/contactBalanceBadge";

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

const BalanceMark = ({ contact, testId }) => {
  const badge = contactBalanceBadge(contact);
  return (
    <span
      className={`shrink-0 tabular-nums font-bold ${BALANCE_TONE_CLASS[badge.tone]}`}
      data-side={badge.tone}
      data-testid={testId}
    >
      {badge.text}
    </span>
  );
};

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
  /** Menüde her zaman görünen boş seçim (ör. "boş = sadece onayla"). */
  emptyLabel = "",
  /** Banka açıklaması; Firma Adı buradan çıkarılıp öneri olarak üstte gelir. */
  suggestText = "",
  counterparty = "",
  /** Örn. "customer" — masraf tedarikçisinde müşteri tipi gizlenir. */
  excludeType = "",
  leadingAction = null,
}) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [box, setBox] = useState(null);
  const [items, setItems] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestQuery, setSuggestQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const focusRow = (next) => {
    const value = typeof next === "function" ? next(activeRef.current) : next;
    activeRef.current = value;
    setActive(value);
  };
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
      const params = { company_id: companyId, q: query, page: 1, limit: CONTACT_SEARCH_PAGE_SIZE };
      if (suggestText) params.suggest = suggestText;
      if (counterparty) params.counterparty = counterparty;
      if (excludeType) params.exclude_type = excludeType;
      axios.get(`${API_URL}/contacts/search`, {
        params,
        signal: ctrl.signal,
      }).then((r) => {
        if (cancelled || id !== reqId.current) return;
        const data = r.data || {};
        setItems(Array.isArray(data.items) ? data.items : []);
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
        setSuggestQuery(String(data.suggest_query || ""));
        setPage(1);
        setHasMore(!!data.has_more);
      }).catch((err) => {
        if (cancelled || ctrl.signal.aborted || err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
        if (id !== reqId.current) return;
        setItems([]);
        setSuggestions([]);
        setSuggestQuery("");
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
  }, [open, q, companyId, suggestText, counterparty, excludeType]);

  useEffect(() => {
    if (!open) return;
    const sugIdx = rows.findIndex((row) => row.kind === "suggest");
    const selectedIdx = rows.findIndex((row) => row.kind !== "empty" && optionId(row.item) === value);
    const next = !String(q || "").trim() && selectedIdx >= 0 ? selectedIdx : (sugIdx >= 0 ? sugIdx : 0);
    activeRef.current = next;
    setActive(next);
    // Satırlar öneri/seçim geldikçe güncellenir; ok tuşu konumunu her aramada sıfırlarız.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, suggestQuery, value]);

  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelector('[data-active="1"]');
    el?.scrollIntoView?.({ block: "nearest" });
  }, [active, open, items, suggestions]);

  const loadMore = () => {
    if (!companyId || loading || !hasMore) return;
    const next = page + 1;
    const id = ++reqId.current;
    setLoading(true);
    const params = { company_id: companyId, q, page: next, limit: CONTACT_SEARCH_PAGE_SIZE };
    if (suggestText) params.suggest = suggestText;
    if (counterparty) params.counterparty = counterparty;
    if (excludeType) params.exclude_type = excludeType;
    axios.get(`${API_URL}/contacts/search`, {
      params,
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

  const sugIds = new Set(suggestions.map((c) => optionId(c)).filter(Boolean));
  const listItems = items.filter((o) => !sugIds.has(optionId(o)));
  const rows = [];
  if (emptyLabel) rows.push({ key: "empty", kind: "empty" });
  suggestions.forEach((item) => {
    const id = optionId(item);
    if (!id) return;
    rows.push({ key: `s-${id}`, kind: "suggest", item });
  });
  listItems.forEach((item) => {
    const id = optionId(item);
    rows.push({ key: `i-${id || item.name}`, kind: "item", item });
  });
  const selected = items.find((o) => optionId(o) === value)
    || suggestions.find((o) => optionId(o) === value)
    || (picked && optionId(picked) === value ? picked : null);
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
  const choose = (row) => {
    if (!row || row.kind === "empty") {
      setPicked(null);
      onChange("", null);
    } else {
      setPicked(row.item);
      onChange(optionId(row.item), row.item);
    }
    setOpen(false);
    setQ("");
  };
  const onSearchKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!rows.length) return;
      focusRow((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!rows.length) return;
      focusRow((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[activeRef.current]) choose(rows[activeRef.current]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };
  const optionButton = (row, index) => {
    const highlighted = index === active;
    if (row.kind === "empty") {
      return (
        <button
          type="button"
          key={row.key}
          onMouseEnter={() => focusRow(index)}
          onClick={() => choose(row)}
          data-active={highlighted ? "1" : "0"}
          className={`w-full px-3 py-2 text-left text-xs border-b border-slate-100 ${highlighted ? "bg-violet-50" : "hover:bg-slate-50"} ${!hasValue ? "text-violet-800 font-semibold" : "text-slate-500"}`}
          data-testid={testId ? `${testId}-empty` : undefined}
        >
          {emptyLabel}
        </button>
      );
    }
    const o = row.item;
    const id = optionId(o);
    const suggested = row.kind === "suggest";
    return (
      <button
        type="button"
        key={row.key}
        onMouseEnter={() => focusRow(index)}
        onClick={() => choose(row)}
        data-active={highlighted ? "1" : "0"}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-emerald-50 ${highlighted ? "bg-emerald-100" : ""} ${id === value ? "bg-emerald-50/60" : ""}`}
        data-testid={testId ? `${testId}-${suggested ? "suggest" : "option"}-${id}` : undefined}
      >
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900 flex items-center gap-2 min-w-0">
            <span className="truncate min-w-0">{o.name || o.company_title || "Cari"}</span>
            {suggested ? <span className="shrink-0 text-[9px] font-bold uppercase text-violet-700">Öneri</span> : null}
            <BalanceMark contact={o} testId={testId ? `${testId}-balance-${id}` : undefined} />
          </div>
          <div className="text-[10px] text-slate-500 truncate">{contactSub(o)}</div>
        </div>
      </button>
    );
  };
  const panel = (
    <>
      <div className="relative border-b">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKey}
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
        {rows.map((row, index) => {
          const prev = rows[index - 1];
          const header = row.kind === "suggest" && prev?.kind !== "suggest"
            ? (
              <div key="suggest-head" className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-violet-700 bg-violet-50/70" data-testid={testId ? `${testId}-suggest-head` : undefined}>
                {suggestQuery ? `Firma Adı · ${suggestQuery}` : "Önerilen cariler"}
              </div>
            )
            : row.kind === "item" && suggestions.length > 0 && prev?.kind !== "item"
              ? <div key="rest-head" className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Diğer cariler</div>
              : null;
          return (
            <React.Fragment key={row.key}>
              {header}
              {optionButton(row, index)}
            </React.Fragment>
          );
        })}
        {loading && items.length === 0 && suggestions.length === 0 && <div className="p-3 text-xs text-slate-400 text-center">Aranıyor…</div>}
        {!loading && rows.length === 0 && <div className="p-3 text-xs text-slate-400 text-center">Sonuç yok</div>}
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
        <span className="flex-1 min-w-0 flex items-center gap-2">
          <span className={`truncate ${displayLabel ? "font-medium text-slate-900" : "text-slate-400"}`}>{displayLabel || placeholder}</span>
          {selected ? <BalanceMark contact={selected} testId={testId ? `${testId}-selected-balance` : undefined} /> : null}
        </span>
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

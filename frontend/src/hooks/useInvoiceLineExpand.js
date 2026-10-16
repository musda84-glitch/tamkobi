import { useCallback, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../context/AuthContext";

/** Fatura / teklif satır kimliği — liste seçimi ile aynı sıra. */
export function invoiceLineRowId(inv) {
  return inv?.id || inv?._id || inv?.invoice_number || "";
}

function embeddedItems(inv) {
  return Array.isArray(inv?.items) && inv.items.length ? inv.items : null;
}

/**
 * Fatura listesinde tek satırın kalemlerini aç/kapa.
 * Kalemler belgede varsa istek yok; yoksa bir kez GET edilip önbelleğe alınır.
 */
export function useInvoiceLineExpand() {
  const [expandedId, setExpandedId] = useState(null);
  const [itemsById, setItemsById] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const expandedRef = useRef(null);
  const itemsRef = useRef({});
  const inflightRef = useRef(new Set());

  const isOpen = useCallback((id) => expandedId === id, [expandedId]);

  const itemsFor = useCallback((inv) => {
    const embedded = embeddedItems(inv);
    if (embedded) return embedded;
    const id = invoiceLineRowId(inv);
    if (id && Array.isArray(itemsById[id])) return itemsById[id];
    return [];
  }, [itemsById]);

  const setItems = useCallback((id, items) => {
    if (!id) return;
    const next = Array.isArray(items) ? items : [];
    itemsRef.current = { ...itemsRef.current, [id]: next };
    setItemsById((prev) => ({ ...prev, [id]: next }));
  }, []);

  const toggle = useCallback(async (inv) => {
    const id = invoiceLineRowId(inv);
    if (!id) return;
    if (expandedRef.current === id) {
      expandedRef.current = null;
      setExpandedId(null);
      return;
    }
    expandedRef.current = id;
    setExpandedId(id);
    const have = Boolean(embeddedItems(inv)) || Array.isArray(itemsRef.current[id]);
    if (have) return;
    if (inflightRef.current.has(id)) {
      setLoadingId(id);
      return;
    }
    inflightRef.current.add(id);
    setLoadingId(id);
    try {
      const url = inv?._is_quote ? `${API_URL}/quotes/${id}` : `${API_URL}/invoices/${id}`;
      const r = await axios.get(url);
      const items = Array.isArray(r.data?.items) ? r.data.items : [];
      itemsRef.current = { ...itemsRef.current, [id]: items };
      setItemsById((prev) => ({ ...prev, [id]: items }));
    } catch {
      toast.error("Kalemler yüklenemedi.");
      itemsRef.current = { ...itemsRef.current, [id]: [] };
      setItemsById((prev) => ({ ...prev, [id]: [] }));
    } finally {
      inflightRef.current.delete(id);
      setLoadingId((cur) => (cur === id ? null : cur));
    }
  }, []);

  return { expandedId, isOpen, toggle, itemsFor, loadingId, setItems };
}

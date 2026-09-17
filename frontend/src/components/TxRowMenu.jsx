
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { MoreVertical, Printer, Pencil, Trash2, Lock, X } from "lucide-react";
import { toast } from "sonner";
import { API_URL } from "../context/AuthContext";
import { ReceiptPrint } from "./ReceiptPrint";

export const LOCKED_TX_SOURCES = new Set(["bank_sync", "partner", "bank_match"]);

export function isLockedTx(tx) {
  // Simüle banka hareketleri demo veridir; silme/düzenlemeye açıktır.
  if (tx?.source === "bank_sync" && tx?.is_simulated) return false;
  return LOCKED_TX_SOURCES.has(tx?.source);
}

function txKindLabel(tx) {
  if (tx?.type === "inflow") return "tahsilat";
  if (tx?.type === "outflow") return "ödeme";
  if (tx?.type === "transfer") return "virman";
  return "hareket";
}

export function TxRowMenu({ tx, accounts = [], company, contacts = [], onChanged }) {
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const txId = tx.id || tx._id;
  const locked = isLockedTx(tx);

  const placeMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuW = 220;
    const menuH = 148;
    const openUp = r.bottom + menuH + 8 > window.innerHeight;
    setMenuPos({
      top: openUp ? Math.max(8, r.top - menuH - 4) : r.bottom + 4,
      left: Math.min(Math.max(8, r.right - menuW), window.innerWidth - menuW - 8),
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const contact = contacts.find((c) => (c.id || c._id) === tx.contact_id) || {
    name: tx.contact_name || "",
    tax_number_or_id: "",
  };

  const onPrint = () => { setOpen(false); setReceipt(true); };

  const onEdit = () => {
    if (locked) {
      toast.error("Banka entegrasyonu / ortaklar hesabından gelen hareketler düzenlenemez.");
      return;
    }
    setOpen(false);
    setEditTx({
      id: txId,
      date: tx.date || "",
      account_id: tx.account_id || "",
      amount: tx.amount ?? "",
      description: tx.description || "",
      category: tx.category || "",
      type: tx.type,
    });
  };

  const onDelete = async () => {
    if (locked) {
      toast.error("Banka entegrasyonu / ortaklar hesabından gelen hareketler silinemez.");
      return;
    }
    setOpen(false);
    const kind = tx.is_simulated ? "simüle (demo) hareket" : txKindLabel(tx);
    if (!window.confirm(`${(tx.amount || 0).toLocaleString("tr-TR")} ₺ tutarındaki ${kind} silinsin mi? Bakiyeler geri alınır.`)) return;
    try {
      const r = await axios.delete(`${API_URL}/banking/transactions/${txId}`);
      toast.success(r.data.message || "Hareket çöp kutusuna taşındı.");
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    try {
      await axios.put(`${API_URL}/banking/transactions/${editTx.id}`, {
        amount: Number(editTx.amount),
        date: editTx.date,
        description: editTx.description,
        account_id: editTx.account_id,
        category: editTx.category,
      });
      toast.success("Hareket güncellendi.");
      setEditTx(null);
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Güncellenemedi.");
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (open) { setOpen(false); return; }
          placeMenu();
          setOpen(true);
        }}
        className={`p-1.5 rounded-lg transition ${open ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}
        title="İşlemler"
        data-testid={`tx-more-btn-${txId}`}
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[90] bg-white border border-slate-200 rounded-xl shadow-2xl p-1.5 w-[220px] text-left"
          style={{ top: menuPos.top, left: menuPos.left }}
          data-testid={`tx-more-menu-${txId}`}
        >
          <button type="button" onClick={onPrint} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100" data-testid={`tx-print-btn-${txId}`}>
            <Printer className="w-4 h-4 shrink-0" /> Hareket makbuzu yazdır
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={locked}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-700"
            data-testid={`tx-edit-btn-${txId}`}
            title={locked ? "Banka/ortak hareketleri düzenlenemez" : "Düzenle"}
          >
            {locked ? <Lock className="w-4 h-4 shrink-0" /> : <Pencil className="w-4 h-4 shrink-0" />} Düzenle
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={locked}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40 disabled:hover:bg-transparent disabled:text-slate-500"
            data-testid={`tx-delete-btn-${txId}`}
            title={locked ? "Banka/ortak hareketleri silinemez" : "Sil"}
          >
            {locked ? <Lock className="w-4 h-4 shrink-0" /> : <Trash2 className="w-4 h-4 shrink-0" />} Sil
          </button>
        </div>,
        document.body
      )}
      {receipt && createPortal(
        <ReceiptPrint
          tx={tx}
          contact={contact}
          company={company}
          onClose={() => setReceipt(false)}
        />,
        document.body
      )}
      {editTx && createPortal(
        <div className="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setEditTx(null)}>
          <form onSubmit={saveEdit} className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="tx-edit-modal">
            <div className="flex justify-between border-b pb-2">
              <h3 className="text-sm font-bold">{editTx.type === "inflow" ? "Tahsilat" : editTx.type === "outflow" ? "Ödeme" : "Virman"} Düzenle</h3>
              <button type="button" onClick={() => setEditTx(null)} className="text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <div>
              <label className="block font-semibold mb-1">Tarih</label>
              <input type="date" value={editTx.date} onChange={(e) => setEditTx({ ...editTx, date: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="tx-edit-date" />
            </div>
            <div>
              <label className="block font-semibold mb-1">Kasa / Banka</label>
              <select value={editTx.account_id} onChange={(e) => setEditTx({ ...editTx, account_id: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="tx-edit-account">
                {accounts.map((a) => {
                  const id = a.id || a._id;
                  return <option key={id} value={id}>{a.bank_name ? `${a.bank_name} — ${a.account_name}` : a.account_name}</option>;
                })}
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Tutar (₺)</label>
              <input type="number" step="0.01" min="0.01" value={editTx.amount} onChange={(e) => setEditTx({ ...editTx, amount: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2 font-bold text-base" required data-testid="tx-edit-amount" />
            </div>
            <div>
              <label className="block font-semibold mb-1">Kategori</label>
              <input value={editTx.category} onChange={(e) => setEditTx({ ...editTx, category: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="tx-edit-category" />
            </div>
            <div>
              <label className="block font-semibold mb-1">Açıklama</label>
              <input value={editTx.description} onChange={(e) => setEditTx({ ...editTx, description: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="tx-edit-desc" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setEditTx(null)} className="px-3 py-1.5 border rounded-lg">İptal</button>
              <button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="tx-edit-save">Kaydet</button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </>
  );
}

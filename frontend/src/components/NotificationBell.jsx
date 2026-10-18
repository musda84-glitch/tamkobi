
import React, { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { Bell, CheckCircle2, Trash2, Volume2, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { API_URL } from "../context/AuthContext";
import { useDataRefresh } from "../utils/dataRefresh";
import { localizeNotificationText } from "../utils/notificationText";
import { notifySoundPlan, playTamkobiNotify, unlockTamkobiNotify } from "../utils/notifySound";
import { notificationCanDelete, notificationDeletePath, swipeDeleteOutcome, NOTIFY_SWIPE_W } from "../utils/notificationSwipe";
import { MISSING_RECORD, notificationTarget } from "../utils/notificationTarget";

export const NotificationBell = ({ companyId }) => {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const soundRef = useRef({ seen: [], seeded: false });
  const navigate = useNavigate();
  const load = useCallback(() => {
    if (!companyId) return Promise.resolve();
    return axios.get(`${API_URL}/notifications?company_id=${companyId}`).then((r) => {
    const rows = Array.isArray(r.data) ? r.data : [];
    const unreadIds = rows.filter((n) => !n.is_read).map((n) => String(n.id || n._id || ""));
    const plan = notifySoundPlan(soundRef.current.seen, unreadIds, soundRef.current.seeded);
    soundRef.current = { seen: plan.seen, seeded: plan.seeded };
    if (plan.play) playTamkobiNotify();
    setItems(rows);
  }).catch(() => {});
  }, [companyId]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useDataRefresh(load, { companyId, scopes: ["orders", "notifications", "all"] });
  useEffect(() => {
    const unlock = () => unlockTamkobiNotify();
    document.addEventListener("pointerdown", unlock, { once: true });
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("mousedown", h);
    };
  }, []);
  const unread = items.filter((n) => !n.is_read).length;
  const openItem = async (n) => {
    const id = n.id || n._id;
    if (!n.is_read && id) {
      await axios.post(`${API_URL}/notifications/${id}/read`).catch(() => {});
      load();
    }
    setOpen(false);
    let target = notificationTarget(n);
    if (id) {
      try {
        const r = await axios.get(`${API_URL}/notifications/${id}/target`);
        if (r.data && r.data.exists === false) {
          toast.error(r.data.message || MISSING_RECORD);
          return;
        }
        if (r.data?.target?.route) target = r.data.target;
      } catch {
        /* kayıtlı hedef yoksa yerel tahmin */
      }
    }
    if (target?.route) navigate(target.route);
  };
  const markAllRead = async () => {
    if (!unread) return;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await axios.post(`${API_URL}/notifications/read-all`, null, { params: { company_id: companyId } });
    } catch {
      load();
    }
  };
  const deleteItem = async (n) => {
    const path = notificationDeletePath(n);
    if (!path) return;
    const id = String(n.id || n._id || "");
    setItems((prev) => prev.filter((x) => String(x.id || x._id || "") !== id));
    try {
      await axios.delete(`${API_URL}${path}`);
    } catch {
      load();
    }
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative p-2 text-slate-600 hover:bg-slate-100 rounded-lg" title="Bildirimler" data-testid="notification-bell">
        <Bell className="w-5 h-5" />
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-rose-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center" data-testid="notification-count">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden" data-testid="notification-panel">
          <div className="px-4 py-2.5 border-b text-xs font-bold text-slate-700 flex justify-between items-center gap-2">
            <span>Bildirimler</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { unlockTamkobiNotify(); playTamkobiNotify(); }}
                className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50"
                title="TamKobi bildirim sesi"
                data-testid="notification-sound-preview"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
              <span className="text-slate-400">{unread} okunmamış</span>
            </span>
          </div>
          {unread > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="w-full px-4 py-1.5 text-left text-[11px] font-bold text-emerald-700 bg-emerald-50 border-b border-emerald-100 hover:bg-emerald-100"
              data-testid="notification-read-all"
            >
              Tümünü okundu işaretle
            </button>
          )}
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {items.length === 0 && <div className="p-6 text-center text-xs text-slate-400">Bildirim yok.</div>}
            {items.map((n) => (
              <SwipeNoteRow
                key={n.id || n._id}
                note={n}
                onOpen={() => openItem(n)}
                onDelete={() => deleteItem(n)}
                onDecide={async (action) => {
                  const id = n.ref_id;
                  if (!id || n.ref_type !== "pos_approval") return;
                  try {
                    await axios.post(`${API_URL}/pos/approvals/${id}/${action}`, {});
                    load();
                  } catch { /* ignore */ }
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

function SwipeNoteRow({ note, onOpen, onDelete, onDecide }) {
  const canDelete = notificationCanDelete(note);
  const startX = React.useRef(0);
  const origin = React.useRef(0);
  const [x, setX] = React.useState(0);
  const content = (
    <button
      type="button"
      onClick={canDelete ? undefined : onOpen}
      className={`w-full text-left px-4 py-2.5 flex gap-2 ${note.is_read ? "bg-slate-50 hover:bg-slate-100" : "bg-emerald-50/80 hover:bg-emerald-50 border-l-4 border-emerald-500"}`}
      data-testid={`notification-item-${note.id || note._id}`}
      data-read={note.is_read ? "1" : "0"}
    >
      {note.title?.includes("ONAYLANDI") ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> : <XCircle className={`w-4 h-4 shrink-0 mt-0.5 ${note.is_read ? "text-slate-300" : "text-rose-600"}`} />}
      <span className="min-w-0"><span className={`block text-xs truncate ${note.is_read ? "font-medium text-slate-500" : "font-extrabold text-slate-900"}`}>{note.title}</span>{!note.is_read && <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">Yeni</span>}<span className={`block text-[11px] ${note.is_read ? "text-slate-400" : "text-slate-700"}`}>{localizeNotificationText(note.message)}</span><span className="block text-[10px] text-slate-400 mt-0.5">{new Date(note.created_at).toLocaleString("tr-TR")}</span>
        {note.ref_type === "pos_approval" && !note.is_read && onDecide ? (
          <span className="mt-1 flex gap-1">
            <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onDecide("approve"); }} onKeyDown={(e) => e.key === "Enter" && onDecide("approve")} className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold" data-testid={`pos-notify-approve-${note.ref_id}`}>Onayla</span>
            <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onDecide("reject"); }} onKeyDown={(e) => e.key === "Enter" && onDecide("reject")} className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold" data-testid={`pos-notify-reject-${note.ref_id}`}>Reddet</span>
          </span>
        ) : null}
      </span>
    </button>
  );
  if (!canDelete) return content;
  return (
    <div
      className="relative overflow-hidden"
      data-testid={`notification-swipe-${note.id || note._id}`}
      onPointerDown={(e) => {
        origin.current = e.clientX;
        startX.current = x;
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0) return;
        const dx = e.clientX - origin.current;
        setX(Math.min(0, Math.max(-NOTIFY_SWIPE_W, startX.current + dx)));
      }}
      onPointerUp={(e) => {
        const dx = e.clientX - origin.current;
        const outcome = swipeDeleteOutcome(startX.current, dx);
        if (outcome === "press") onOpen();
        setX(outcome === "open" ? -NOTIFY_SWIPE_W : 0);
      }}
      onPointerCancel={() => setX(startX.current < -NOTIFY_SWIPE_W / 2 ? -NOTIFY_SWIPE_W : 0)}
    >
      <button
        type="button"
        onClick={onDelete}
        className="absolute right-0 top-0 bottom-0 w-[72px] bg-rose-600 text-white text-[11px] font-bold flex flex-col items-center justify-center"
        data-testid={`notification-del-${note.id || note._id}`}
      >
        <Trash2 className="w-4 h-4" />
        Sil
      </button>
      <div style={{ transform: `translateX(${x}px)` }} className="bg-white relative">
        {content}
      </div>
    </div>
  );
}

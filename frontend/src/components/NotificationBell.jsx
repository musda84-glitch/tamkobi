
import React, { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { Bell, CheckCircle2, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../context/AuthContext";

export const NotificationBell = ({ companyId }) => {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const load = useCallback(() => axios.get(`${API_URL}/notifications?company_id=${companyId}`).then((r) => setItems(r.data)).catch(() => {}), [companyId]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false); document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const unread = items.filter((n) => !n.is_read).length;
  const openItem = async (n) => {
    if (!n.is_read) { await axios.post(`${API_URL}/notifications/${n.id}/read`).catch(() => {}); load(); }
    setOpen(false);
    if (n.link) navigate(n.link);
    else if (n.ref_type === "quote") navigate("/quotes");
    if (n.ref_type === "survey") navigate("/surveys");
    if (n.ref_type === "project") navigate("/projects");
    if (n.ref_type === "order") navigate("/orders");
    if (n.ref_type === "quote") navigate("/quotes");
    if (n.ref_type === "survey") navigate("/surveys");
    if (n.ref_type === "project") navigate("/projects");
    if (n.ref_type === "quote") navigate("/projects");
    if (n.ref_type === "order") navigate("/orders");
    else if (n.ref_type === "quote") navigate("/projects");
    if (n.ref_type === "support") navigate("/support");
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative p-2 text-slate-600 hover:bg-slate-100 rounded-lg" title="Bildirimler" data-testid="notification-bell">
        <Bell className="w-5 h-5" />
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-rose-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center" data-testid="notification-count">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden" data-testid="notification-panel">
          <div className="px-4 py-2.5 border-b text-xs font-bold text-slate-700 flex justify-between"><span>Bildirimler</span><span className="text-slate-400">{unread} okunmamış</span></div>
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {items.length === 0 && <div className="p-6 text-center text-xs text-slate-400">Bildirim yok.</div>}
            {items.map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 flex gap-2 ${n.is_read ? "opacity-60" : ""}`} data-testid={`notification-item-${n.id}`}>
                {n.title?.includes("ONAYLANDI") ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />}
                <span className="min-w-0"><span className="block text-xs font-bold text-slate-900 truncate">{n.title}</span><span className="block text-[11px] text-slate-600">{n.message}</span><span className="block text-[10px] text-slate-400 mt-0.5">{new Date(n.created_at).toLocaleString("tr-TR")}</span></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

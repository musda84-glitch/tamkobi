import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Inbox, Loader2, Mail, Paperclip, RefreshCw } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";

const cred = { withCredentials: true };

const fmtWhen = (value) => {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/**
 * Posta Sunucusu gelen kutusu. Küçük ekranda gizlenir; mobil yerleşim aynı kalır.
 */
export const PlatformMailInbox = ({ mailboxes }) => {
  const options = useMemo(
    () => (Array.isArray(mailboxes) ? mailboxes.filter((b) => b && b.id && b.is_active !== false) : []),
    [mailboxes],
  );
  const [boxId, setBoxId] = useState("");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState("");
  const [list, setList] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showImages, setShowImages] = useState(false);

  useEffect(() => {
    if (!options.length) {
      setBoxId("");
      return;
    }
    setBoxId((cur) => (options.some((b) => b.id === cur) ? cur : options[0].id));
  }, [options]);

  useEffect(() => {
    if (!boxId) {
      setList(null);
      return undefined;
    }
    let cancel = false;
    setLoading(true);
    axios.get(`${API_URL}/system/mail/mailboxes/${boxId}/messages`, { ...cred, params: { page } })
      .then((r) => { if (!cancel) setList(r.data || { messages: [], total: 0, page, page_size: 50 }); })
      .catch((err) => {
        if (cancel) return;
        toast.error(err.response?.data?.detail || "Gelen kutusu alınamadı.");
        setList({ messages: [], total: 0, page, page_size: 50 });
      })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [boxId, page, reloadTick]);

  const messages = list?.messages || [];
  const pageSize = list?.page_size || 50;
  const total = list?.total || 0;
  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;

  const chooseBox = (id) => {
    setBoxId(id);
    setPage(1);
    setSelected(null);
    setShowImages(false);
  };

  const openMessage = async (uid, images) => {
    if (!boxId || !uid) return;
    setOpening(String(uid));
    try {
      const r = await axios.get(`${API_URL}/system/mail/mailboxes/${boxId}/messages/${uid}`, {
        ...cred,
        params: images ? { images: 1 } : undefined,
      });
      setSelected(r.data);
      setShowImages(!!images);
    } catch (err) {
      toast.error(err.response?.data?.detail || "İleti açılamadı.");
    } finally {
      setOpening("");
    }
  };

  const toggleSeen = async () => {
    if (!selected || !boxId) return;
    const next = !selected.seen;
    try {
      const r = await axios.post(
        `${API_URL}/system/mail/mailboxes/${boxId}/messages/${selected.uid}/seen`,
        { seen: next },
        cred,
      );
      const seen = !!r.data?.seen;
      setSelected((cur) => (cur ? { ...cur, seen } : cur));
      setList((cur) => (cur ? {
        ...cur,
        messages: (cur.messages || []).map((m) => (String(m.uid) === String(selected.uid) ? { ...m, seen } : m)),
      } : cur));
    } catch (err) {
      toast.error(err.response?.data?.detail || "Okundu durumu güncellenemedi.");
    }
  };

  return (
    <section className="max-md:hidden bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="platform-mail-inbox">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <Inbox className="w-4 h-4 text-sky-600" /> Gelen Kutusu
        </h3>
        <select
          value={boxId}
          onChange={(e) => chooseBox(e.target.value)}
          className={`${inputCls} max-w-xs`}
          data-testid="mail-inbox-mailbox"
          disabled={!options.length}
        >
          {!options.length && <option value="">Tanımlı kutu yok</option>}
          {options.map((b) => (
            <option key={b.id} value={b.id}>{b.display_name || b.email} — {b.email}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setReloadTick((n) => n + 1)}
          disabled={!boxId || loading}
          className="ml-auto px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg font-semibold inline-flex items-center gap-1 disabled:opacity-60"
          data-testid="mail-inbox-refresh"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Yenile
        </button>
      </div>
      <div className="grid md:grid-cols-5 min-h-[480px]">
        <div className="md:col-span-2 border-r border-slate-100 flex flex-col min-h-[320px]" data-testid="mail-inbox-list">
          <div className="flex-1 overflow-y-auto max-h-[560px]">
            {!boxId && <div className="p-6 text-slate-400">Okunacak kutu yok.</div>}
            {boxId && loading && !messages.length && <div className="p-6 text-slate-400">Yükleniyor…</div>}
            {boxId && !loading && !messages.length && <div className="p-6 text-slate-400" data-testid="mail-inbox-empty">Bu sayfada ileti yok.</div>}
            {messages.map((m) => {
              const uid = String(m.uid);
              const active = selected && String(selected.uid) === uid;
              return (
                <button
                  key={uid}
                  type="button"
                  onClick={() => openMessage(uid, false)}
                  className={`w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 ${active ? "bg-sky-50" : ""} ${m.seen ? "font-medium text-slate-600" : "font-bold text-slate-900"}`}
                  data-testid={`mail-inbox-row-${uid}`}
                  data-seen={m.seen ? "1" : "0"}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{m.from || "(Gönderen yok)"}</span>
                    <span className={`text-[10px] whitespace-nowrap ${m.seen ? "font-medium text-slate-400" : "font-bold text-slate-500"}`}>{fmtWhen(m.date)}</span>
                  </div>
                  <div className="truncate flex items-center gap-1">
                    {m.has_attachments && <Paperclip className="w-3 h-3 shrink-0 text-slate-400" aria-hidden="true" />}
                    <span className="truncate">{m.subject || "(Konu yok)"}</span>
                  </div>
                </button>
              );
            })}
          </div>
          {total > pageSize && (
            <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <button type="button" disabled={!hasPrev} onClick={() => { setPage((p) => Math.max(1, p - 1)); setSelected(null); }} className="font-semibold disabled:opacity-40" data-testid="mail-inbox-prev">Önceki</button>
              <span data-testid="mail-inbox-page">{page}</span>
              <button type="button" disabled={!hasNext} onClick={() => { setPage((p) => p + 1); setSelected(null); }} className="font-semibold disabled:opacity-40" data-testid="mail-inbox-next">Sonraki</button>
            </div>
          )}
        </div>
        <div className="md:col-span-3 p-4 min-h-[320px]" data-testid="mail-inbox-reader">
          {!selected && (
            <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-slate-300 gap-2">
              <Mail className="w-8 h-8" />
              <span className="text-xs">Okumak için bir ileti seçin</span>
            </div>
          )}
          {selected && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-slate-900" data-testid="mail-inbox-subject">{selected.subject || "(Konu yok)"}</h4>
                  <div className="text-xs text-slate-600 mt-1 truncate">{selected.from}</div>
                  <div className="text-[11px] text-slate-400">{fmtWhen(selected.date)}</div>
                </div>
                <button
                  type="button"
                  onClick={toggleSeen}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg font-semibold text-slate-700"
                  data-testid="mail-inbox-toggle-seen"
                >
                  {selected.seen ? "Okunmadı işaretle" : "Okundu işaretle"}
                </button>
              </div>
              {selected.images_blocked && !showImages && (
                <button
                  type="button"
                  onClick={() => openMessage(selected.uid, true)}
                  className="px-3 py-1.5 border border-amber-300 bg-amber-50 text-amber-900 rounded-lg font-semibold"
                  data-testid="mail-inbox-show-images"
                >
                  Resimleri göster
                </button>
              )}
              {opening === String(selected.uid) && <div className="text-xs text-slate-400">Yükleniyor…</div>}
              {selected.html ? (
                <iframe
                  title="İleti"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  srcDoc={selected.html}
                  className="w-full min-h-[360px] border border-slate-100 rounded-lg bg-white"
                  data-testid="mail-inbox-html"
                />
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 leading-relaxed" data-testid="mail-inbox-text">{selected.text || ""}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

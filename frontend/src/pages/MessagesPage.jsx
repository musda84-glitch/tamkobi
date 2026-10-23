import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Loader2, MessageSquare, Plus, Search, Send } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import {
  chatAvatarColor,
  chatClockLabel,
  chatInitials,
  chatTimeLabel,
  chatListPreview,
  clipChatPreview,
  filterChatList,
  isOwnMessage,
  messageTickKind,
  orderedPeerGroups,
  parsePeerValue,
  peerPostBody,
  peerQuery,
  peerSelectGroups,
  threadDayItems,
  validateMessageBody,
} from "../utils/staffMessages";

const FORBIDDEN = "Mesajları görmek için personel kartı veya yönetici yetkisi gerekir.";

function Avatar({ name, tint, size = "w-10 h-10" }) {
  return (
    <div className={`${size} rounded-full text-white flex items-center justify-center shrink-0 text-[12px] font-extrabold`} style={{ backgroundColor: tint }}>
      {chatInitials(name)}
    </div>
  );
}

function Tick({ kind }) {
  if (kind === "none") return null;
  return (
    <span className={`text-[11px] leading-none font-bold ${kind === "read" ? "text-[#53BDEB]" : "text-slate-400"}`} aria-label={kind === "read" ? "Okundu" : "İletildi"}>
      ✓✓
    </span>
  );
}

export default function MessagesPage() {
  const [params] = useSearchParams();
  const [inbox, setInbox] = useState(null);
  const [forbidden, setForbidden] = useState("");
  const [thread, setThread] = useState(null);
  const [channel, setChannel] = useState(null);
  const [mobileChat, setMobileChat] = useState(false);
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pickQuery, setPickQuery] = useState("");

  const loadInbox = useCallback((cursor = "") => {
    const req = { limit: 40 };
    if (cursor) req.cursor = cursor;
    if (query.trim()) req.q = query.trim();
    if (unreadOnly) req.unread = 1;
    return axios.get(`${API_URL}/personnel/messages/panel`, { params: req, withCredentials: true })
      .then((r) => {
        setForbidden("");
        setInbox((prev) => {
          if (!cursor) return r.data;
          const prevChats = prev?.chats || [];
          const more = r.data?.chats || [];
          const seen = new Set(prevChats.map((c) => c.key));
          return { ...r.data, chats: [...prevChats, ...more.filter((c) => !seen.has(c.key))] };
        });
      })
      .catch((err) => {
        if (err.response?.status === 403) {
          setForbidden(err.response?.data?.detail || FORBIDDEN);
          setInbox(null);
          return;
        }
        setInbox((prev) => prev || { chats: [], unread_total: 0, managers: [], directory: [] });
      });
  }, [query, unreadOnly]);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  useEffect(() => {
    if (params.get("yeni") === "1") setPicker(true);
    const key = params.get("c");
    if (!key) return;
    const peer = parsePeerValue(key);
    if (peer) {
      setChannel(peer);
      setMobileChat(true);
      setPicker(false);
    }
  }, [params]);

  const openThread = useCallback((peer) => {
    if (!peer?.id) return;
    axios.get(`${API_URL}/personnel/messages`, { params: peerQuery(peer), withCredentials: true })
      .then((r) => setThread(r.data))
      .catch((err) => {
        if (err.response?.status === 403) setForbidden(err.response?.data?.detail || FORBIDDEN);
        else toast.error(err.response?.data?.detail || "Sohbet açılamadı.");
      });
    axios.post(`${API_URL}/personnel/messages/read`, peerPostBody(peer), { withCredentials: true })
      .then(() => loadInbox())
      .catch(() => {});
  }, [loadInbox]);

  useEffect(() => {
    if (!channel?.id) {
      setThread(null);
      return;
    }
    openThread(channel);
  }, [channel, openThread]);

  const selfId = inbox?.self_user_id || thread?.self_user_id || "";
  const chats = useMemo(() => {
    const rows = filterChatList(inbox?.chats || [], query);
    if (!unreadOnly) return rows;
    return rows.filter((row) => Number(row.unread) > 0);
  }, [inbox?.chats, query, unreadOnly]);
  const pickGroups = useMemo(
    () => orderedPeerGroups(peerSelectGroups(inbox?.directory, inbox?.managers, selfId, [])),
    [inbox?.directory, inbox?.managers, selfId],
  );
  const active = (inbox?.chats || []).find((row) => row.kind === channel?.kind && String(row.id) === String(channel?.id));
  const title = active?.name || thread?.to_user?.name || thread?.employee?.full_name || thread?.group?.title || "Sohbet";
  const items = threadDayItems(thread?.thread || []);
  const badge = Number(inbox?.unread_total) || 0;

  const send = async () => {
    const invalid = validateMessageBody(draft);
    if (invalid) { toast.error(invalid); return; }
    if (!channel?.id) return;
    setBusy(true);
    try {
      await axios.post(`${API_URL}/personnel/messages`, peerPostBody(channel, { body: draft }), { withCredentials: true });
      setDraft("");
      toast.success("Mesaj gönderildi.");
      const r = await axios.get(`${API_URL}/personnel/messages`, { params: peerQuery(channel), withCredentials: true });
      setThread(r.data);
      loadInbox();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Mesaj gönderilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const onDraftKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const choose = (value) => {
    const peer = parsePeerValue(value);
    if (!peer) return;
    setChannel(peer);
    setPicker(false);
    setMobileChat(true);
    setPickQuery("");
  };

  if (forbidden) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm" data-testid="messages-denied">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-violet-600 text-white flex items-center justify-center">
            <MessageSquare className="w-4 h-4" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">Mesajlar</h1>
        </div>
        <p className="mt-3 text-sm text-slate-600" data-testid="messages-forbidden">{forbidden}</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] min-h-[32rem] bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="messages-page">
      <aside className={`${mobileChat ? "hidden md:flex" : "flex"} w-full md:w-[340px] md:shrink-0 flex-col border-r border-slate-200 relative`}>
        <div className="px-4 pt-4 pb-2 flex items-center gap-2">
          <h1 className="text-lg font-bold text-slate-900 flex-1">Mesajlar</h1>
          {badge > 0 ? (
            <span className="min-w-[22px] text-center text-[11px] font-extrabold px-1.5 py-0.5 rounded-full bg-emerald-600 text-white" data-testid="messages-unread">{badge}</span>
          ) : null}
          <button
            type="button"
            onClick={() => setPicker(true)}
            className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-xl bg-violet-600 text-white"
            data-testid="messages-new"
          >
            <Plus className="w-3.5 h-3.5" /> Yeni mesaj
          </button>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sohbetlerde ara"
              className="w-full bg-slate-100 border border-transparent rounded-full pl-8 pr-3 py-2 text-xs"
              data-testid="messages-search"
            />
          </div>
          <div className="flex gap-1.5 mt-2">
            <button type="button" onClick={() => setUnreadOnly(false)} className={`text-[11px] font-bold px-3 py-1 rounded-full ${unreadOnly ? "bg-white border border-slate-200 text-slate-600" : "bg-slate-900 text-white"}`} data-testid="messages-filter-all">Tümü</button>
            <button type="button" onClick={() => setUnreadOnly(true)} className={`text-[11px] font-bold px-3 py-1 rounded-full ${unreadOnly ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`} data-testid="messages-filter-unread">Okunmamış</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2" data-testid="messages-list">
          {!inbox ? (
            <div className="text-xs text-slate-400 flex items-center gap-2 p-3"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Yükleniyor…</div>
          ) : !chats.length ? (
            <p className="text-xs text-slate-400 text-center py-8 px-3">Yeni mesaj yok · Ekibinizle panel içinden yazışın.</p>
          ) : chats.map((row) => {
            const selected = channel?.kind === row.kind && String(channel?.id) === String(row.id);
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => { setChannel({ kind: row.kind, id: row.id }); setMobileChat(true); setPicker(false); }}
                className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-left ${selected ? "bg-slate-100" : "hover:bg-slate-50"}`}
                data-testid={`messages-row-${row.id}`}
              >
                <Avatar name={row.name} tint={chatAvatarColor(row.key)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[13px] truncate flex-1 ${row.unread ? "font-extrabold text-slate-900" : "font-semibold text-slate-800"}`}>{row.name}</span>
                    {row.at ? <span className="text-[10px] font-bold text-slate-400 shrink-0">{chatTimeLabel(row.at)}</span> : null}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[12px] text-slate-500 truncate flex-1">{clipChatPreview(chatListPreview(row, selfId), 72)}</span>
                    {row.unread > 0 ? <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" /> : null}
                  </div>
                </div>
              </button>
            );
          })}
          {inbox?.next_cursor ? (
            <button type="button" onClick={() => loadInbox(inbox.next_cursor)} className="w-full text-xs font-bold text-violet-700 py-2" data-testid="messages-more">Daha fazla</button>
          ) : null}
        </div>
        {picker ? (
          <div className="absolute inset-0 bg-white z-10 flex flex-col" data-testid="messages-picker">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-slate-100">
              <button type="button" onClick={() => setPicker(false)} className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center" data-testid="messages-picker-close" aria-label="Kapat">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="text-sm font-bold text-slate-900">Yeni mesaj</div>
            </div>
            <div className="px-3 py-2">
              <input
                value={pickQuery}
                onChange={(e) => setPickQuery(e.target.value)}
                placeholder="Kişi ara"
                className="w-full bg-slate-100 rounded-full px-3 py-2 text-xs"
                data-testid="messages-picker-search"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3">
              {pickGroups.map((group) => {
                const q = pickQuery.trim().toLocaleLowerCase("tr-TR");
                const options = group.options.filter((o) => !q || String(o.label || "").toLocaleLowerCase("tr-TR").includes(q));
                if (!options.length) return null;
                return (
                  <div key={group.label} className="mb-2">
                    <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{group.label}</div>
                    {options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => choose(o.value)}
                        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-slate-50 text-left"
                        data-testid={`messages-pick-${o.value}`}
                      >
                        <Avatar name={o.label} tint={chatAvatarColor(o.value)} size="w-9 h-9" />
                        <span className="text-sm font-semibold text-slate-800 truncate">{o.label}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
              {!pickGroups.length ? <p className="text-xs text-slate-400 text-center py-6">Yazışılacak kişi yok.</p> : null}
            </div>
          </div>
        ) : null}
      </aside>
      <section className={`${mobileChat ? "flex" : "hidden md:flex"} flex-1 min-w-0 flex-col bg-slate-100`}>
        {channel ? (
          <>
            <div className="h-14 px-3 bg-white border-b border-slate-200 flex items-center gap-2.5 shrink-0">
              <button type="button" onClick={() => setMobileChat(false)} className="md:hidden w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center" data-testid="messages-back" aria-label="Sohbetlere dön">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <Avatar name={title} tint={chatAvatarColor(channel.kind + channel.id)} size="w-9 h-9" />
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate" data-testid="messages-title">{title}</div>
                <div className="text-[11px] text-slate-500">Sohbet</div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5" data-testid="messages-thread">
              {items.length === 0 ? (
                <div className="text-xs text-slate-400 text-center py-8">Henüz mesaj yok. Aşağıdan yazın.</div>
              ) : items.map((item) => item.type === "day" ? (
                <div key={item.key} className="flex justify-center my-2">
                  <span data-testid="messages-day" className="text-[10px] font-extrabold text-slate-500 bg-slate-200 rounded-full px-2.5 py-0.5">{item.label}</span>
                </div>
              ) : (
                <div key={item.key} className={`flex ${isOwnMessage(item.message, selfId, thread?.mode) ? "justify-end" : "justify-start"}`} data-testid={`messages-bubble-${item.message.id}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 shadow-sm ${isOwnMessage(item.message, selfId, thread?.mode) ? "bg-emerald-100 rounded-br-md" : "bg-white border border-slate-100 rounded-bl-md"}`}>
                    <div className="text-sm text-slate-800 whitespace-pre-wrap">{item.message.body}</div>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      {chatClockLabel(item.message.created_at) ? <span className="text-[10px] text-slate-400 font-semibold">{chatClockLabel(item.message.created_at)}</span> : null}
                      <Tick kind={messageTickKind(item.message, isOwnMessage(item.message, selfId, thread?.mode))} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 bg-white border-t border-slate-200 flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onDraftKey}
                rows={1}
                placeholder="Bir mesaj yazın…"
                className="flex-1 border border-slate-200 rounded-2xl px-3 py-2 text-sm min-h-[44px] resize-none"
                data-testid="messages-draft"
              />
              <button type="button" onClick={send} disabled={busy} className="inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-emerald-600 text-white font-bold text-sm disabled:opacity-50" data-testid="messages-send">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Gönder
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400" data-testid="messages-empty-thread">Bir sohbet seçin</div>
        )}
      </section>
    </div>
  );
}

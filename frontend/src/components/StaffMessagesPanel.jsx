import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Megaphone, MessageSquare, Plus, Search, Send, Users } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import {
  announceAudienceLabel,
  buildChatList,
  chatAvatarColor,
  chatClockLabel,
  chatInitials,
  chatPeer,
  chatTimeLabel,
  filterChatList,
  MESSAGES_COLLAPSED_KEY,
  inboxUnreadTotal,
  isOwnMessage,
  messageTickKind,
  parseHiddenFlag,
  mergeInboxWithDirectory,
  mergeManagerInbox,
  parsePeerValue,
  peerPostBody,
  peerQuery,
  peerSelectGroups,
  threadDayItems,
  validateMessageBody,
} from "../utils/staffMessages";

function Avatar({ name, tint, icon: Icon }) {
  return (
    <div className="w-10 h-10 rounded-full text-white flex items-center justify-center shrink-0 text-[12px] font-extrabold" style={{ backgroundColor: tint }}>
      {Icon ? <Icon className="w-4 h-4" /> : chatInitials(name)}
    </div>
  );
}

function Tick({ kind }) {
  if (kind === "none") return null;
  return (
    <span
      data-testid={kind === "read" ? "msg-tick-read" : "msg-tick-delivered"}
      className={`text-[11px] leading-none font-bold ${kind === "read" ? "text-[#53BDEB]" : "text-slate-400"}`}
      aria-label={kind === "read" ? "Okundu" : "Görüldü"}
    >
      ✓✓
    </span>
  );
}

function DayChip({ label }) {
  return (
    <div className="flex justify-center my-2">
      <span data-testid="msg-day-chip" className="text-[10px] font-extrabold text-slate-500 bg-slate-200 rounded-full px-2.5 py-0.5">{label}</span>
    </div>
  );
}

function Bubble({ m, own, showAuthor }) {
  const tick = messageTickKind(m, own);
  const clock = chatClockLabel(m.created_at);
  return (
    <div className={`flex ${own ? "justify-end" : "justify-start"}`} data-testid={`staff-msg-${m.id}`}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 shadow-sm ${own ? "bg-emerald-100 rounded-br-md" : "bg-white border border-slate-100 rounded-bl-md"}`}>
        {showAuthor && !own ? <div className="text-[10px] font-extrabold text-violet-700">{m.from_name || "Kişi"}</div> : null}
        <div className="text-xs text-slate-800 whitespace-pre-wrap">{m.body}</div>
        {clock || tick !== "none" ? (
          <div className="flex items-center justify-end gap-1 mt-0.5">
            {clock ? <span className="text-[10px] text-slate-400 font-semibold">{clock}</span> : null}
            <Tick kind={tick} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChatRow({ row, onClick, testId }) {
  const Icon = row.kind === "group" ? Users : row.kind === "announce" ? Megaphone : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-1 py-2 text-left hover:bg-slate-50 rounded-xl"
      data-testid={testId}
    >
      <Avatar name={row.name} tint={chatAvatarColor(row.key)} icon={Icon} />
      <div className="min-w-0 flex-1 border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2">
          <span className={`text-[13px] truncate flex-1 ${row.unread ? "font-extrabold text-slate-900" : "font-bold text-slate-800"}`}>{row.name}</span>
          {row.at ? <span className={`text-[10px] font-bold ${row.unread ? "text-emerald-600" : "text-slate-400"}`}>{chatTimeLabel(row.at)}</span> : null}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-[12px] truncate flex-1 ${row.unread ? "font-semibold text-slate-600" : "text-slate-500"}`}>{row.preview}</span>
          {row.unread > 0 ? (
            <span className="min-w-[18px] text-center text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-emerald-600 text-white">{row.unread}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export function StaffMessagesPanel({
  employeeId,
  compact,
  testId = "staff-messages-panel",
}) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(() => {
    try { return parseHiddenFlag(localStorage.getItem(MESSAGES_COLLAPSED_KEY)); } catch { return false; }
  });
  const [composeOpen, setComposeOpen] = useState(false);
  const [channel, setChannel] = useState(employeeId ? { kind: "emp", id: employeeId } : null);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupUsers, setGroupUsers] = useState([]);
  const [groupEmps, setGroupEmps] = useState([]);
  const [showAnnounceForm, setShowAnnounceForm] = useState(false);
  const [announceTitle, setAnnounceTitle] = useState("");
  const [announceBody, setAnnounceBody] = useState("");
  const [announceEmps, setAnnounceEmps] = useState([]);
  const [announceAll, setAnnounceAll] = useState(true);

  const load = useCallback(() => {
    const params = employeeId ? { employee_id: employeeId } : peerQuery(channel);
    axios.get(`${API_URL}/personnel/messages`, { params, withCredentials: true })
      .then((r) => setData(r.data))
      .catch((err) => setData(err.response?.status === 403 ? { mode: "none", thread: [], inbox: [] } : null));
  }, [channel, employeeId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setChannel(employeeId ? { kind: "emp", id: employeeId } : null); }, [employeeId]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (next) {
      setComposeOpen(false);
      if (!employeeId) setChannel(null);
    }
    try { localStorage.setItem(MESSAGES_COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };
  useEffect(() => {
    const peer = employeeId ? { kind: "emp", id: employeeId } : channel;
    if (!peer?.id) return;
    axios.post(`${API_URL}/personnel/messages/read`, peerPostBody(peer), { withCredentials: true }).catch(() => {});
  }, [channel, employeeId]);

  const managers = data?.managers || [];
  const selfId = data?.self_user_id || "";
  const mode = data?.mode || "";
  const locked = !!employeeId;
  const showStaff = mode === "staff" || mode === "both";
  const showInbox = (mode === "manager" || mode === "both") && !locked;
  const managerRows = useMemo(
    () => mergeManagerInbox(data?.manager_inbox, managers, selfId),
    [data?.manager_inbox, managers, selfId],
  );
  const conversations = useMemo(
    () => mergeInboxWithDirectory(data?.inbox, data?.directory),
    [data?.inbox, data?.directory],
  );
  const chats = useMemo(() => buildChatList({
    managers: managerRows,
    employees: conversations,
    groups: data?.group_inbox || data?.groups || [],
    announcements: data?.announcements || [],
    selfId,
    includeEmptyManagers: showStaff && !locked,
    includeEmptyEmployees: false,
  }), [managerRows, conversations, data?.group_inbox, data?.groups, data?.announcements, selfId, showStaff, locked]);
  const visibleChats = useMemo(() => filterChatList(chats, query), [chats, query]);
  const pickGroups = useMemo(
    () => peerSelectGroups(data?.directory, managers, selfId, data?.manager_inbox),
    [data?.directory, managers, selfId, data?.manager_inbox],
  );
  const badge = inboxUnreadTotal(chats);
  const threadRows = threadDayItems(data?.thread || []);
  const showThread = locked || !!channel;
  const threadTitle = channel?.kind === "group"
    ? (data?.group?.title || "Grup")
    : data?.to_user?.name || data?.employee?.full_name || "Yazışma";

  const send = async (e) => {
    e?.preventDefault?.();
    const invalid = validateMessageBody(draft);
    if (invalid) { toast.error(invalid); return; }
    setBusy(true);
    try {
      const peer = employeeId ? { kind: "emp", id: employeeId } : channel;
      await axios.post(`${API_URL}/personnel/messages`, peerPostBody(peer, { body: draft }), { withCredentials: true });
      setDraft("");
      toast.success("Mesaj gönderildi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Mesaj gönderilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async (e) => {
    e?.preventDefault?.();
    if (!groupUsers.length && !groupEmps.length) {
      toast.error("Gruba en az bir kişi daha ekleyin.");
      return;
    }
    setBusy(true);
    try {
      const res = await axios.post(`${API_URL}/personnel/messages/groups`, {
        title: groupTitle,
        member_user_ids: groupUsers,
        member_employee_ids: groupEmps,
      }, { withCredentials: true });
      setShowGroupForm(false);
      setComposeOpen(false);
      setGroupTitle("");
      setGroupUsers([]);
      setGroupEmps([]);
      toast.success("Grup oluşturuldu.");
      if (res.data?.group?.id) setChannel({ kind: "group", id: res.data.group.id });
      else load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Grup oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  };

  const createAnnounce = async (e) => {
    e?.preventDefault?.();
    const invalid = validateMessageBody(announceBody);
    if (invalid) { toast.error(invalid); return; }
    if (!announceAll && !announceEmps.length) {
      toast.error("Duyuru için personel seçin.");
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API_URL}/personnel/messages/announce`, {
        title: announceTitle,
        body: announceBody,
        employee_ids: announceAll ? [] : announceEmps,
      }, { withCredentials: true });
      setShowAnnounceForm(false);
      setComposeOpen(false);
      setAnnounceTitle("");
      setAnnounceBody("");
      setAnnounceEmps([]);
      setAnnounceAll(true);
      toast.success("Duyuru gönderildi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Duyuru gönderilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const openAnnouncement = async (row) => {
    if (row?.id) {
      await axios.post(`${API_URL}/personnel/messages/announce/read`, { id: row.id }, { withCredentials: true }).catch(() => {});
      load();
    }
    toast.message(row.title || "Duyuru", { description: row.body });
  };

  const openChat = (row) => {
    if (row.kind === "announce") {
      const found = (data?.announcements || []).find((a) => a.id === row.id);
      if (found) openAnnouncement(found);
      return;
    }
    const peer = chatPeer(row);
    if (peer) {
      setChannel(peer);
      setComposeOpen(false);
    }
  };

  const toggle = (list, id, set) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  if (data?.mode === "none") return null;

  if (!data) {
    return (
      <div className="bg-white border border-violet-200 rounded-[20px] p-2.5 text-xs text-slate-400 flex items-center gap-2" data-testid={testId}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Mesajlar yükleniyor…
      </div>
    );
  }

  return (
    <div className="bg-white border border-violet-200 rounded-[20px] p-2.5 space-y-2 shadow-sm" data-testid={testId}>
      <div className="flex items-center gap-2">
        {showThread && !locked ? (
          <button
            type="button"
            onClick={() => setChannel(null)}
            className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center"
            data-testid={`${testId}-back`}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        ) : (
          <div className="w-8 h-8 rounded-xl bg-violet-600 text-white flex items-center justify-center">
            <MessageSquare className="w-4 h-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-900">{showThread ? threadTitle : "Mesajlar"}</div>
          <div className="text-[11px] text-slate-500">
            {showThread
              ? (channel?.kind === "group" ? "Grup yazışması" : "Sohbet")
              : badge ? `${badge} okunmamış` : "Yazışmalar"}
          </div>
        </div>
        {badge > 0 && !showThread ? (
          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-600 text-white" data-testid={`${testId}-unread`}>{badge}</span>
        ) : null}
        {!locked && !showThread && !collapsed ? (
          <button
            type="button"
            onClick={() => setComposeOpen((v) => !v)}
            className="w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center"
            data-testid={`${testId}-compose`}
          >
            <Plus className="w-4 h-4" />
          </button>
        ) : null}
        {!locked ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            className="w-8 h-8 rounded-xl border border-violet-200 bg-white text-violet-700 flex items-center justify-center"
            data-testid={`${testId}-toggle`}
            aria-label={collapsed ? "Mesajları aç" : "Mesajları küçült"}
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        ) : null}
      </div>

      {!collapsed && (showThread ? (
        <>
          <div className={`${compact ? "max-h-72" : "max-h-[28rem]"} overflow-y-auto space-y-1.5 bg-slate-100 rounded-2xl p-2.5`} data-testid={`${testId}-thread`}>
            {threadRows.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-6">Henüz mesaj yok. Aşağıdan yazın.</div>
            ) : threadRows.map((item) => item.type === "day" ? (
              <DayChip key={item.key} label={item.label} />
            ) : (
              <Bubble key={item.key} m={item.message} own={isOwnMessage(item.message, selfId, mode)} showAuthor={channel?.kind === "group"} />
            ))}
          </div>
          <form onSubmit={send} className="flex gap-2 items-end">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={1}
              placeholder={channel?.kind === "group" ? "Gruba yazın…" : "Mesaj yazın…"}
              className="flex-1 border rounded-2xl px-3 py-2 text-sm min-h-[40px]"
              data-testid={`${testId}-draft`}
            />
            <button type="submit" disabled={busy} className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center disabled:opacity-50" data-testid={`${testId}-send`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </>
      ) : (
        <>
          {composeOpen ? (
            <div className="flex flex-wrap gap-1.5">
              {pickGroups.length ? (
                <select
                  className="flex-1 min-w-[160px] border rounded-xl p-2 text-xs font-semibold"
                  value=""
                  onChange={(e) => {
                    const peer = parsePeerValue(e.target.value);
                    if (peer) {
                      setChannel(peer);
                      setComposeOpen(false);
                    }
                  }}
                  data-testid={`${testId}-pick`}
                >
                  <option value="">Yeni yazışma</option>
                  {pickGroups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                onClick={() => { setShowGroupForm((v) => !v); setShowAnnounceForm(false); }}
                className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-violet-200 text-violet-700 bg-violet-50"
                data-testid={`${testId}-group-new`}
              >
                <Users className="w-3.5 h-3.5" /> Grup
              </button>
              {showInbox ? (
                <button
                  type="button"
                  onClick={() => { setShowAnnounceForm((v) => !v); setShowGroupForm(false); }}
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-violet-200 text-violet-700 bg-violet-50"
                  data-testid={`${testId}-announce-new`}
                >
                  <Megaphone className="w-3.5 h-3.5" /> Duyuru
                </button>
              ) : null}
            </div>
          ) : null}

          {showGroupForm ? (
            <form onSubmit={createGroup} className="rounded-xl border border-violet-100 p-2 space-y-2" data-testid={`${testId}-group-form`}>
              <input
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="Grup adı"
                className="w-full border rounded-xl p-2 text-xs font-semibold"
                data-testid={`${testId}-group-title`}
              />
              {managers.filter((m) => m.id && m.id !== selfId).length ? (
                <div className="flex flex-wrap gap-1.5">
                  {managers.filter((m) => m.id && m.id !== selfId).map((m) => (
                    <label key={m.id} className={`text-[11px] font-bold px-2 py-1 rounded-full border cursor-pointer ${groupUsers.includes(m.id) ? "bg-violet-50 border-violet-400 text-violet-700" : "border-slate-200 text-slate-600"}`}>
                      <input type="checkbox" className="sr-only" checked={groupUsers.includes(m.id)} onChange={() => toggle(groupUsers, m.id, setGroupUsers)} />
                      {m.name || "Yönetici"}
                    </label>
                  ))}
                </div>
              ) : null}
              {(data.directory || []).length ? (
                <div className="flex flex-wrap gap-1.5">
                  {(data.directory || []).map((emp) => (
                    <label key={emp.id} className={`text-[11px] font-bold px-2 py-1 rounded-full border cursor-pointer ${groupEmps.includes(emp.id) ? "bg-violet-50 border-violet-400 text-violet-700" : "border-slate-200 text-slate-600"}`}>
                      <input type="checkbox" className="sr-only" checked={groupEmps.includes(emp.id)} onChange={() => toggle(groupEmps, emp.id, setGroupEmps)} />
                      {emp.full_name || "Personel"}
                    </label>
                  ))}
                </div>
              ) : null}
              <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-xl bg-violet-600 text-white font-bold text-xs disabled:opacity-50" data-testid={`${testId}-group-create`}>
                Grup oluştur
              </button>
            </form>
          ) : null}

          {showAnnounceForm ? (
            <form onSubmit={createAnnounce} className="rounded-xl border border-violet-100 p-2 space-y-2" data-testid={`${testId}-announce-form`}>
              <input
                value={announceTitle}
                onChange={(e) => setAnnounceTitle(e.target.value)}
                placeholder="Başlık"
                className="w-full border rounded-xl p-2 text-xs font-semibold"
                data-testid={`${testId}-announce-title`}
              />
              <textarea
                value={announceBody}
                onChange={(e) => setAnnounceBody(e.target.value)}
                placeholder="Duyuru metni"
                rows={3}
                className="w-full border rounded-xl p-2 text-xs"
                data-testid={`${testId}-announce-body`}
              />
              <label className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full border cursor-pointer ${announceAll ? "bg-violet-50 border-violet-400 text-violet-700" : "border-slate-200 text-slate-600"}`}>
                <input type="checkbox" className="sr-only" checked={announceAll} onChange={() => setAnnounceAll((v) => !v)} />
                Tüm personel
              </label>
              {!announceAll && (data.directory || []).length ? (
                <div className="flex flex-wrap gap-1.5">
                  {(data.directory || []).map((emp) => (
                    <label key={emp.id} className={`text-[11px] font-bold px-2 py-1 rounded-full border cursor-pointer ${announceEmps.includes(emp.id) ? "bg-violet-50 border-violet-400 text-violet-700" : "border-slate-200 text-slate-600"}`}>
                      <input type="checkbox" className="sr-only" checked={announceEmps.includes(emp.id)} onChange={() => toggle(announceEmps, emp.id, setAnnounceEmps)} />
                      {emp.full_name || "Personel"}
                    </label>
                  ))}
                </div>
              ) : null}
              <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-xl bg-violet-600 text-white font-bold text-xs disabled:opacity-50" data-testid={`${testId}-announce-send`}>
                Duyuru gönder
              </button>
            </form>
          ) : null}

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ara"
              className="w-full border border-slate-200 rounded-xl pl-8 pr-2 py-2 text-xs bg-slate-50"
              data-testid={`${testId}-search`}
            />
          </div>

          <div className={`${compact ? "max-h-80" : "max-h-[32rem]"} overflow-y-auto`} data-testid={`${testId}-inbox`}>
            {!visibleChats.length ? (
              <div className="text-xs text-slate-400 text-center py-6">
                {query ? "Sonuç yok." : showStaff ? "Yöneticinize yazmak için + ile başlayın." : "Henüz yazışma yok. + ile başlatın."}
              </div>
            ) : visibleChats.map((row) => (
              <ChatRow
                key={row.key}
                row={row}
                testId={
                  row.kind === "manager" ? `${testId}-inbox-mgr-${row.id}`
                    : row.kind === "group" ? `${testId}-inbox-group-${row.id}`
                      : row.kind === "announce" ? `${testId}-announce-${row.id}`
                        : `${testId}-inbox-${row.id}`
                }
                onClick={() => openChat(row)}
              />
            ))}
          </div>
        </>
      ))}
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Loader2, Megaphone, MessageSquare, Send, Users } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import {
  MESSAGES_HIDDEN_KEY,
  mergeInboxWithDirectory,
  mergeManagerInbox,
  messageAuthor,
  messagePreview,
  parseHiddenFlag,
  parsePeerValue,
  peerPostBody,
  peerQuery,
  previewStaffMessages,
  requireManagerId,
  announceAudienceLabel,
  validateMessageBody,
} from "../utils/staffMessages";

function Bubble({ m }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${m.from_side === "manager" ? "bg-violet-50 border border-violet-100" : "bg-slate-50 border border-slate-100"}`} data-testid={`staff-msg-${m.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-slate-800">{messageAuthor(m)}</span>
        {m.created_at ? <span className="text-[10px] text-slate-400">{new Date(m.created_at).toLocaleString("tr-TR")}</span> : null}
      </div>
      <div className="text-xs text-slate-700 whitespace-pre-wrap mt-0.5">{m.body}</div>
    </div>
  );
}

function InboxButton({ title, last, unread, onClick, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-slate-100 px-3 py-2 hover:bg-slate-50"
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-slate-800 truncate">{title}</span>
        {unread > 0 ? <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-600 text-white">{unread}</span> : null}
      </div>
      <div className="text-[11px] text-slate-500 truncate">{last ? messagePreview(last) : "Yeni yazışma"}</div>
    </button>
  );
}

export function StaffMessagesPanel({
  employeeId,
  compact,
  testId = "staff-messages-panel",
  collapsible = true,
}) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState(employeeId ? { kind: "emp", id: employeeId } : null);
  const [selectedManager, setSelectedManager] = useState("");
  const [hidden, setHidden] = useState(() => {
    try { return parseHiddenFlag(localStorage.getItem(MESSAGES_HIDDEN_KEY)); } catch { return false; }
  });
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

  const toggleHidden = () => {
    const next = !hidden;
    setHidden(next);
    try { localStorage.setItem(MESSAGES_HIDDEN_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };

  const managers = data?.managers || [];
  const selfId = data?.self_user_id || "";
  const managerRows = useMemo(
    () => mergeManagerInbox(data?.manager_inbox, managers, selfId),
    [data?.manager_inbox, managers, selfId],
  );

  useEffect(() => {
    if (selectedManager || employeeId) return;
    const real = managerRows.filter((r) => r.user_id && r.user_id !== "_all");
    if (real.length === 1) setSelectedManager(real[0].user_id);
  }, [managerRows, selectedManager, employeeId]);

  const send = async (e) => {
    e?.preventDefault?.();
    const staffNeedsManager = !employeeId && !channel && (data?.mode === "staff" || data?.mode === "both");
    const invalid = validateMessageBody(draft)
      || (staffNeedsManager ? requireManagerId(selectedManager, managers.filter((m) => m.id !== selfId)) : null);
    if (invalid) { toast.error(invalid); return; }
    setBusy(true);
    try {
      const peer = employeeId
        ? { kind: "emp", id: employeeId }
        : (channel || (selectedManager ? { kind: "manager", id: selectedManager } : null));
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

  const markRead = async () => {
    const peer = employeeId
      ? { kind: "emp", id: employeeId }
      : (channel || (selectedManager ? { kind: "manager", id: selectedManager } : null));
    await axios.post(`${API_URL}/personnel/messages/read`, peerPostBody(peer), { withCredentials: true }).catch(() => {});
    load();
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
      setGroupTitle("");
      setGroupUsers([]);
      setGroupEmps([]);
      toast.success("Grup oluşturuldu.");
      if (res.data?.group?.id) {
        setChannel({ kind: "group", id: res.data.group.id });
      } else {
        load();
      }
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

  const toggle = (list, id, set) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  if (data?.mode === "none") return null;

  const mode = data?.mode || "";
  const locked = !!employeeId;
  const showInbox = (mode === "manager" || mode === "both") && !locked && !channel;
  const showStaffPick = (mode === "staff" || mode === "both") && !locked && !channel;
  const showThread = mode === "staff" || mode === "both" || mode === "thread" || mode === "group" || locked || !!channel;
  const unread = Number(data?.unread || 0);
  const conversations = useMemo(
    () => mergeInboxWithDirectory(data?.inbox, data?.directory),
    [data?.inbox, data?.directory],
  );
  const groups = data?.group_inbox || data?.groups || [];
  const threadRows = (() => {
    const rows = data?.thread || [];
    if (channel || locked) return rows;
    const realManagers = managers.filter((m) => m.id && m.id !== selfId && m.id !== "_all");
    if (!selectedManager) return realManagers.length ? [] : rows.filter((m) => !m.group_id);
    if (selectedManager === "_all") return rows.filter((m) => !m.group_id && !m.to_user_id);
    return rows.filter((m) => !m.group_id && (
      m.to_user_id === selectedManager || m.from_user_id === selectedManager
    ));
  })();
  const preview = compact ? previewStaffMessages(threadRows) : threadRows;
  const selectedName = managerRows.find((r) => r.user_id === selectedManager)?.name
    || managers.find((m) => m.id === selectedManager)?.name
    || "";

  if (!data) {
    return (
      <div className="bg-white border border-violet-100 rounded-2xl p-4 text-xs text-slate-400 flex items-center gap-2" data-testid={testId}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Mesajlar yükleniyor…
      </div>
    );
  }

  return (
    <div className="bg-white border border-violet-200 rounded-2xl p-4 space-y-3" data-testid={testId}>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-violet-600 text-white flex items-center justify-center">
          <MessageSquare className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-900">Mesajlar</div>
          <div className="text-[11px] text-slate-500">
            {channel?.kind === "group"
              ? (data.group?.title || "Grup yazışması")
              : data.employee?.full_name && (locked || mode === "staff")
                ? `${data.employee.full_name} ile yazışma`
                : selectedName
                  ? `${selectedName} ile yazışma`
                  : "Tüm yazışmalar burada"}
          </div>
        </div>
        {channel && !locked ? (
          <button type="button" onClick={() => setChannel(null)} className="text-[11px] font-bold text-violet-700" data-testid={`${testId}-back`}>Geri</button>
        ) : null}
        {unread > 0 ? (
          <button type="button" onClick={markRead} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-600 text-white" data-testid={`${testId}-unread`}>
            {unread} yeni
          </button>
        ) : null}
        {collapsible && !locked ? (
          <button
            type="button"
            onClick={toggleHidden}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-violet-200 text-violet-700 bg-violet-50"
            data-testid={`${testId}-toggle`}
          >
            {hidden ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            {hidden ? "Göster" : "Gizle"}
          </button>
        ) : null}
      </div>

      {hidden && collapsible && !locked ? (
        <div className="text-xs text-slate-400">Yazışmalar gizli. Göster ile açın.</div>
      ) : (
        <>
          {showStaffPick ? (
            <div className="space-y-1.5" data-testid={`${testId}-managers`}>
              {managerRows.length ? (
                <select
                  className="w-full border rounded-xl p-2 text-xs font-semibold"
                  value={selectedManager}
                  onChange={(e) => setSelectedManager(e.target.value)}
                  data-testid={`${testId}-manager-pick`}
                >
                  <option value="">Yönetici seçin</option>
                  {managerRows.map((row) => (
                    <option key={row.user_id} value={row.user_id}>{row.name || "Yönetici"}</option>
                  ))}
                </select>
              ) : (
                <div className="text-xs text-slate-400">Kayıtlı yönetici yok.</div>
              )}
            </div>
          ) : null}

          {showInbox ? (
            <div className="space-y-1.5" data-testid={`${testId}-inbox`}>
              <select
                className="w-full border rounded-xl p-2 text-xs font-semibold"
                value=""
                onChange={(e) => {
                  const peer = parsePeerValue(e.target.value);
                  if (peer) setChannel(peer);
                }}
                data-testid={`${testId}-pick`}
              >
                <option value="">Personel seç · yeni yazışma</option>
                  {(data.directory || []).length ? (
                    <optgroup label="Personel">
                      {(data.directory || []).map((emp) => (
                        <option key={emp.id} value={`e:${emp.id}`}>{emp.full_name}{emp.position ? ` · ${emp.position}` : ""}</option>
                      ))}
                    </optgroup>
                  ) : null}
                  {managers.filter((m) => m.id && m.id !== selfId).length ? (
                    <optgroup label="Yöneticiler">
                      {managers.filter((m) => m.id && m.id !== selfId).map((m) => (
                        <option key={m.id} value={`m:${m.id}`}>{m.name || "Yönetici"}</option>
                      ))}
                    </optgroup>
                  ) : null}
              </select>
              {managerRows.filter((r) => r.user_id !== "_all").map((row) => (
                <InboxButton
                  key={`m-${row.user_id}`}
                  title={row.name || "Yönetici"}
                  last={row.last}
                  unread={row.unread || 0}
                  testId={`${testId}-inbox-mgr-${row.user_id}`}
                  onClick={() => setChannel({ kind: "manager", id: row.user_id })}
                />
              ))}
              {conversations.length === 0 ? (
                <div className="text-xs text-slate-400">Kayıtlı personel yok.</div>
              ) : conversations.map((row) => (
                <InboxButton
                  key={row.employee_id}
                  title={row.employee_name || "Personel"}
                  last={row.last}
                  unread={row.unread || 0}
                  testId={`${testId}-inbox-${row.employee_id}`}
                  onClick={() => setChannel({ kind: "emp", id: row.employee_id })}
                />
              ))}
            </div>
          ) : null}

          {!locked && !channel ? (
            <div className="space-y-1.5" data-testid={`${testId}-groups`}>
              <div className="flex items-center gap-2">
                <div className="text-xs font-bold text-slate-800 flex-1">Grup yazışmaları</div>
                <button
                  type="button"
                  onClick={() => setShowGroupForm((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-violet-200 text-violet-700 bg-violet-50"
                  data-testid={`${testId}-group-new`}
                >
                  <Users className="w-3.5 h-3.5" /> Yeni grup
                </button>
                {showInbox ? (
                  <button
                    type="button"
                    onClick={() => setShowAnnounceForm((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-violet-200 text-violet-700 bg-violet-50"
                    data-testid={`${testId}-announce-new`}
                  >
                    <Megaphone className="w-3.5 h-3.5" /> Duyuru
                  </button>
                ) : null}
              </div>
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
              {!groups.length ? (
                <div className="text-xs text-slate-400">Henüz grup yok.</div>
              ) : groups.map((row) => (
                <InboxButton
                  key={row.group_id || row.id}
                  title={row.name || row.title || "Grup"}
                  last={row.last}
                  unread={row.unread || 0}
                  testId={`${testId}-inbox-group-${row.group_id || row.id}`}
                  onClick={() => setChannel({ kind: "group", id: row.group_id || row.id })}
                />
              ))}
            </div>
          ) : null}

          {!locked && !channel && (showInbox || (data.announcements || []).length) ? (
            <div className="space-y-1.5" data-testid={`${testId}-announcements`}>
              <div className="text-xs font-bold text-slate-800">Duyurular</div>
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
              {!(data.announcements || []).length ? (
                <div className="text-xs text-slate-400">Henüz duyuru yok.</div>
              ) : (data.announcements || []).map((row) => (
                <InboxButton
                  key={row.id}
                  title={row.title || "Duyuru"}
                  last={{ body: `${row.from_name || "Yönetici"} · ${announceAudienceLabel(row)} · ${messagePreview(row)}` }}
                  unread={(row.read_by || []).includes(selfId) ? 0 : 1}
                  testId={`${testId}-announce-${row.id}`}
                  onClick={() => openAnnouncement(row)}
                />
              ))}
            </div>
          ) : null}

          {showThread && (channel || locked || selectedManager || mode === "staff" || mode === "both") ? (
            <div className="space-y-2 max-h-72 overflow-y-auto" data-testid={`${testId}-thread`}>
              {preview.length === 0 ? (
                <div className="text-xs text-slate-400 text-center py-3">
                  {showStaffPick && !selectedManager && !channel ? "Yazışmak için yönetici seçin." : "Henüz mesaj yok. Aşağıdan yazın."}
                </div>
              ) : (compact ? preview : [...preview].reverse()).map((m) => <Bubble key={m.id || m.created_at} m={m} />)}
            </div>
          ) : null}

          {showThread || locked ? (
            <form onSubmit={send} className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder={
                  channel?.kind === "group"
                    ? "Gruba yazın…"
                    : locked || channel?.kind === "emp"
                      ? "Mesaj yazın…"
                      : selectedName
                        ? `${selectedName} adlı yöneticiye yazın…`
                        : "Yöneticiye yazın…"
                }
                className="flex-1 border rounded-xl p-2 text-xs"
                data-testid={`${testId}-draft`}
              />
              <button type="submit" disabled={busy} className="self-end px-3 py-2 rounded-xl bg-violet-600 text-white font-bold text-xs disabled:opacity-50" data-testid={`${testId}-send`}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}

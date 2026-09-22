import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Loader2, MessageSquare, Send } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import {
  MESSAGES_HIDDEN_KEY,
  mergeInboxWithDirectory,
  messageAuthor,
  messagePreview,
  parseHiddenFlag,
  previewStaffMessages,
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

export function StaffMessagesPanel({
  employeeId,
  compact,
  testId = "staff-messages-panel",
  collapsible = true,
}) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [openEmp, setOpenEmp] = useState(employeeId || "");
  const [hidden, setHidden] = useState(() => {
    try { return parseHiddenFlag(localStorage.getItem(MESSAGES_HIDDEN_KEY)); } catch { return false; }
  });

  const load = useCallback(() => {
    const params = {};
    if (openEmp) params.employee_id = openEmp;
    axios.get(`${API_URL}/personnel/messages`, { params, withCredentials: true })
      .then((r) => setData(r.data))
      .catch((err) => setData(err.response?.status === 403 ? { mode: "none", thread: [], inbox: [] } : null));
  }, [openEmp]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOpenEmp(employeeId || ""); }, [employeeId]);

  const toggleHidden = () => {
    const next = !hidden;
    setHidden(next);
    try { localStorage.setItem(MESSAGES_HIDDEN_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };

  const send = async (e) => {
    e?.preventDefault?.();
    const invalid = validateMessageBody(draft);
    if (invalid) { toast.error(invalid); return; }
    setBusy(true);
    try {
      await axios.post(`${API_URL}/personnel/messages`, { body: draft, employee_id: openEmp || undefined }, { withCredentials: true });
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
    await axios.post(`${API_URL}/personnel/messages/read`, { employee_id: openEmp || undefined }, { withCredentials: true }).catch(() => {});
    load();
  };

  if (data?.mode === "none") return null;

  const mode = data?.mode || "";
  const locked = !!employeeId;
  const showThread = mode === "staff" || mode === "both" || mode === "thread" || locked || !!openEmp;
  const showInbox = (mode === "manager" || mode === "both") && !locked && !openEmp;
  const unread = Number(data?.unread || 0);
  const conversations = useMemo(
    () => mergeInboxWithDirectory(data?.inbox, data?.directory),
    [data?.inbox, data?.directory],
  );
  const preview = compact ? previewStaffMessages(data?.thread) : (data?.thread || []);

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
            {data.employee?.full_name && (locked || mode === "staff") ? `${data.employee.full_name} ile yazışma` : "Tüm yazışmalar burada"}
          </div>
        </div>
        {openEmp && !locked ? (
          <button type="button" onClick={() => setOpenEmp("")} className="text-[11px] font-bold text-violet-700" data-testid={`${testId}-back`}>Geri</button>
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
          {showInbox ? (
            <div className="space-y-1.5" data-testid={`${testId}-inbox`}>
              {(data.directory || []).length > 0 ? (
                <select
                  className="w-full border rounded-xl p-2 text-xs font-semibold"
                  value=""
                  onChange={(e) => { if (e.target.value) setOpenEmp(e.target.value); }}
                  data-testid={`${testId}-pick`}
                >
                  <option value="">Personel seç · yeni yazışma</option>
                  {(data.directory || []).map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.full_name}{emp.position ? ` · ${emp.position}` : ""}</option>
                  ))}
                </select>
              ) : null}
              {conversations.length === 0 ? (
                <div className="text-xs text-slate-400">Kayıtlı personel yok.</div>
              ) : conversations.map((row) => (
                <button
                  key={row.employee_id}
                  type="button"
                  onClick={() => setOpenEmp(row.employee_id)}
                  className="w-full text-left rounded-xl border border-slate-100 px-3 py-2 hover:bg-slate-50"
                  data-testid={`${testId}-inbox-${row.employee_id}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800 truncate">{row.employee_name || "Personel"}</span>
                    {row.unread > 0 ? <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-600 text-white">{row.unread}</span> : null}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{row.last ? messagePreview(row.last) : "Yeni yazışma"}</div>
                </button>
              ))}
            </div>
          ) : null}

          {showThread ? (
            <div className="space-y-2 max-h-72 overflow-y-auto" data-testid={`${testId}-thread`}>
              {preview.length === 0 ? (
                <div className="text-xs text-slate-400 text-center py-3">Henüz mesaj yok. Aşağıdan yazın.</div>
              ) : (compact ? preview : [...preview].reverse()).map((m) => <Bubble key={m.id || m.created_at} m={m} />)}
            </div>
          ) : null}

          {showThread || locked ? (
            <form onSubmit={send} className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder={locked || openEmp ? "Mesaj yazın…" : "Yöneticiye yazın…"}
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

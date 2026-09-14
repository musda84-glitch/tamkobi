
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Mail, Inbox, Send, Settings, RefreshCw, Loader2, Paperclip, Star, Trash2, X, PenSquare, Folder, CheckCircle2, AlertCircle, Reply, Download } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

const AccountSetup = ({ companyId, account, onSaved, onClose }) => {
  const [presets, setPresets] = useState([]);
  const [form, setForm] = useState({ provider: account?.provider || "outlook", email: account?.email || "", display_name: account?.display_name || "", password: "", imap_host: account?.imap_host || "", imap_port: account?.imap_port || 993, smtp_host: account?.smtp_host || "", smtp_port: account?.smtp_port || 587, signature: account?.signature || "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { axios.get(`${API_URL}/comm/mail/presets`).then((r) => setPresets(r.data)); }, []);
  const applyPreset = (code) => { const p = presets.find((x) => x.code === code); setForm({ ...form, provider: code, imap_host: p?.imap_host || "", imap_port: p?.imap_port || 993, smtp_host: p?.smtp_host || "", smtp_port: p?.smtp_port || 587 }); };
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await axios.put(`${API_URL}/comm/mail/account`, { company_id: companyId, ...form }, { withCredentials: true });
      toast[r.data.test_result.ok ? "success" : "error"](r.data.test_result.message); onSaved(r.data); if (r.data.test_result.ok) onClose();
    } catch (err) { toast.error(err.response?.data?.detail || "Hesap kaydedilemedi."); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto" data-testid="mail-account-modal">
        <div className="flex items-center justify-between border-b pb-2"><h3 className="text-base font-bold text-slate-900">E-posta Hesabı Bağla (IMAP/SMTP)</h3><button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button></div>
        <form onSubmit={save} className="space-y-3 text-xs">
          <div><label className="block font-semibold mb-1">Sağlayıcı</label><select value={form.provider} onChange={(e) => applyPreset(e.target.value)} className={inputCls} data-testid="mail-provider-select">{presets.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block font-semibold mb-1">E-posta Adresi</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} required data-testid="mail-email-input" /></div>
            <div><label className="block font-semibold mb-1">Görünen Ad</label><input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className={inputCls} placeholder="TamKobi Muhasebe" /></div>
          </div>
          <div><label className="block font-semibold mb-1">Uygulama Şifresi {account?.has_password && <span className="text-slate-400 font-normal">(kayıtlı — değiştirmek için girin)</span>}</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} required={!account} data-testid="mail-password-input" />
            <p className="text-[10px] text-slate-400 mt-1">Outlook/Gmail için hesabınızda 2 adımlı doğrulamayı açıp "Uygulama şifresi" oluşturun; normal şifrenizi kullanmayın.</p></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><label className="block font-semibold mb-1">IMAP Sunucu</label><input value={form.imap_host} onChange={(e) => setForm({ ...form, imap_host: e.target.value })} className={`${inputCls} font-mono`} required data-testid="mail-imap-host-input" /></div>
            <div><label className="block font-semibold mb-1">Port</label><input type="number" value={form.imap_port} onChange={(e) => setForm({ ...form, imap_port: e.target.value })} className={inputCls} /></div>
            <div className="col-span-2"><label className="block font-semibold mb-1">SMTP Sunucu</label><input value={form.smtp_host} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} className={`${inputCls} font-mono`} required data-testid="mail-smtp-host-input" /></div>
            <div><label className="block font-semibold mb-1">Port</label><input type="number" value={form.smtp_port} onChange={(e) => setForm({ ...form, smtp_port: e.target.value })} className={inputCls} /></div>
          </div>
          <div><label className="block font-semibold mb-1">İmza</label><textarea value={form.signature} onChange={(e) => setForm({ ...form, signature: e.target.value })} rows={2} className={inputCls} placeholder="Saygılarımızla, TamKobi A.Ş." /></div>
          <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-60" data-testid="save-mail-account-btn">{busy && <Loader2 className="w-4 h-4 animate-spin" />} Bağla & Test Et</button></div>
        </form>
      </div>
    </div>
  );
};

const Compose = ({ companyId, initial, onClose, onSent }) => {
  const [form, setForm] = useState({ to: initial?.to || "", cc: "", subject: initial?.subject || "", body: initial?.body || "" });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v)); fd.append("company_id", companyId); files.forEach((f) => fd.append("files", f));
      const r = await axios.post(`${API_URL}/comm/mail/send`, fd, { withCredentials: true }); toast.success(r.data.message); onSent?.(); onClose();
    } catch (err) { toast.error(err.response?.data?.detail || "Gönderilemedi."); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-3 shadow-2xl border border-slate-200" data-testid="mail-compose-modal">
        <div className="flex items-center justify-between border-b pb-2"><h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><PenSquare className="w-4 h-4 text-emerald-600" /> Yeni E-posta</h3><button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button></div>
        <form onSubmit={send} className="space-y-2 text-xs">
          <input value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="Kime (virgülle ayırın)" className={inputCls} required data-testid="compose-to-input" />
          <input value={form.cc} onChange={(e) => setForm({ ...form, cc: e.target.value })} placeholder="CC" className={inputCls} />
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Konu" className={`${inputCls} font-semibold`} data-testid="compose-subject-input" />
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={10} placeholder="Mesajınız..." className={inputCls} data-testid="compose-body-input" />
          <div className="flex items-center justify-between pt-2 border-t">
            <label className="flex items-center gap-2 text-slate-600 cursor-pointer"><Paperclip className="w-4 h-4" /> {files.length ? `${files.length} dosya` : "Dosya ekle"}<input type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} data-testid="compose-files-input" /></label>
            <button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-60" data-testid="compose-send-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Gönder</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const MailClient = ({ companyId }) => {
  const [account, setAccount] = useState(undefined);
  const [showSetup, setShowSetup] = useState(false);
  const [folders, setFolders] = useState([]);
  const [folder, setFolder] = useState("INBOX");
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [compose, setCompose] = useState(null);
  const [view, setView] = useState("inbox"); // inbox | sent
  const [sentLogs, setSentLogs] = useState([]);
  const [error, setError] = useState(null);

  const loadAccount = useCallback(async () => { const r = await axios.get(`${API_URL}/comm/mail/account?company_id=${companyId}`); setAccount(r.data); return r.data; }, [companyId]);
  const loadFolders = useCallback(async () => { try { const r = await axios.get(`${API_URL}/comm/mail/folders?company_id=${companyId}`); setFolders(r.data); } catch { setFolders([{ name: "INBOX" }]); } }, [companyId]);
  const loadMessages = useCallback(async (f) => {
    setLoading(true); setError(null);
    try { const r = await axios.get(`${API_URL}/comm/mail/messages?company_id=${companyId}&folder=${encodeURIComponent(f)}&limit=40`); setMessages(r.data.messages); setTotal(r.data.total); }
    catch (err) { setError(err.response?.data?.detail || "Mesajlar alınamadı."); setMessages([]); }
    finally { setLoading(false); }
  }, [companyId]);
  const loadSent = useCallback(async () => { const r = await axios.get(`${API_URL}/comm/mail/logs?company_id=${companyId}`); setSentLogs(r.data); }, [companyId]);

  useEffect(() => { (async () => { const a = await loadAccount(); if (a && a.status !== "error") { loadFolders(); loadMessages("INBOX"); } loadSent(); })(); }, [loadAccount, loadFolders, loadMessages, loadSent]);

  const openMessage = async (m) => {
    try {
      const r = await axios.get(`${API_URL}/comm/mail/messages/${m.uid}?company_id=${companyId}&folder=${encodeURIComponent(folder)}`);
      setSelected(r.data);
      if (!m.is_read) { await axios.post(`${API_URL}/comm/mail/messages/${m.uid}/flag`, { company_id: companyId, folder, flag: "read", add: true }); setMessages(messages.map((x) => (x.uid === m.uid ? { ...x, is_read: true } : x))); }
    } catch (err) { toast.error(err.response?.data?.detail || "Mesaj açılamadı."); }
  };
  const deleteMessage = async (m) => {
    try { await axios.post(`${API_URL}/comm/mail/messages/${m.uid}/flag`, { company_id: companyId, folder, flag: "deleted", add: true }); toast.success("Mesaj silindi."); setSelected(null); loadMessages(folder); }
    catch { toast.error("Silinemedi."); }
  };
  const download = (att) => { const a = document.createElement("a"); a.href = `data:${att.content_type};base64,${att.data_b64}`; a.download = att.filename; a.click(); };

  if (account === undefined) return <div className="p-8 text-center text-xs text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;

  if (!account) return (
    <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center space-y-3" data-testid="mail-empty-state">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><Mail className="w-7 h-7" /></div>
      <h3 className="text-base font-bold text-slate-900">E-posta hesabınızı bağlayın</h3>
      <p className="text-xs text-slate-500 max-w-md mx-auto">Outlook, Office 365, Gmail, Yandex veya kurumsal posta sunucunuzu IMAP/SMTP ile bağlayarak gelen kutunuzu burada görüntüleyin, fatura ve ekstre e-postalarını tek tıkla gönderin.</p>
      <button onClick={() => setShowSetup(true)} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold" data-testid="connect-mail-btn">Hesap Bağla</button>
      {showSetup && <AccountSetup companyId={companyId} account={null} onSaved={(a) => { setAccount(a); if (a.test_result?.ok) { loadFolders(); loadMessages("INBOX"); } }} onClose={() => setShowSetup(false)} />}
    </div>
  );

  return (
    <div className="space-y-3" data-testid="mail-client">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-900">{account.display_name || account.email}</span>
          <span className="text-slate-400">{account.email}</span>
          {account.status === "connected" ? <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md px-2 py-0.5"><CheckCircle2 className="w-3 h-3" /> BAĞLI</span> : <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 rounded-md px-2 py-0.5" title={account.last_error}><AlertCircle className="w-3 h-3" /> HATA</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCompose({})} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="mail-compose-btn"><PenSquare className="w-4 h-4" /> Yeni E-posta</button>
          <button onClick={() => loadMessages(folder)} className="p-2 border rounded-xl hover:bg-slate-50" title="Yenile" data-testid="mail-refresh-btn"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
          <button onClick={() => setShowSetup(true)} className="p-2 border rounded-xl hover:bg-slate-50" title="Hesap Ayarları" data-testid="mail-settings-btn"><Settings className="w-4 h-4" /></button>
        </div>
      </div>
      {account.last_error && account.status === "error" && <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2" data-testid="mail-error-banner">{account.last_error} — Ayarlardan uygulama şifresini kontrol edin.</div>}

      <div className="grid grid-cols-12 gap-3 min-h-[560px]">
        <div className="col-span-12 md:col-span-2 bg-white border border-slate-200 rounded-2xl p-2 space-y-0.5 text-xs">
          <button onClick={() => { setView("inbox"); setFolder("INBOX"); setSelected(null); loadMessages("INBOX"); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg font-semibold ${view === "inbox" && folder === "INBOX" ? "bg-emerald-50 text-emerald-700" : "hover:bg-slate-50 text-slate-700"}`} data-testid="mail-folder-inbox"><Inbox className="w-4 h-4" /> Gelen Kutusu</button>
          <button onClick={() => { setView("sent"); setSelected(null); loadSent(); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg font-semibold ${view === "sent" ? "bg-emerald-50 text-emerald-700" : "hover:bg-slate-50 text-slate-700"}`} data-testid="mail-folder-sent"><Send className="w-4 h-4" /> Gönderilenler (ERP)</button>
          <div className="pt-2 mt-2 border-t text-[10px] uppercase text-slate-400 font-semibold px-3">Klasörler</div>
          {folders.filter((f) => f.name.toUpperCase() !== "INBOX").map((f) => (
            <button key={f.name} onClick={() => { setView("inbox"); setFolder(f.name); setSelected(null); loadMessages(f.name); }} className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg truncate ${view === "inbox" && folder === f.name ? "bg-emerald-50 text-emerald-700 font-semibold" : "hover:bg-slate-50 text-slate-600"}`} title={f.name}><Folder className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{f.name.split("/").pop()}</span></button>
          ))}
        </div>

        <div className="col-span-12 md:col-span-4 bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b text-xs font-bold text-slate-900 flex items-center justify-between">{view === "sent" ? "Gönderilenler" : folder} <span className="text-slate-400 font-medium">{view === "sent" ? sentLogs.length : total}</span></div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-[520px]">
            {view === "inbox" && (loading ? <div className="p-6 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : error ? <div className="p-4 text-xs text-rose-600">{error}</div> : messages.length === 0 ? <div className="p-6 text-center text-xs text-slate-400">Bu klasörde mesaj yok.</div> : messages.map((m) => (
              <button key={m.uid} onClick={() => openMessage(m)} className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${selected?.uid === m.uid ? "bg-emerald-50/60" : ""} ${!m.is_read ? "border-l-2 border-emerald-500" : ""}`} data-testid={`mail-item-${m.uid}`}>
                <div className="flex items-center justify-between gap-2"><span className={`text-xs truncate ${!m.is_read ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}>{m.from_name}</span><span className="text-[10px] text-slate-400 whitespace-nowrap">{m.date ? new Date(m.date).toLocaleDateString("tr-TR") : ""}</span></div>
                <div className={`text-xs truncate ${!m.is_read ? "font-semibold text-slate-800" : "text-slate-600"}`}>{m.subject}</div>
              </button>
            )))}
            {view === "sent" && sentLogs.map((l) => (
              <button key={l.id} onClick={() => setSelected({ ...l, uid: l.id, from_name: account.email, from_email: account.email, to: l.to.join(", "), date: l.created_at, text: l.body, attachments: [], is_log: true })} className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${selected?.uid === l.id ? "bg-emerald-50/60" : ""}`} data-testid={`sent-item-${l.id}`}>
                <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-700 truncate">→ {l.to.join(", ")}</span><span className={`text-[10px] font-bold ${l.status === "sent" ? "text-emerald-600" : "text-rose-600"}`}>{l.status === "sent" ? "İletildi" : "Hata"}</span></div>
                <div className="text-xs text-slate-600 truncate">{l.subject || "(Konu yok)"}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="col-span-12 md:col-span-6 bg-white border border-slate-200 rounded-2xl p-5 overflow-y-auto max-h-[580px]">
          {!selected ? <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-2 py-20"><Mail className="w-10 h-10" /><span className="text-xs">Okumak için bir mesaj seçin</span></div> : (
            <div className="space-y-4" data-testid="mail-reading-pane">
              <div className="flex items-start justify-between gap-3 border-b pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{selected.subject}</h3>
                  <div className="text-xs text-slate-600 mt-1"><b>{selected.from_name}</b> {selected.from_email && selected.from_email !== selected.from_name && <span className="text-slate-400">&lt;{selected.from_email}&gt;</span>}</div>
                  <div className="text-[11px] text-slate-400">Kime: {selected.to} • {selected.date ? new Date(selected.date).toLocaleString("tr-TR") : ""}</div>
                </div>
                {!selected.is_log && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setCompose({ to: selected.from_email, subject: `Re: ${selected.subject}`, body: `\n\n---- ${selected.from_name} yazdı: ----\n${(selected.text || "").slice(0, 1500)}` })} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Yanıtla" data-testid="mail-reply-btn"><Reply className="w-4 h-4" /></button>
                    <button onClick={() => deleteMessage(selected)} className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="Sil" data-testid="mail-delete-btn"><Trash2 className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
              {selected.html && !selected.is_log ? <iframe title="mail" sandbox="" srcDoc={selected.html} className="w-full min-h-[380px] border-0" /> : <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 leading-relaxed">{selected.text || selected.body}</pre>}
              {selected.attachments?.length > 0 && (
                <div className="border-t pt-3 space-y-1.5">
                  <div className="text-[10px] uppercase text-slate-400 font-semibold flex items-center gap-1"><Paperclip className="w-3 h-3" /> Ekler ({selected.attachments.length})</div>
                  {selected.attachments.map((a, i) => (
                    <button key={i} onClick={() => a.data_b64 && download(a)} className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-100 w-full text-left" data-testid={`mail-attachment-${i}`}><Download className="w-3.5 h-3.5 text-slate-500" /> <span className="flex-1 truncate">{a.filename}</span><span className="text-slate-400">{(a.size / 1024).toFixed(0)} KB</span></button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showSetup && <AccountSetup companyId={companyId} account={account} onSaved={(a) => { setAccount(a); if (a.test_result?.ok) { loadFolders(); loadMessages("INBOX"); } }} onClose={() => setShowSetup(false)} />}
      {compose && <Compose companyId={companyId} initial={compose} onClose={() => setCompose(null)} onSent={loadSent} />}
    </div>
  );
};


import React, { useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { Printer, Mail, MessageSquare, Phone, Copy, X, Share2, Link2, FileDown } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { QuickMessageModal } from "./QuickMessageModal";
import { downloadStatementPdf, shareStatementLink } from "../utils/statementShare";
import { formatTrAmount } from "../utils/money";

const fmt = (n) => formatTrAmount((n || 0));

export const buildStatementRows = (data) => {
  const rows = [];
  (data.invoices || []).filter((i) => i.status !== "cancelled").forEach((i) => rows.push({ date: i.issue_date, doc: `${i.invoice_number} • ${i.invoice_type === "sales" ? "Satış Faturası" : "Alış Faturası"}`, debit: i.invoice_type === "sales" ? i.grand_total : 0, credit: i.invoice_type === "sales" ? 0 : i.grand_total, kind: "invoice" }));
  (data.payments || []).filter((p) => p.type !== "transfer").forEach((p) => rows.push({ date: p.date, doc: `${p.type === "inflow" ? "Tahsilat" : "Ödeme"} • ${p.account_name}${p.description ? " • " + p.description : ""}`, debit: p.type === "inflow" ? 0 : p.amount, credit: p.type === "inflow" ? p.amount : 0, kind: "payment" }));
  rows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  let bal = 0;
  return rows.map((r) => { bal += (r.debit || 0) - (r.credit || 0); return { ...r, balance: bal }; });
};

export const statementText = (contact, rows, company) => {
  const last = rows.slice(-12);
  const lines = last.map((r) => `${r.date}  ${r.doc.split(" • ").slice(0, 2).join(" ")}  ${r.debit ? "Borç " + fmt(r.debit) : "Alacak " + fmt(r.credit)} ₺`);
  const bal = rows.length ? rows[rows.length - 1].balance : contact.balance || 0;
  return `${company?.name || "Firmamız"} - Cari Hesap Ekstresi\nSayın ${contact.name}\nTarih: ${new Date().toLocaleDateString("tr-TR")}\n\n${lines.join("\n")}\n\nGüncel Bakiye: ${fmt(Math.abs(bal))} ₺ ${bal > 0 ? "(Borcunuz)" : bal < 0 ? "(Alacağınız)" : ""}\n\nBilgilerinize sunarız.`;
};

export const StatementShareBar = ({ contact, rows, companyId }) => {
  const { activeCompany } = useAuth();
  const [msg, setMsg] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [busy, setBusy] = useState("");
  const text = statementText(contact, rows, activeCompany);
  const sharedText = shareLink ? `${text}\n\nEkstre linki: ${shareLink}` : text;
  const copy = async () => { try { await navigator.clipboard.writeText(sharedText); toast.success("Ekstre metni kopyalandı."); } catch { toast.error("Kopyalanamadı."); } };
  const whatsapp = async () => {
    const phone = (contact.phone || "").replace(/\D/g, "").replace(/^0/, "90");
    if (!phone) { toast.error("Carinin telefon numarası yok."); return; }
    let link = shareLink;
    if (!link) {
      try { link = await shareStatementLink(contact, { silent: true }); setShareLink(link); } catch { /* metin yine gider */ }
    }
    const body = link ? `${text}\n\nEkstre linki: ${link}` : text;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`, "_blank");
    try { await axios.post(`${API_URL}/comm/whatsapp/logs`, { company_id: companyId, contact_id: contact.id, contact_name: contact.name, phone: contact.phone, message: body, direction: "outbound" }); } catch { /* log optional */ }
  };
  const mint = async () => {
    setBusy("link");
    try { setShareLink(await shareStatementLink(contact)); }
    catch (err) { toast.error(err.response?.data?.detail || "Link oluşturulamadı."); }
    finally { setBusy(""); }
  };
  const pdf = async () => {
    setBusy("pdf");
    try { await downloadStatementPdf(contact); }
    catch { toast.error("PDF indirilemedi."); }
    finally { setBusy(""); }
  };
  const B = ({ icon: Icon, label, onClick, cls = "", testId, disabled }) => <button type="button" onClick={onClick} disabled={disabled} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition hover:shadow-sm disabled:opacity-50 ${cls}`} data-testid={testId}><Icon className="w-3.5 h-3.5" /> {label}</button>;
  return (
    <>
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-2 space-y-2" data-testid="statement-share-bar">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-[11px] font-bold text-slate-500 mr-1"><Share2 className="w-3.5 h-3.5" /> Ekstreyi Paylaş:</span>
          <B icon={Link2} label={busy === "link" ? "…" : "Link"} onClick={mint} disabled={!!busy} cls="bg-indigo-600 text-white border-indigo-600" testId="statement-link-btn" />
          <B icon={FileDown} label={busy === "pdf" ? "…" : "PDF"} onClick={pdf} disabled={!!busy} cls="bg-white text-indigo-700 border-indigo-200" testId="statement-pdf-btn" />
          <B icon={Printer} label="Yazdır / PDF" onClick={() => setPrintOpen(true)} cls="bg-slate-900 text-white border-slate-900" testId="statement-print-btn" />
          <B icon={Mail} label="E-posta" onClick={() => setMsg("email")} cls="bg-white text-emerald-700 border-emerald-200" testId="statement-email-btn" />
          <B icon={MessageSquare} label="SMS" onClick={() => setMsg("sms")} cls="bg-white text-indigo-700 border-indigo-200" testId="statement-sms-btn" />
          <B icon={Phone} label="WhatsApp" onClick={whatsapp} cls="bg-white text-green-700 border-green-200" testId="statement-whatsapp-btn" />
          <B icon={Copy} label="Kopyala" onClick={copy} cls="bg-white text-slate-700 border-slate-200" testId="statement-copy-btn" />
        </div>
        {shareLink && (
          <div className="flex items-center gap-1.5" data-testid="statement-share-link">
            <input readOnly value={shareLink} className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-700" data-testid="statement-share-link-input" />
            <button type="button" onClick={() => navigator.clipboard.writeText(shareLink).then(() => toast.success("Link kopyalandı.")).catch(() => toast.error("Kopyalanamadı."))} className="px-2 py-1 text-[11px] font-semibold border rounded-lg bg-white" data-testid="statement-share-link-copy">Kopyala</button>
          </div>
        )}
      </div>
      {msg && <QuickMessageModal companyId={companyId} channel={msg} recipient={{ contact_id: contact.id, name: contact.name, phone: contact.phone, email: contact.email }} defaultSubject={`Cari Hesap Ekstresi - ${contact.name}`} defaultMessage={msg === "sms" ? `Sayın ${contact.name}, ${new Date().toLocaleDateString("tr-TR")} itibarıyla cari bakiyeniz ${fmt(Math.abs(contact.balance || 0))} ₺ ${contact.balance > 0 ? "borç" : "alacak"} olarak görünmektedir.${shareLink ? ` Ekstre: ${shareLink}` : " Detaylı ekstre için bize ulaşın."}` : sharedText} context="statement" refId={contact.id} onClose={() => setMsg(null)} />}
      {printOpen && <StatementPrint contact={contact} rows={rows} company={activeCompany} onClose={() => setPrintOpen(false)} />}
    </>
  );
};

export const StatementPrint = ({ contact, rows, company, onClose }) => {
  useEscape(onClose);
  const bal = rows.length ? rows[rows.length - 1].balance : contact.balance || 0;
  const totD = rows.reduce((s, r) => s + (r.debit || 0), 0), totC = rows.reduce((s, r) => s + (r.credit || 0), 0);
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-start justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:static" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl print:shadow-none print:rounded-none" onClick={(e) => e.stopPropagation()} data-testid="statement-print-modal">
        <div className="flex items-center justify-between px-5 py-3 border-b no-print">
          <span className="text-xs font-bold text-slate-700">Ekstre Önizleme</span>
          <div className="flex items-center gap-2"><button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="statement-print-now-btn"><Printer className="w-3.5 h-3.5" /> Yazdır / PDF Kaydet</button><button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button></div>
        </div>
        <div id="print-area" className="p-10 text-xs text-slate-800">
          <div className="flex justify-between items-start border-b-4 border-slate-900 pb-4">
            <div><div className="text-lg font-bold">{company?.name}</div><div className="text-slate-500">{company?.address} {company?.city}</div><div className="text-slate-500">VD: {company?.tax_office} • VKN: {company?.tax_number}</div><div className="text-slate-500">{company?.phone} • {company?.email}</div></div>
            <div className="text-right"><div className="text-2xl font-black tracking-tight">CARİ HESAP EKSTRESİ</div><div className="text-slate-500">Tarih: {new Date().toLocaleDateString("tr-TR")}</div></div>
          </div>
          <div className="mt-5"><div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Sayın</div><div className="font-bold text-base">{contact.name}</div><div className="text-slate-500">VKN/TCKN: {contact.tax_number_or_id} {contact.tax_office && `• ${contact.tax_office}`}</div>{contact.address && <div className="text-slate-500">{contact.address} {contact.city}</div>}</div>
          <table className="w-full mt-6 border-collapse">
            <thead><tr className="bg-slate-900 text-white"><th className="text-left p-2 rounded-l">Tarih</th><th className="text-left p-2">Belge / Açıklama</th><th className="text-right p-2">Borç</th><th className="text-right p-2">Alacak</th><th className="text-right p-2 rounded-r">Bakiye</th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className={`border-b border-slate-100 ${i % 2 ? "bg-slate-50" : ""}`}><td className="p-2 font-mono text-slate-500">{r.date}</td><td className="p-2">{r.doc}</td><td className="p-2 text-right">{r.debit ? fmt(r.debit) + " ₺" : ""}</td><td className="p-2 text-right">{r.credit ? fmt(r.credit) + " ₺" : ""}</td><td className="p-2 text-right font-semibold">{fmt(r.balance)} ₺</td></tr>)}</tbody>
            <tfoot><tr className="border-t-2 border-slate-900 font-bold"><td className="p-2" colSpan={2}>TOPLAM</td><td className="p-2 text-right">{fmt(totD)} ₺</td><td className="p-2 text-right">{fmt(totC)} ₺</td><td className="p-2 text-right">{fmt(bal)} ₺</td></tr></tfoot>
          </table>
          <div className="mt-6 flex justify-end"><div className={`rounded-xl px-4 py-3 text-right ${bal > 0 ? "bg-rose-50" : "bg-emerald-50"}`}><div className="text-[10px] uppercase font-bold text-slate-400">Güncel Bakiye</div><div className={`text-xl font-black ${bal > 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmt(Math.abs(bal))} ₺ <span className="text-xs font-semibold">{bal > 0 ? "Borçlu" : bal < 0 ? "Alacaklı" : ""}</span></div></div></div>
          <div className="mt-10 text-slate-400 italic">Bu ekstre {company?.name} tarafından {new Date().toLocaleString("tr-TR")} tarihinde oluşturulmuştur. Mutabakat için lütfen 7 gün içinde geri dönüş yapınız.</div>
        </div>
      </div>
    </div>
  );
};

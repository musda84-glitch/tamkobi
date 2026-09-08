import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ExternalLink, FileText, Loader2, Save } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { LEGAL_DOCS } from "./LegalConsent";

export const LegalTextsPanel = ({ companyId }) => {
  const [d, setD] = useState(null);
  const [ov, setOv] = useState({});
  const [slug, setSlug] = useState("mesafeli-satis");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    axios.get(`${API_URL}/companies/${companyId}/legal`).then((r) => {
      setD(r.data);
      setOv(r.data.overrides || {});
    }).catch(() => toast.error("Yasal metinler alınamadı."));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="text-xs text-slate-400 p-6">Yükleniyor…</div>;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await axios.put(`${API_URL}/companies/${companyId}/legal`, { overrides: ov });
      setD({ ...d, ...r.data });
      setOv(r.data.overrides || ov);
      toast.success("Yasal metinler kaydedildi.");
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  const current = (d.docs || []).find((x) => x.slug === slug) || d.docs?.[0];
  return (
    <form onSubmit={save} className="space-y-4 text-xs" data-testid="legal-texts-panel">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div>
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><FileText className="w-4 h-4 text-emerald-600" /> Mesafeli satış ve KVKK metinleri</h3>
          <p className="text-[11px] text-slate-500 mt-1">İnternet satışı (B2B sepet) ve müşteri kaydında onay kutuları bu metinlere bağlanır. Boş bırakılan alan şirket bilgilerinizle doldurulmuş yasal şablonu kullanır.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {LEGAL_DOCS.map((x) => (
            <a key={x.slug} href={`/yasal/${x.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 border rounded-lg font-semibold text-emerald-800 hover:bg-emerald-50" data-testid={`legal-preview-${x.key}`}>{x.label} <ExternalLink className="w-3 h-3" /></a>
          ))}
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit flex-wrap">
          {LEGAL_DOCS.map((x) => (
            <button type="button" key={x.slug} onClick={() => setSlug(x.slug)} className={`px-3 py-1.5 rounded-lg font-semibold ${slug === x.slug ? "bg-white shadow text-slate-900" : "text-slate-500"}`} data-testid={`legal-edit-tab-${x.key}`}>{x.label}</button>
          ))}
        </div>
        <textarea
          value={ov[slug] ?? ""}
          onChange={(e) => setOv({ ...ov, [slug]: e.target.value })}
          rows={14}
          placeholder={`${current?.title || "Metin"} için özel metin (boş = otomatik şablon)`}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-mono text-[11px] leading-relaxed"
          data-testid="legal-edit-body"
        />
        <div className="flex justify-end"><button type="submit" disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="legal-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button></div>
      </div>
    </form>
  );
};

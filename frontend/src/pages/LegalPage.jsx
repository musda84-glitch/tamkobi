
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { FileText, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { LEGAL_DOCS } from "../components/LegalConsent";
import { SiteHeader, siteBrand } from "../components/saas/SiteChrome";

export default function LegalPage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const token = params.get("b2b") || "";
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const url = token ? `${API_URL}/public/b2b/${token}/legal/${slug}` : `${API_URL}/public/legal/${slug}`;
    axios.get(url).then((r) => setD(r.data)).catch((e) => setErr(e.response?.data?.detail || "Metin yüklenemedi."));
  }, [slug, token]);
  const extra = token ? `?b2b=${encodeURIComponent(token)}` : "";
  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100" data-testid="legal-page">
      <SiteHeader brand={siteBrand(d?.seller?.name)} right={<Link to={token ? `/portal/${token}` : "/fiyatlar"} className="text-xs text-slate-300 hover:text-white">Geri</Link>} />
      <div className="max-w-3xl mx-auto px-6 pb-16">
        <nav className="flex flex-wrap gap-2 mb-6" data-testid="legal-doc-nav">
          {LEGAL_DOCS.map((x) => (
            <Link key={x.slug} to={`/yasal/${x.slug}${extra}`} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${slug === x.slug ? "bg-emerald-500 text-slate-900 border-emerald-500" : "border-white/10 text-slate-300 hover:bg-white/5"}`} data-testid={`legal-nav-${x.key}`}>{x.label}</Link>
          ))}
        </nav>
        {err && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-5" data-testid="legal-error">{err}</div>}
        {!err && !d && <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor…</div>}
        {d && (
          <article className="bg-white text-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl" data-testid="legal-article">
            <div className="flex items-start gap-3 mb-4">
              <span className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0"><FileText className="w-5 h-5" /></span>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900" data-testid="legal-title">{d.title}</h1>
                <p className="text-[11px] text-slate-500 mt-1">{d.seller?.name} · sürüm {d.version}{d.customized ? " · şirkete özel metin" : ""}</p>
              </div>
            </div>
            <div className="prose prose-sm max-w-none legal-body text-slate-700 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-1 [&_p]:text-xs [&_p]:leading-relaxed [&_p]:mb-3" data-testid="legal-html" dangerouslySetInnerHTML={{ __html: d.html }} />
            <p className="text-[10px] text-slate-400 mt-6 border-t pt-3">Bu metin 6502 sayılı Tüketicinin Korunması Hakkında Kanun, Mesafeli Sözleşmeler Yönetmeliği ve 6698 sayılı KVKK çerçevesinde hazırlanmış bir şablondur. Şirket bilgileriniz metne otomatik işlenir; avukatınızın gözden geçirmesi önerilir.</p>
          </article>
        )}
      </div>
    </div>
  );
}

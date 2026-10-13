import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { BookOpen, PlayCircle, Search, Sparkles } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useHelpOptional } from "../context/HelpContext";

function youtubeId(url) {
  const m = String(url || "").match(/(?:embed\/|v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : "";
}

export default function HelpCenterPage() {
  const help = useHelpOptional();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [type, setType] = useState(params.get("type") || "");
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(true);
  const page = params.get("page") || help?.pageHelp?.pageKey || "";

  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams();
      if (q) sp.set("q", q);
      if (type) sp.set("type", type);
      if (page) sp.set("page", page);
      setParams(sp, { replace: true });
    }, 200);
    return () => clearTimeout(t);
  }, [q, type, page, setParams]);

  useEffect(() => {
    setBusy(true);
    const query = { product: "tamkobi", q, content_type: type, limit: 80 };
    if (page && !q) query.page_key = page;
    axios
      .get(`${API_URL}/help/articles`, { params: query })
      .then((r) => setRows(r.data.articles || []))
      .catch(() => axios.get(`${API_URL}/public/help/articles`, { params: query }).then((r) => setRows(r.data.articles || [])).catch(() => setRows([])))
      .finally(() => setBusy(false));
  }, [q, type, page]);

  useEffect(() => {
    const slug = params.get("slug");
    if (!slug) return;
    axios.get(`${API_URL}/help/articles/${slug}`, { params: { product: "tamkobi" } })
      .then((r) => setSel(r.data))
      .catch(() => axios.get(`${API_URL}/public/help/articles/${slug}`, { params: { product: "tamkobi" } }).then((r) => setSel(r.data)).catch(() => {}));
  }, [params]);

  const grouped = useMemo(() => {
    const map = new Map();
    rows.forEach((a) => {
      const cat = a.category || "Genel";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(a);
    });
    return [...map.entries()];
  }, [rows]);

  const open = async (a) => {
    try {
      const r = await axios.get(`${API_URL}/help/articles/${a.slug}`, { params: { product: "tamkobi" } });
      setSel(r.data);
    } catch {
      const r = await axios.get(`${API_URL}/public/help/articles/${a.slug}`, { params: { product: "tamkobi" } });
      setSel(r.data);
    }
  };

  const vid = sel?.content_type === "video" ? youtubeId(sel.video_url) : "";

  return (
    <div className="space-y-5" data-testid="help-center-page">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Nasıl yapılır?</h1>
        <p className="text-xs sm:text-sm text-slate-500">Makale ve videolar YNT’den ürün etiketiyle (TamKobi) yayınlanır. TamEticaret aynı API’yi kullanır.</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Fatura, cari, e-fatura…"
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm"
            data-testid="help-center-search"
          />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs" data-testid="help-center-type">
          <option value="">Tümü</option>
          <option value="article">Makale</option>
          <option value="video">Video</option>
        </select>
      </div>
      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {busy && <div className="text-xs text-slate-400">Yükleniyor…</div>}
          {!busy && !rows.length && <div className="text-sm text-slate-500 bg-white border rounded-2xl p-6">Sonuç yok. Farklı bir arama deneyin.</div>}
          {grouped.map(([cat, items]) => (
            <div key={cat} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-500 bg-slate-50">{cat}</div>
              <ul>
                {items.map((a) => (
                  <li key={a.slug}>
                    <button type="button" onClick={() => open(a)} className={`w-full text-left px-3 py-2.5 hover:bg-indigo-50/50 ${sel?.slug === a.slug ? "bg-indigo-50" : ""}`} data-testid={`help-article-${a.slug}`}>
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        {a.content_type === "video" ? <PlayCircle className="w-4 h-4 text-rose-500" /> : <BookOpen className="w-4 h-4 text-indigo-500" />}
                        {a.title}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{a.summary}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="lg:col-span-3">
          {!sel ? (
            <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-8 text-sm text-slate-500" data-testid="help-article-empty">
              Soldan bir makale seçin. Sağ üstteki <b>?</b> ile bulunduğunuz sayfanın turunu da başlatabilirsiniz.
              <div className="mt-4 rounded-xl bg-indigo-50 p-3 text-indigo-900 text-xs flex gap-2">
                <Sparkles className="w-4 h-4 shrink-0" />
                Yapay zeka asistanı bu makaleleri bağlam olarak kullanacak şekilde tasarlandı (`/api/help/assistant/context`).
              </div>
            </div>
          ) : (
            <article className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3" data-testid="help-article-detail">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{sel.category || "Makale"}</div>
              <h2 className="text-lg font-bold text-slate-900">{sel.title}</h2>
              <p className="text-sm text-slate-600">{sel.summary}</p>
              {vid && (
                <div className="aspect-video rounded-xl overflow-hidden bg-slate-900">
                  <iframe title={sel.title} src={`https://www.youtube.com/embed/${vid}`} className="w-full h-full" allowFullScreen />
                </div>
              )}
              {sel.video_url && !vid && (
                <a href={sel.video_url} className="text-xs text-indigo-700 underline" target="_blank" rel="noreferrer">{sel.video_url}</a>
              )}
              <div className="prose prose-sm max-w-none text-slate-700 whitespace-pre-wrap text-sm leading-relaxed">{sel.body_md}</div>
              {(sel.page_keys || []).length > 0 && (
                <div className="flex flex-wrap gap-1 pt-2">
                  {sel.page_keys.map((k) => (
                    <Link key={k} to={k} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{k}</Link>
                  ))}
                </div>
              )}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

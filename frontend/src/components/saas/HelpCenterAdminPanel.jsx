import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";

const cred = { withCredentials: true };
const empty = () => ({
  title: "",
  slug: "",
  summary: "",
  body_md: "",
  content_type: "article",
  video_url: "",
  product_tags: ["tamkobi"],
  page_keys: "",
  category: "",
  tags: "",
  status: "draft",
  locale: "tr",
  assistant_intent: "",
  assistant_prompts: "",
  assistant_keywords: "",
});

export function HelpCenterAdminPanel() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState({ q: "", product: "", status: "" });
  const [busy, setBusy] = useState(false);

  const load = () => {
    const params = new URLSearchParams();
    if (filter.q) params.set("q", filter.q);
    if (filter.product) params.set("product", filter.product);
    if (filter.status) params.set("status", filter.status);
    axios.get(`${API_URL}/system/help/articles?${params}`, cred)
      .then((r) => setRows(r.data.articles || []))
      .catch((e) => toast.error(e.response?.data?.detail || "İçerikler alınamadı."));
  };

  useEffect(() => { load(); }, [filter.q, filter.product, filter.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = () => { setEditing(null); setForm(empty()); };

  const edit = (a) => {
    setEditing(a.id);
    setForm({
      title: a.title || "",
      slug: a.slug || "",
      summary: a.summary || "",
      body_md: a.body_md || "",
      content_type: a.content_type || "article",
      video_url: a.video_url || "",
      product_tags: a.product_tags || ["tamkobi"],
      page_keys: (a.page_keys || []).join(", "),
      category: a.category || "",
      tags: (a.tags || []).join(", "),
      status: a.status || "draft",
      locale: a.locale || "tr",
      assistant_intent: a.assistant?.intent || "",
      assistant_prompts: (a.assistant?.suggested_prompts || []).join("\n"),
      assistant_keywords: (a.assistant?.keywords || []).join(", "),
    });
  };

  const payload = () => ({
    title: form.title,
    slug: form.slug,
    summary: form.summary,
    body_md: form.body_md,
    content_type: form.content_type,
    video_url: form.video_url,
    product_tags: form.product_tags,
    page_keys: form.page_keys.split(/[,\s]+/).filter(Boolean),
    category: form.category,
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    status: form.status,
    locale: form.locale,
    assistant: {
      intent: form.assistant_intent,
      keywords: form.assistant_keywords.split(",").map((t) => t.trim()).filter(Boolean),
      suggested_prompts: form.assistant_prompts.split("\n").map((t) => t.trim()).filter(Boolean),
    },
  });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        await axios.put(`${API_URL}/system/help/articles/${editing}`, payload(), cred);
        toast.success("Güncellendi.");
      } else {
        const r = await axios.post(`${API_URL}/system/help/articles`, payload(), cred);
        toast.success("Oluşturuldu.");
        setEditing(r.data.article?.id);
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!window.confirm("Silinsin mi?")) return;
    try {
      await axios.delete(`${API_URL}/system/help/articles/${id}`, cred);
      toast.success("Silindi.");
      if (editing === id) startNew();
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    }
  };

  const toggleProduct = (code) => {
    setForm((f) => {
      const has = (f.product_tags || []).includes(code);
      const next = has ? f.product_tags.filter((x) => x !== code) : [...f.product_tags, code];
      return { ...f, product_tags: next.length ? next : ["tamkobi"] };
    });
  };

  return (
    <div className="space-y-4" data-testid="help-admin-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Yardım Merkezi içerikleri</h2>
          <p className="text-xs text-slate-500">ynt.taiyazilim.com üzerinden yönetilir. Ürün etiketiyle TamKobi ve TamEticaret aynı API’den içerik çeker.</p>
        </div>
        <button type="button" onClick={startNew} className="px-3 py-2 bg-amber-400 text-slate-900 rounded-xl text-xs font-bold flex items-center gap-1.5" data-testid="help-admin-new">
          <Plus className="w-4 h-4" /> Yeni içerik
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input className={`${inputCls} max-w-xs`} placeholder="Ara…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <select className={inputCls} value={filter.product} onChange={(e) => setFilter({ ...filter, product: e.target.value })}>
          <option value="">Tüm ürünler</option>
          <option value="tamkobi">TamKobi</option>
          <option value="tameticaret">TamEticaret</option>
        </select>
        <select className={inputCls} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Tüm durumlar</option>
          <option value="published">Yayında</option>
          <option value="draft">Taslak</option>
        </select>
      </div>
      <div className="grid lg:grid-cols-5 gap-4">
        <ul className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl divide-y max-h-[70vh] overflow-y-auto" data-testid="help-admin-list">
          {rows.map((a) => (
            <li key={a.id}>
              <div className="flex items-start gap-2 p-3">
                <button type="button" onClick={() => edit(a)} className="flex-1 text-left">
                  <div className="text-xs font-bold text-slate-900">{a.title}</div>
                  <div className="text-[10px] text-slate-500">{a.slug} · {(a.product_tags || []).join(", ")} · {a.status}</div>
                </button>
                <button type="button" onClick={() => remove(a.id)} className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg" aria-label="Sil"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </li>
          ))}
          {!rows.length && <li className="p-4 text-xs text-slate-400">Kayıt yok.</li>}
        </ul>
        <form onSubmit={save} className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-4 space-y-2" data-testid="help-admin-form">
          <input className={inputCls} placeholder="Başlık" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required data-testid="help-admin-title" />
          <input className={inputCls} placeholder="slug (boşsa başlıktan)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <textarea className={inputCls} rows={2} placeholder="Özet" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          <textarea className={`${inputCls} font-mono`} rows={8} placeholder="Gövde (Markdown)" value={form.body_md} onChange={(e) => setForm({ ...form, body_md: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <select className={inputCls} value={form.content_type} onChange={(e) => setForm({ ...form, content_type: e.target.value })}>
              <option value="article">Makale</option>
              <option value="video">Video</option>
            </select>
            <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="draft">Taslak</option>
              <option value="published">Yayında</option>
            </select>
          </div>
          {form.content_type === "video" && (
            <input className={inputCls} placeholder="Video URL (YouTube embed)" value={form.video_url} onChange={(e) => setForm({ ...form, video_url: e.target.value })} />
          )}
          <div className="flex gap-2 text-xs">
            {["tamkobi", "tameticaret"].map((code) => (
              <label key={code} className="flex items-center gap-1.5 px-2 py-1.5 border rounded-lg">
                <input type="checkbox" checked={(form.product_tags || []).includes(code)} onChange={() => toggleProduct(code)} data-testid={`help-admin-tag-${code}`} />
                {code}
              </label>
            ))}
          </div>
          <input className={inputCls} placeholder="Sayfa anahtarları: /invoices, /contacts" value={form.page_keys} onChange={(e) => setForm({ ...form, page_keys: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <input className={inputCls} placeholder="Etiketler (virgül)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold pt-1">Asistan bağlamı</div>
          <input className={inputCls} placeholder="intent (create_invoice…)" value={form.assistant_intent} onChange={(e) => setForm({ ...form, assistant_intent: e.target.value })} />
          <input className={inputCls} placeholder="anahtar kelimeler" value={form.assistant_keywords} onChange={(e) => setForm({ ...form, assistant_keywords: e.target.value })} />
          <textarea className={inputCls} rows={2} placeholder="Önerilen sorular (satır satır)" value={form.assistant_prompts} onChange={(e) => setForm({ ...form, assistant_prompts: e.target.value })} />
          <button type="submit" disabled={busy} className="w-full py-2 bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-60" data-testid="help-admin-save">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet
          </button>
        </form>
      </div>
    </div>
  );
}

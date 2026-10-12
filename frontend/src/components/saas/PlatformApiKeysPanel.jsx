import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { KeyRound, Loader2, RefreshCw, Ban, Copy } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";

const cred = { withCredentials: true };

export const PlatformApiKeysPanel = () => {
  const [products, setProducts] = useState([]);
  const [keys, setKeys] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(null);
  const [form, setForm] = useState({ product_id: "", name: "" });

  const load = useCallback(() => {
    Promise.all([
      axios.get(`${API_URL}/platform/admin/products`, cred),
      axios.get(`${API_URL}/platform/admin/api-keys`, cred),
    ])
      .then(([pr, kr]) => {
        const list = pr.data.products || [];
        setProducts(list);
        setKeys(kr.data.keys || []);
        setForm((f) => ({
          ...f,
          product_id: f.product_id || list[0]?.id || list[0]?._id || "",
        }));
      })
      .catch((e) => toast.error(e.response?.data?.detail || "Anahtarlar alınamadı."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!keys) return <div className="text-xs text-slate-400">Yükleniyor…</div>;

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await axios.post(
        `${API_URL}/platform/admin/api-keys`,
        { product_id: form.product_id, name: form.name },
        cred,
      );
      setRevealed(r.data.secret);
      toast.success("Anahtar oluşturuldu — secret yalnızca bir kez gösterilir.");
      setForm((f) => ({ ...f, name: "" }));
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (id) => {
    if (!window.confirm("Döndürülsün mü? Eski anahtar 24 saat grace alır.")) return;
    try {
      const r = await axios.post(`${API_URL}/platform/admin/api-keys/${id}/rotate`, {}, cred);
      setRevealed(r.data.secret);
      toast.success("Döndürüldü — yeni secret bir kez gösterilir.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Döndürülemedi.");
    }
  };

  const revoke = async (id) => {
    if (!window.confirm("Anahtar hemen iptal edilsin mi?")) return;
    try {
      await axios.post(`${API_URL}/platform/admin/api-keys/${id}/revoke`, {}, cred);
      toast.success("İptal edildi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İptal edilemedi.");
    }
  };

  const copy = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      toast.success("Kopyalandı.");
    } catch {
      toast.message(revealed);
    }
  };

  return (
    <div className="space-y-4 text-xs" data-testid="platform-api-keys">
      {revealed && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3" data-testid="pak-secret-once">
          <div className="font-bold text-slate-900 mb-1">Secret (yalnızca bir kez)</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all font-mono text-[11px] bg-white border rounded-lg px-2 py-1.5">{revealed}</code>
            <button type="button" onClick={copy} className="p-2 rounded-lg bg-slate-900 text-white" data-testid="pak-copy">
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => setRevealed(null)} className="text-[11px] font-semibold text-slate-600 underline">
              Gizle
            </button>
          </div>
        </div>
      )}
      <form onSubmit={create} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="pak-create">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-amber-500" /> Yeni API anahtarı
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Ürün</label>
            <select
              required
              value={form.product_id}
              onChange={(e) => setForm({ ...form, product_id: e.target.value })}
              className={inputCls}
              data-testid="pak-product"
            >
              {products.map((p) => (
                <option key={p.id || p._id} value={p.id || p._id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Ad</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} data-testid="pak-name" />
          </div>
        </div>
        <button type="submit" disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="pak-create-submit">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Oluştur
        </button>
      </form>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[720px]" data-testid="pak-table">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">ID</th>
              <th className="px-3 py-2.5 text-left">Ad</th>
              <th className="px-3 py-2.5 text-left">Kapsam</th>
              <th className="px-3 py-2.5 text-left">Son kullanım</th>
              <th className="px-3 py-2.5 text-left">Durum</th>
              <th className="px-3 py-2.5 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  Anahtar yok.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k.id} data-testid={`pak-row-${k.id}`}>
                <td className="px-3 py-2 font-mono text-[11px]">{k.id}</td>
                <td className="px-3 py-2">{k.name}</td>
                <td className="px-3 py-2 text-[10px]">{(k.scopes || []).join(", ")}</td>
                <td className="px-3 py-2">{k.last_used_at || "—"}</td>
                <td className="px-3 py-2">{k.revoked_at ? "iptal" : k.grace_until ? "grace" : "aktif"}</td>
                <td className="px-3 py-2 text-right space-x-1">
                  {!k.revoked_at && (
                    <>
                      <button type="button" onClick={() => rotate(k.id)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg" title="Döndür" data-testid={`pak-rotate-${k.id}`}>
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => revoke(k.id)} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg" title="İptal" data-testid={`pak-revoke-${k.id}`}>
                        <Ban className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

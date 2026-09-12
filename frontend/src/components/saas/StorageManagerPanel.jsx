import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  FolderOpen, Loader2, Search, HardDrive, Plus, RefreshCw, ChevronRight,
  ArrowLeft, FileText, FolderPlus,
} from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { fmtBytes, inputCls, PlanChip, StatusBadge, QuotaBar } from "./saasUi";

const cred = { withCredentials: true };

const pctOf = (bytes, limitMb) => {
  if (!limitMb) return 0;
  return (Number(bytes || 0) / (1024 * 1024)) / Number(limitMb);
};

export const StorageManagerPanel = ({ onOpenCompany }) => {
  const [overview, setOverview] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filesArea, setFilesArea] = useState(null);
  const [files, setFiles] = useState([]);
  const [newFolder, setNewFolder] = useState("");

  const loadOverview = useCallback(() => axios.get(`${API_URL}/system/storage`, cred)
    .then((r) => setOverview(r.data))
    .catch((e) => toast.error(e.response?.data?.detail || "Depolama özeti alınamadı.")), []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const openAccount = async (id) => {
    setSelectedId(id);
    setFilesArea(null);
    setFiles([]);
    setBusy("detail");
    try {
      const r = await axios.get(`${API_URL}/system/storage/${id}`, cred);
      setDetail(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Hesap depolaması alınamadı.");
      setSelectedId(null);
    } finally {
      setBusy("");
    }
  };

  const ensureOne = async (id) => {
    setBusy(`ensure-${id}`);
    try {
      const r = await axios.post(`${API_URL}/system/storage/${id}/ensure`, {}, cred);
      toast.success(`${r.data.folder_count} klasör hazır.`);
      await loadOverview();
      if (selectedId === id) await openAccount(id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Klasörler oluşturulamadı.");
    } finally {
      setBusy("");
    }
  };

  const ensureAll = async () => {
    setBusy("ensure-all");
    try {
      const r = await axios.post(`${API_URL}/system/storage/ensure-all`, {}, cred);
      toast.success(`${r.data.companies} hesap için klasörler doğrulandı.`);
      await loadOverview();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Toplu oluşturma başarısız.");
    } finally {
      setBusy("");
    }
  };

  const createFolder = async () => {
    if (!selectedId || !newFolder.trim()) return;
    setBusy("folder");
    try {
      await axios.post(`${API_URL}/system/storage/${selectedId}/folders`, { label: newFolder.trim() }, cred);
      toast.success("Özel klasör eklendi.");
      setNewFolder("");
      await openAccount(selectedId);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Klasör eklenemedi.");
    } finally {
      setBusy("");
    }
  };

  const openFiles = async (areaKey) => {
    setFilesArea(areaKey);
    setBusy("files");
    try {
      const r = await axios.get(`${API_URL}/system/storage/${selectedId}/folders/${encodeURIComponent(areaKey)}/files`, cred);
      setFiles(r.data.files || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Dosyalar alınamadı.");
      setFiles([]);
    } finally {
      setBusy("");
    }
  };

  const rows = useMemo(() => {
    const list = overview?.accounts || [];
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((r) =>
      (r.name || "").toLowerCase().includes(s)
      || (r.plan_name || "").toLowerCase().includes(s)
      || (r.tax_number || "").includes(s)
    );
  }, [overview, q]);

  if (!overview) {
    return <div className="text-xs text-slate-400 p-6" data-testid="storage-loading">Yükleniyor…</div>;
  }

  if (selectedId && detail) {
    const limitMb = detail.storage_limit_mb || 0;
    return (
      <div className="space-y-4 text-xs" data-testid="saas-storage-detail">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setSelectedId(null); setDetail(null); setFilesArea(null); }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 font-semibold"
            data-testid="storage-back"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Hesaplar
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <button
            type="button"
            onClick={() => onOpenCompany && onOpenCompany(selectedId)}
            className="font-bold text-slate-900 hover:underline"
            data-testid="storage-open-company"
          >
            {detail.company_name || selectedId}
          </button>
          <PlanChip name={detail.plan_name} />
          <button
            type="button"
            disabled={busy.startsWith("ensure")}
            onClick={() => ensureOne(selectedId)}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 text-white rounded-lg font-bold disabled:opacity-60"
            data-testid="storage-ensure-one"
          >
            {busy === `ensure-${selectedId}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Klasörleri doğrula
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <HardDrive className="w-4 h-4" /> Toplam kullanım
            </div>
            <div className="text-slate-500">{fmtBytes(detail.total_bytes)} · {detail.total_files} dosya</div>
          </div>
          <QuotaBar
            used={Number(((detail.total_bytes || 0) / (1024 * 1024)).toFixed(1))}
            limit={limitMb}
            testId="storage-detail-quota"
          />
          <div className="text-[10px] text-slate-400">
            Kota: {limitMb ? `${limitMb} MB` : "sınırsız"} · kök yol: tamkobi/accounts/{selectedId}/…
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] text-slate-500 mb-0.5">Özel klasör adı</label>
            <input
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              placeholder="Örn. Sözleşmeler"
              className={inputCls}
              data-testid="storage-new-folder"
            />
          </div>
          <button
            type="button"
            disabled={busy === "folder" || !newFolder.trim()}
            onClick={createFolder}
            className="inline-flex items-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg font-bold disabled:opacity-60"
            data-testid="storage-create-folder"
          >
            {busy === "folder" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
            Klasör ekle
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2" data-testid="storage-folder-grid">
          {(detail.folders || []).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => openFiles(f.area_key)}
              className={`text-left bg-white border rounded-2xl p-3 hover:border-emerald-400 transition ${filesArea === f.area_key ? "border-emerald-500 ring-1 ring-emerald-200" : "border-slate-200"}`}
              data-testid={`storage-folder-${f.area_key}`}
            >
              <div className="flex items-start gap-2">
                <FolderOpen className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900 truncate">{f.label}</div>
                  <div className="text-[10px] text-slate-400 font-mono truncate">{f.path}</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {f.file_count} dosya · {fmtBytes(f.bytes)}
                    {!f.is_system && <span className="ml-1 text-emerald-700">özel</span>}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {filesArea && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="storage-files-panel">
            <div className="px-3 py-2.5 border-b border-slate-100 flex items-center gap-2 font-semibold text-slate-800">
              <FileText className="w-4 h-4" />
              Dosyalar — {filesArea}
              {busy === "files" && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
            </div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">Dosya</th>
                    <th className="px-3 py-2 text-left">Tür</th>
                    <th className="px-3 py-2 text-right">Boyut</th>
                    <th className="px-3 py-2 text-right">Tarih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {files.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Bu klasörde dosya yok.</td></tr>
                  ) : files.map((file) => (
                    <tr key={file.id} data-testid={`storage-file-${file.id}`}>
                      <td className="px-3 py-2">
                        {file.url ? (
                          <a href={file.url} target="_blank" rel="noreferrer" className="text-emerald-700 font-semibold hover:underline">
                            {file.filename}
                          </a>
                        ) : file.filename}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{file.content_type || "—"}</td>
                      <td className="px-3 py-2 text-right">{fmtBytes(file.size)}</td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {file.created_at ? new Date(file.created_at).toLocaleString("tr-TR") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  const totalBytes = overview.total_bytes || 0;
  return (
    <div className="space-y-4 text-xs" data-testid="saas-storage">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-slate-600 max-w-3xl">
            Her hesap için yüklenebilir alanlar ayrı klasörlerde tutulur (ürün, logo, gider, personel, e-belge…).
            Yeni şirket açıldığında klasörler otomatik oluşur; buradan tüm hesapları yönetebilirsiniz.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Hesap veya paket ara"
              className={inputCls + " pl-8 w-64 bg-white"}
              data-testid="storage-search"
            />
          </div>
          <button
            type="button"
            disabled={busy === "ensure-all"}
            onClick={ensureAll}
            className="inline-flex items-center gap-1 px-3 py-2 bg-slate-900 text-white rounded-lg font-bold disabled:opacity-60"
            data-testid="storage-ensure-all"
          >
            {busy === "ensure-all" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Tüm hesaplarda klasör aç
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-white border border-slate-200 rounded-2xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Hesap</div>
          <div className="text-lg font-bold text-slate-900 mt-1">{overview.total_accounts || 0}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Toplam depolama</div>
          <div className="text-lg font-bold text-slate-900 mt-1">{fmtBytes(totalBytes)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3 col-span-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Alanlar</div>
          <div className="flex flex-wrap gap-1">
            {(overview.areas || []).map((a) => (
              <span key={a.key} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-semibold">{a.label}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Hesap</th>
              <th className="px-3 py-2.5 text-left">Kullanım</th>
              <th className="px-3 py-2.5 text-left">Klasör</th>
              <th className="px-3 py-2.5 text-right"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">Kayıt yok.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} data-testid={`storage-row-${r.id}`}>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => openAccount(r.id)}
                    className="text-left font-semibold text-slate-900 hover:underline"
                    data-testid={`storage-open-${r.id}`}
                  >
                    {r.name}
                  </button>
                  <div className="flex items-center gap-1.5 mt-1">
                    <PlanChip name={r.plan_name} />
                    <StatusBadge status={r.status} />
                  </div>
                  {r.tax_number ? <div className="text-[10px] text-slate-400 mt-0.5">VKN {r.tax_number}</div> : null}
                </td>
                <td className="px-3 py-3 w-56">
                  <QuotaBar
                    used={Number(((r.storage_bytes || 0) / (1024 * 1024)).toFixed(1))}
                    limit={r.storage_limit_mb || 0}
                    testId={`storage-bar-${r.id}`}
                  />
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {fmtBytes(r.storage_bytes)}
                    {r.storage_limit_mb ? ` / ${r.storage_limit_mb} MB` : " / sınırsız"}
                    {pctOf(r.storage_bytes, r.storage_limit_mb) >= 0.9 && r.storage_limit_mb > 0 ? (
                      <span className="text-amber-600 font-semibold ml-1">dolmak üzere</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className="font-semibold text-slate-800">{r.folder_count || 0}</span>
                  <span className="text-slate-400 ml-1">klasör</span>
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap space-x-1">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => ensureOne(r.id)}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg font-semibold hover:bg-slate-50 disabled:opacity-60"
                    data-testid={`storage-ensure-${r.id}`}
                  >
                    {busy === `ensure-${r.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : "Klasör aç"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openAccount(r.id)}
                    className="px-2.5 py-1.5 bg-slate-900 text-white rounded-lg font-bold"
                    data-testid={`storage-manage-${r.id}`}
                  >
                    Yönet
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** Firma ayarları — kendi hesabının klasör özeti */
export const MyStoragePanel = () => {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");

  const load = useCallback(() => axios.get(`${API_URL}/storage/me`, cred)
    .then((r) => setData(r.data))
    .catch((e) => toast.error(e.response?.data?.detail || "Depolama alınamadı.")), []);

  useEffect(() => { load(); }, [load]);

  const ensure = async () => {
    setBusy(true);
    try {
      await axios.post(`${API_URL}/storage/me/ensure`, {}, cred);
      toast.success("Klasörler doğrulandı.");
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusy(false);
    }
  };

  const addFolder = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await axios.post(`${API_URL}/storage/me/folders`, { label: label.trim() }, cred);
      toast.success("Klasör eklendi.");
      setLabel("");
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Klasör eklenemedi.");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="text-xs text-slate-400 p-4">Yükleniyor…</div>;

  return (
    <div className="space-y-4 text-xs" data-testid="my-storage-panel">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-slate-900">Depolama alanları</div>
            <div className="text-slate-500 mt-0.5">
              {fmtBytes(data.total_bytes)} kullanılıyor
              {data.storage_limit_mb ? ` · kota ${data.storage_limit_mb} MB` : " · sınırsız"}
              {" · "}{data.total_files} dosya
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={ensure}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg font-bold disabled:opacity-60"
            data-testid="my-storage-ensure"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Klasörleri doğrula
          </button>
        </div>
        <QuotaBar
          used={Number(((data.total_bytes || 0) / (1024 * 1024)).toFixed(1))}
          limit={data.storage_limit_mb || 0}
          testId="my-storage-quota"
        />
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[10px] text-slate-500 mb-0.5">Özel klasör</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder="Klasör adı" data-testid="my-storage-folder-name" />
        </div>
        <button type="button" disabled={busy || !label.trim()} onClick={addFolder} className="px-3 py-2 bg-emerald-600 text-white rounded-lg font-bold disabled:opacity-60" data-testid="my-storage-add-folder">
          Ekle
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(data.folders || []).map((f) => (
          <div key={f.id} className="bg-white border border-slate-200 rounded-2xl p-3" data-testid={`my-storage-folder-${f.area_key}`}>
            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
              <FolderOpen className="w-4 h-4 text-amber-500" /> {f.label}
            </div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">{f.path}</div>
            <div className="text-[10px] text-slate-500 mt-1">{f.file_count} dosya · {fmtBytes(f.bytes)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";

export const POLL_MS = 2000;

const cred = { withCredentials: true };
const tl = (n) => Number(n || 0).toLocaleString("tr-TR");

const MODE_CLASS = {
  legacy: "bg-amber-100 text-amber-800",
  shared_v2: "bg-sky-100 text-sky-800",
  dedicated: "bg-violet-100 text-violet-700",
};

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b >= 1024 * 1024) {
    const mb = b / (1024 * 1024);
    if (mb >= 10) return `≈ ${Math.round(mb).toLocaleString("tr-TR")} MB`;
    return `${mb.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
  }
  if (b >= 1024) return `${Math.round(b / 1024).toLocaleString("tr-TR")} KB`;
  return `${b} B`;
}

export function formatLogin(iso, now = new Date()) {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  if (dt.toDateString() === now.toDateString()) {
    return `Bugün ${dt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return dt.toLocaleDateString("tr-TR");
}

function ModeChip({ mode }) {
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${MODE_CLASS[mode] || "bg-slate-100 text-slate-600"}`}>
      {mode || "—"}
    </span>
  );
}

function Growth({ pct }) {
  if (pct == null || Math.abs(Number(pct)) < 0.5) {
    return <span className="text-slate-400">● sabit</span>;
  }
  const n = Math.round(Number(pct));
  return <span className="text-rose-600 font-semibold">▲ %{Math.abs(n)}</span>;
}

function detailOf(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail.detail === "string") return detail.detail;
  return fallback;
}

export function DatabaseManagementView({
  data,
  onDryRun,
  onApply,
  onRollback,
  onRecover,
  onCancel,
  onSaveThresholds,
  onResetThresholds,
  onPrepare,
}) {
  const [modeFilter, setModeFilter] = useState("all");
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [form, setForm] = useState(data.thresholds);
  const serverThresholds = JSON.stringify(data.thresholds || {});
  const seenThresholds = useRef(serverThresholds);
  const [confirm, setConfirm] = useState(null);
  const [prepare, setPrepare] = useState(null);
  const [ack, setAck] = useState(false);
  const [ackPrepare, setAckPrepare] = useState(false);

  useEffect(() => {
    if (seenThresholds.current === serverThresholds) return;
    seenThresholds.current = serverThresholds;
    setForm(data.thresholds);
  }, [serverThresholds, data.thresholds]);

  const rows = useMemo(() => {
    return (data.companies || []).filter((row) => {
      if (modeFilter !== "all" && row.mode !== modeFilter) return false;
      if (onlyDiff && row.recommended === row.mode) return false;
      return true;
    });
  }, [data.companies, modeFilter, onlyDiff]);

  const totals = data.totals || {};
  const modes = totals.modes || {};
  const routerOn = !!data.router_enabled;
  const openMove = (row) => {
    setAck(false);
    setConfirm(row);
  };

  return (
    <div className="space-y-4 text-xs text-slate-800" data-testid="dbm-page">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Veritabanı Yönetimi</h2>
        <p className="text-[11px] text-slate-500 mt-1 max-w-3xl">
          Firmaların depolama modlarını izleyin, eşikleri yönetin ve güvenli taşıma yapın. Taşıma sırasında firma yazmaya kilitlenir; sonunda checksum ve kayıt sayısı doğrulanır.
        </p>
        <p className="text-[10px] text-slate-400 mt-1" data-testid="dbm-measured-at">
          Son ölçüm: {data.measured_at ? formatLogin(data.measured_at) : "henüz yok"}
        </p>
      </div>

      {!routerOn && (
        <p className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2" data-testid="dbm-router-off">
          Depolama yönlendiricisi kapalı. Taşı ve Geri al yazılmaz; deneme çalıştırılabilir.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-3" data-testid="dbm-card-companies">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Toplam Firma</div>
          <div className="text-2xl font-bold mt-1">{tl(totals.companies)}</div>
          <div className="text-[11px] text-slate-500">{tl(totals.real)} gerçek · {tl(totals.test)} test hesabı</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3" data-testid="dbm-card-modes">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Mod Dağılımı</div>
          <div className="flex flex-wrap gap-1 mt-2">
            <span className={MODE_CLASS.legacy + " inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-semibold"}>legacy {modes.legacy || 0}</span>
            <span className={MODE_CLASS.shared_v2 + " inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-semibold"}>shared_v2 {modes.shared_v2 || 0}</span>
            <span className={MODE_CLASS.dedicated + " inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-semibold"}>dedicated {modes.dedicated || 0}</span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3" data-testid="dbm-card-bytes">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Toplam Veri</div>
          <div className="text-2xl font-bold mt-1">{formatBytes(totals.bytes)}</div>
          <div className="text-[11px] text-slate-500">{tl(totals.files)} dosya / {formatBytes(totals.file_bytes)} · {tl(totals.records)} kayıt</div>
        </div>
        <div className={`bg-white rounded-2xl p-3 border ${totals.running ? "border-emerald-300" : "border-slate-200"}`} data-testid="dbm-card-running">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Devam Eden Taşıma</div>
          <div className="text-2xl font-bold mt-1 text-emerald-700">{tl(totals.running)}</div>
          <div className="text-[11px] text-slate-500">{totals.running_label || "Yok"}</div>
        </div>
      </div>

      <section className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2" data-testid="dbm-table">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-sm">Firmalar</h3>
          <div className="flex flex-wrap gap-2">
            <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)} className={inputCls + " w-auto"} data-testid="dbm-mode-filter">
              <option value="all">Tüm modlar</option>
              <option value="legacy">legacy</option>
              <option value="shared_v2">shared_v2</option>
              <option value="dedicated">dedicated</option>
            </select>
            <button type="button" onClick={() => setOnlyDiff((v) => !v)} className={`px-2.5 py-1.5 rounded-lg border font-semibold ${onlyDiff ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`} data-testid="dbm-diff-filter">
              Yalnızca öneri farkı olanlar
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left">
            <thead className="text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                {["Firma", "Mod", "Kayıt", "Veri", "Dosya", "Kull.", "Son Giriş", "Büyüme (30 g)", "Önerilen Mod / Neden", "Aksiyon"].map((label) => (
                  <th key={label} className="py-2 pr-2 font-semibold">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top" data-testid={`dbm-row-${row.id}`}>
                  <td className="py-2 pr-2">
                    <div className="font-semibold">{row.name}</div>
                    <div className="text-[10px] text-slate-400">{row.id}{row.test ? " · test hesabı · örnek veri" : ""}</div>
                  </td>
                  <td className="py-2 pr-2">
                    {row.moving || row.scheduled ? (
                      <span className="text-[10px] font-semibold">{row.mode} → {row.mode_to}</span>
                    ) : (
                      <ModeChip mode={row.mode} />
                    )}
                  </td>
                  <td className="py-2 pr-2">{row.measured_at ? tl(row.records) : "—"}</td>
                  <td className="py-2 pr-2">
                    <div>{row.measured_at ? formatBytes(row.bytes) : "—"}</div>
                    {row.largest?.name && <div className="text-[10px] text-slate-400">{row.largest.name} {formatBytes(row.largest.bytes)}</div>}
                  </td>
                  <td className="py-2 pr-2">{row.files ? `${tl(row.files)} / ${formatBytes(row.file_bytes)}` : "—"}</td>
                  <td className="py-2 pr-2">{row.measured_at ? tl(row.users) : "—"}</td>
                  <td className="py-2 pr-2 whitespace-nowrap">{formatLogin(row.last_login_at)}</td>
                  <td className="py-2 pr-2"><Growth pct={row.growth_pct} /></td>
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <ModeChip mode={row.recommended} />
                      {row.suitable && <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-semibold">uygun</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 max-w-[220px]">{row.reason}</div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap gap-1">
                      {row.moving && <button type="button" disabled className="px-2 py-1 rounded-lg border border-slate-200 text-slate-400">Taşınıyor...</button>}
                      {row.scheduled && <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700">Planlandı</span>}
                      {row.actions?.dry_run && (
                        <button type="button" className="px-2 py-1 rounded-lg border border-slate-200 font-semibold" data-testid={`dbm-dry-run-${row.id}`} onClick={() => onDryRun(row)}>
                          Deneme çalıştır
                        </button>
                      )}
                      {row.actions?.apply && (
                        <button
                          type="button"
                          disabled={!routerOn}
                          title={routerOn ? "Taşımayı onayla" : "Depolama yönlendiricisi kapalı"}
                          className="px-2 py-1 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-40"
                          data-testid={`dbm-apply-${row.id}`}
                          onClick={() => routerOn && openMove(row)}
                        >
                          Taşı
                        </button>
                      )}
                      {row.actions?.rollback && (
                        <button
                          type="button"
                          disabled={!routerOn}
                          title={routerOn ? "Geri al" : "Depolama yönlendiricisi kapalı"}
                          className="px-2 py-1 rounded-lg border border-slate-200 font-semibold disabled:opacity-40"
                          data-testid={`dbm-rollback-${row.id}`}
                          onClick={() => routerOn && onRollback(row)}
                        >
                          Geri al
                        </button>
                      )}
                      {row.actions?.prepare && !row.has_dedicated_dsn && (
                        <button type="button" className="px-2 py-1 rounded-lg border border-violet-200 text-violet-700 font-semibold" data-testid={`dbm-prepare-${row.id}`} onClick={() => { setAckPrepare(false); setPrepare(row); }}>
                          Hedefi hazırla
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={10} className="py-6 text-center text-slate-400">Bu süzgeçte firma yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-3">
        <section className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2" data-testid="dbm-thresholds">
          <h3 className="font-bold text-sm">Eşik Ayarları <span className="font-normal text-slate-400">herhangi biri aşılırsa dedicated</span></h3>
          {[
            ["records", "Kayıt sayısı eşiği", "kayıt"],
            ["data_mb", "Veri boyutu eşiği", "MB"],
            ["users", "Kullanıcı sayısı eşiği", "kullanıcı"],
            ["growth_pct", "Büyüme uyarısı", "30 günde % üzeri"],
          ].map(([key, label, unit]) => (
            <label key={key} className="block">
              <span className="text-[10px] text-slate-500">{label}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={form?.[key] ?? ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  className={inputCls}
                  data-testid={`dbm-threshold-${key}`}
                />
                <span className="text-[10px] text-slate-400 whitespace-nowrap">{unit}</span>
              </div>
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <button type="button" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold" data-testid="dbm-threshold-save" onClick={() => onSaveThresholds({
              records: Number(form.records),
              data_mb: Number(form.data_mb),
              users: Number(form.users),
              growth_pct: Number(form.growth_pct),
            })}>Kaydet</button>
            <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold" data-testid="dbm-threshold-reset" onClick={onResetThresholds}>Varsayılana dön</button>
          </div>
          <p className="text-[10px] text-slate-400">Eşik değişikliği yalnızca öneriyi etkiler; taşıma her zaman manuel onay ister.</p>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2" data-testid="dbm-history">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-sm">Taşıma Geçmişi ve İzleme</h3>
            <span className="text-[10px] text-slate-400">storage_move</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  {["move_id", "Firma / Yön", "Başlangıç – Bitiş", "İlerleme", "Kilit", "Checksum", ""].map((label) => (
                    <th key={label || "act"} className="py-2 pr-2 font-semibold">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.moves || []).map((move) => (
                  <tr key={`${move.job_id || ""}-${move.move_id}`} className="border-t border-slate-100 align-top" data-testid={`dbm-move-${move.move_id}`}>
                    <td className="py-2 pr-2 font-mono text-[10px]">{move.move_id}</td>
                    <td className="py-2 pr-2">
                      <div className="font-semibold">{move.company_name}{move.test ? " (örnek)" : ""}</div>
                      <div className="text-[10px] text-slate-500">{move.from_mode} → {move.to_mode}</div>
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">{formatLogin(move.started_at)} – {move.finished_at ? formatLogin(move.finished_at) : "sürüyor"}</td>
                    <td className="py-2 pr-2" data-testid={`dbm-progress-${move.move_id}`}>
                      <div>{move.progress_label}</div>
                      <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                        <div className={`h-full ${move.checksum_ok === false || move.status === "failed" ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${Math.max(0, Math.min(100, Number(move.progress_pct) || 0))}%` }} />
                      </div>
                    </td>
                    <td className="py-2 pr-2">{move.lock_label}</td>
                    <td className={`py-2 pr-2 ${move.checksum_ok === false ? "text-rose-600" : move.checksum_ok ? "text-emerald-700" : "text-slate-500"}`}>{move.checksum_label}</td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-wrap gap-1">
                        {move.scheduled && (
                          <button type="button" className="px-2 py-1 rounded-lg border border-rose-200 text-rose-600 font-semibold" data-testid={`dbm-cancel-${move.job_id}`} onClick={() => onCancel(move)}>İptal</button>
                        )}
                        {move.status === "running" && (
                          <button type="button" disabled={!routerOn} className="px-2 py-1 rounded-lg border border-slate-200 font-semibold disabled:opacity-40" data-testid={`dbm-recover-${move.move_id}`} onClick={() => routerOn && onRecover(move)}>Kurtar</button>
                        )}
                        {move.status === "completed" && (
                          <button type="button" disabled={!routerOn} className="px-2 py-1 rounded-lg border border-slate-200 font-semibold disabled:opacity-40" onClick={() => routerOn && onRollback({ id: move.company_id, actions: { rollback_move_id: move.move_id } })}>Geri al</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {(data.moves || []).length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-slate-400">Taşıma kaydı yok.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-3" data-testid="dbm-confirm">
          <div role="dialog" aria-modal="true" className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 space-y-3 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-bold text-sm">Taşımayı Onayla — {confirm.name} ({confirm.id})</h3>
              <button type="button" className="text-slate-400" onClick={() => setConfirm(null)} data-testid="dbm-confirm-close">×</button>
            </div>
            <div className="flex flex-wrap gap-1 text-[10px]">
              <ModeChip mode={confirm.mode} />
              <span>→</span>
              <ModeChip mode={confirm.actions?.to_mode} />
              <span className="text-slate-500">{confirm.reason}</span>
            </div>
            <div className="border border-slate-100 rounded-xl p-3 space-y-1">
              <div className="flex justify-between font-semibold"><span>Deneme sonucu (--dry-run)</span>{confirm.last_dry_run?.ok && <span className="text-emerald-600">Başarılı · {formatLogin(confirm.last_dry_run.at)}</span>}</div>
              {confirm.last_dry_run?.ok ? (
                <>
                  <div className="flex justify-between"><span>Koleksiyon</span><span>{tl(confirm.last_dry_run.collections)}</span></div>
                  <div className="flex justify-between"><span>Kayıt</span><span>{tl(confirm.last_dry_run.records)}</span></div>
                  <div className="flex justify-between"><span>Veri</span><span>{formatBytes(confirm.last_dry_run.bytes)}</span></div>
                  <div className="flex justify-between"><span>Dosya</span><span>{tl(confirm.last_dry_run.files)} dosya / {formatBytes(confirm.last_dry_run.file_bytes)}</span></div>
                  {confirm.last_dry_run.warning && <p className="text-amber-700">{confirm.last_dry_run.warning}</p>}
                </>
              ) : (
                <p className="text-amber-700" data-testid="dbm-dry-required">Son deneme sonucu yok. Taşıma için önce deneme zorunlu.</p>
              )}
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-1">
              <div className="flex justify-between"><span>Tahmini yazma kilidi</span><span className="font-semibold">{confirm.estimate?.label || "—"}</span></div>
              <div className="flex justify-between gap-3"><span>Önerilen bakım saati</span><span className="font-semibold text-right">{data.maintenance?.label}</span></div>
              <p className="text-[10px] text-slate-500">{tl(confirm.users)} kullanıcı kilit süresince okuma yapabilir.</p>
            </div>
            <pre className="bg-slate-50 rounded-xl p-2 text-[10px] overflow-x-auto whitespace-pre-wrap">{`python -m scripts.storage_move --company ${confirm.id} --to ${confirm.actions?.to_mode} --apply\nSonunda koleksiyon bazında checksum + kayıt sayısı doğrulanır; move_id ile geri alınabilir.`}</pre>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="dbm-confirm-check" />
              <span>Deneme sonucunu inceledim; firmanın taşıma süresince yazmaya kilitleneceğini anlıyorum.</span>
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-200" onClick={() => setConfirm(null)}>Vazgeç</button>
              {!confirm.last_dry_run?.ok && (
                <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold" data-testid="dbm-confirm-dry" onClick={() => { onDryRun(confirm); setConfirm(null); }}>Deneme çalıştır</button>
              )}
              <button type="button" disabled={!ack || !confirm.last_dry_run?.ok || !routerOn} className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold disabled:opacity-40" data-testid="dbm-schedule" onClick={() => { onApply(confirm, "maintenance"); setConfirm(null); }}>Bakım saatine planla</button>
              <button type="button" disabled={!ack || !confirm.last_dry_run?.ok || !routerOn} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-40" data-testid="dbm-move-now" onClick={() => { onApply(confirm, "now"); setConfirm(null); }}>Şimdi Taşı</button>
            </div>
          </div>
        </div>
      )}

      {prepare && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-3" data-testid="dbm-prepare-dialog">
          <div role="dialog" aria-modal="true" className="bg-white rounded-2xl w-full max-w-lg p-4 space-y-3 shadow-xl">
            <h3 className="font-bold text-sm">Dedicated hedef — {prepare.name}</h3>
            <p className="text-slate-600">Yeni veritabanı ve yalnız o veritabanına yetkili kullanıcı oluşturulur. Migration yalnızca bu hedefe uygulanır. Bağlantı uygulamanın şifreleme yardımcısıyla mühürlenir. Yönetici yetkisi yoksa işlem durur.</p>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={ackPrepare} onChange={(e) => setAckPrepare(e.target.checked)} data-testid="dbm-prepare-check" />
              <span>Ayrı veritabanı hazırlığını onaylıyorum.</span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-200" onClick={() => setPrepare(null)}>Vazgeç</button>
              <button type="button" disabled={!ackPrepare} className="px-3 py-1.5 rounded-lg bg-violet-700 text-white font-bold disabled:opacity-40" data-testid="dbm-prepare-go" onClick={() => { onPrepare(prepare); setPrepare(null); }}>Hazırla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function DatabaseManagementPanel() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/system/storage-admin`, cred);
      setData(response.data);
      setLoadError("");
    } catch (error) {
      setLoadError(detailOf(error, "Veritabanı yönetimi alınamadı."));
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const send = useCallback(async (method, url, body) => {
    try {
      await axios({ method, url, data: body || {}, ...cred });
      await load();
    } catch (error) {
      toast.error(detailOf(error, "İşlem yapılamadı."));
    }
  }, [load]);

  if (!data && loadError) return <div className="text-xs text-rose-600" data-testid="dbm-error">{loadError}</div>;
  if (!data) return <div className="text-xs text-slate-400" data-testid="dbm-loading">Yükleniyor…</div>;

  return (
    <DatabaseManagementView
      data={data}
      onDryRun={(company) => send("post", `${API_URL}/system/storage-admin/companies/${company.id}/dry-run`, { to_mode: company.actions?.to_mode })}
      onApply={(company, when) => send("post", `${API_URL}/system/storage-admin/companies/${company.id}/apply`, { to_mode: company.actions?.to_mode, when })}
      onRollback={(company) => send("post", `${API_URL}/system/storage-admin/companies/${company.id}/rollback`, { move_id: company.actions?.rollback_move_id })}
      onRecover={(move) => send("post", `${API_URL}/system/storage-admin/moves/${move.move_id}/recover`, {})}
      onCancel={(move) => send("post", `${API_URL}/system/storage-admin/jobs/${move.job_id}/cancel`, {})}
      onSaveThresholds={(values) => send("put", `${API_URL}/system/storage-admin/thresholds`, values)}
      onResetThresholds={() => send("post", `${API_URL}/system/storage-admin/thresholds/reset`, {})}
      onPrepare={(company) => send("post", `${API_URL}/system/storage-admin/companies/${company.id}/prepare-dedicated`, { confirm: true })}
    />
  );
}

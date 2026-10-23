import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import {
  EDITOR_GROUPS, FEATURE_GROUPS, LEVELS, ROLE_TEMPLATES,
  applyRowLevel, editorOverflowGuard, rowLevel, visibleRows,
} from "./roleEditorModel";
import { helpFor } from "./roleHelpContent";
import { RoleSummaryStrip } from "./roles/RoleSummaryPanel";

const ON = {
  none: "bg-white text-slate-700 shadow-[0_0_0_1px_#cbd5e1]",
  view: "bg-blue-100 text-blue-700",
  edit: "bg-emerald-100 text-emerald-700",
  delete: "bg-red-100 text-red-700",
};

function Segment({ value, disabled, onChange, testPrefix, compact }) {
  return (
    <div
      className={`inline-flex max-w-full flex-wrap bg-slate-100 rounded-lg p-0.5 min-[701px]:max-w-none min-[701px]:flex-nowrap min-[701px]:whitespace-nowrap min-[701px]:shrink-0 ${compact ? "" : "shrink-0"}`}
      role="group"
      data-testid={testPrefix}
    >
      {LEVELS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(key)}
          className={`whitespace-nowrap px-1 py-0.5 rounded-md text-[11px] leading-4 font-semibold tracking-tight disabled:cursor-default ${value === key ? ON[key] : "text-slate-500 hover:text-slate-700"}`}
          data-testid={testPrefix ? `${testPrefix}-${key}` : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function RoleEditor({ companyId, rolesData, reload }) {
  const roles = rolesData?.roles || [];
  const [sel, setSel] = useState(roles[0]?.id || "");
  const [query, setQuery] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [helpKey, setHelpKey] = useState("");
  const [newRole, setNewRole] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState(null);
  const role = roles.find((item) => item.id === sel) || roles[0];
  const locked = role?.code === "admin";
  const unwired = useMemo(() => new Set((rolesData?.modules || []).filter((mod) => mod.wired === false).map((mod) => mod.key)), [rolesData]);

  useEffect(() => {
    if (!role) { setDraft(null); return; }
    setDraft({
      permissions: { ...(role.permissions || {}) },
      features: { ...(role.features || {}) },
      template: role.code || "",
    });
    setHelpKey("");
  }, [role]);

  const perms = draft?.permissions || {};
  const features = draft?.features || {};
  const featureList = rolesData?.features || [];
  const featureByKey = Object.fromEntries(featureList.map((item) => [item.key, item]));
  const advancedCount = featureList.length;

  const setRow = (keys, level) => {
    if (locked) return;
    setDraft((cur) => ({ ...cur, permissions: applyRowLevel(cur.permissions, keys, level), template: "" }));
  };
  const setGroup = (rows, level) => {
    if (locked) return;
    setDraft((cur) => {
      let permissions = { ...cur.permissions };
      rows.forEach((row) => { permissions = applyRowLevel(permissions, row.keys, level); });
      return { ...cur, permissions, template: "" };
    });
  };
  const setFeature = (key, value) => {
    if (locked) return;
    setDraft((cur) => ({ ...cur, features: { ...cur.features, [key]: value } }));
  };
  const applyTemplate = (code) => {
    if (locked) return;
    const source = roles.find((item) => item.code === code);
    if (!source) { toast.error("Bu şablon şirkette yok."); return; }
    setDraft((cur) => ({
      ...cur,
      permissions: { ...(source.permissions || {}) },
      features: { ...(source.features || {}) },
      template: code,
    }));
  };

  const save = async () => {
    if (!role || locked || !draft) return;
    try {
      await axios.put(`${API_URL}/roles/${role.id}`, { permissions: draft.permissions, features: draft.features });
      toast.success("Rol kaydedildi.");
      await reload();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    }
  };
  const revert = () => {
    if (!role) return;
    setDraft({ permissions: { ...(role.permissions || {}) }, features: { ...(role.features || {}) }, template: role.code || "" });
  };
  const addRole = async (event) => {
    event.preventDefault();
    try {
      const response = await axios.post(`${API_URL}/roles`, { company_id: companyId, name: newRole, permissions: {} });
      toast.success("Rol oluşturuldu.");
      setNewRole("");
      setShowNew(false);
      await reload();
      if (response.data?.id) setSel(response.data.id);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Oluşturulamadı.");
    }
  };
  const remove = async () => {
    if (!role || role.is_system) return;
    if (!window.confirm(`${role.name} rolü silinsin mi?`)) return;
    try {
      await axios.delete(`${API_URL}/roles/${role.id}`);
      toast.success("Rol silindi.");
      setSel(roles[0]?.id || "");
      await reload();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    }
  };

  const help = helpKey ? helpFor(helpKey) : null;
  const q = query.trim().toLocaleLowerCase("tr");

  return (
    <div className={`grid grid-cols-1 items-start gap-4 text-[13px] leading-5 min-[701px]:grid-cols-[210px_minmax(0,1fr)] ${editorOverflowGuard()}`} data-testid="role-editor">
      <div className="hidden min-[701px]:block w-full min-w-0 bg-white border border-slate-200 rounded-[14px] p-2.5" data-testid="role-list">
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Roller</div>
        {roles.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSel(item.id)}
            className={`w-full text-left text-[13px] leading-5 px-2 py-1.5 rounded-[9px] mt-0.5 flex justify-between gap-2 ${item.id === role?.id ? "bg-emerald-50 text-emerald-700 font-bold" : "hover:bg-slate-50"}`}
            data-testid={`role-btn-${item.code}`}
          >
            <span className="truncate">{item.name}{!item.is_system && <span className="ml-1 text-[9px] font-normal opacity-60">özel</span>}</span>
            <small className="text-slate-400 font-normal">{item.user_count || 0}</small>
          </button>
        ))}
        <button type="button" onClick={() => setShowNew((open) => !open)} className="mt-2 w-full border border-slate-300 rounded-[10px] px-2.5 py-1.5 text-[13px] leading-5 font-semibold bg-white" data-testid="new-role-toggle">+ Yeni rol</button>
        {showNew && (
          <form onSubmit={addRole} className="space-y-1.5 pt-2" data-testid="new-role-form">
            <input value={newRole} onChange={(event) => setNewRole(event.target.value)} placeholder="Rol adı" className="w-full border rounded-lg p-2" required data-testid="new-role-input" />
            <button className="w-full flex items-center justify-center gap-1 px-2 py-2 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="new-role-add"><Plus className="w-4 h-4" /> Rolü Oluştur</button>
          </form>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-[14px] px-2 py-2.5 min-w-0 max-w-full" data-testid="role-matrix">
        <div className="min-[701px]:hidden mb-3">
          <label className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500" htmlFor="role-switch-mobile">Rol</label>
          <select id="role-switch-mobile" value={role?.id || ""} onChange={(event) => setSel(event.target.value)} className="mt-1 w-full max-w-full border border-slate-300 rounded-[10px] p-2 bg-white" data-testid="role-switch-mobile">
            {roles.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.user_count || 0})</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-2.5 min-w-0">
          <div className="min-w-0">
            <h2 className="m-0 text-[15px] font-bold leading-5 text-slate-900 break-words" data-testid="role-editor-title">{role?.name || "Rol"}</h2>
            <div className="text-[12px] leading-4 text-slate-500 mt-0.5">{role?.user_count || 0} kullanıcı</div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button type="button" onClick={revert} className="border border-slate-300 rounded-lg px-2.5 py-1 text-[13px] leading-5 font-semibold bg-white" data-testid="role-cancel">Vazgeç</button>
            <button type="button" onClick={save} disabled={locked} className="rounded-lg px-2.5 py-1 text-[13px] leading-5 font-semibold bg-emerald-600 text-white border border-emerald-600 disabled:opacity-50" data-testid="role-save">Kaydet</button>
          </div>
        </div>
        <RoleSummaryStrip perms={perms} features={features} userCount={role?.user_count || 0} />
        {!role?.is_system && (
          <button type="button" onClick={remove} className="mt-2 text-rose-600 flex items-center gap-1 text-xs" data-testid="role-delete"><Trash2 className="w-3.5 h-3.5" /> Rolü sil</button>
        )}
        {locked && <div className="text-[11px] text-slate-500 mt-2">Yönetici tüm modüllerde tam yetkilidir; değiştirilemez.</div>}

        <div className="flex gap-1.5 flex-wrap mt-2" data-testid="role-templates">
          <span className="text-[11px] text-slate-500 self-center">Şablondan başla:</span>
          {ROLE_TEMPLATES.map((tpl) => (
            <button
              key={tpl.code}
              type="button"
              disabled={locked}
              onClick={() => applyTemplate(tpl.code)}
              className={`border border-slate-200 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium ${draft?.template === tpl.code ? "bg-slate-900 text-white border-slate-900" : "text-slate-600 bg-white"}`}
              data-testid={`role-template-${tpl.code}`}
            >
              {tpl.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 my-3 min-w-0">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={'Yetki ara… (ör. "fiyat", "kargo", "sil")'}
            className="flex-1 min-w-0 border border-slate-300 rounded-[10px] px-2.5 py-1 text-[13px] leading-5 text-slate-700 bg-white"
            data-testid="role-search"
          />
          <button type="button" onClick={() => setOpenOnly((on) => !on)} className={`hidden min-[701px]:inline-flex items-center border rounded-[10px] px-2.5 py-1 text-[13px] leading-5 font-semibold whitespace-nowrap ${openOnly ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300"}`} data-testid="role-open-only">
            Yalnız açık olanlar
          </button>
        </div>

        {EDITOR_GROUPS.map((group) => {
          const rows = visibleRows(group, { query, openOnly, perms, unwired });
          if (!rows.length) return null;
          return (
            <div key={group.id} className="border border-slate-200 rounded-xl mb-2 overflow-hidden" data-testid={`role-group-${group.id}`}>
              <div className="bg-slate-50 px-2 py-1.5 flex flex-nowrap items-center justify-between gap-1.5 min-w-0 overflow-x-auto" data-testid={`role-group-head-${group.id}`}>
                <span className="whitespace-nowrap shrink-0 text-[13px] leading-5 font-extrabold text-slate-900" data-testid={`role-group-label-${group.id}`}>{group.icon} {group.label}</span>
                <span className="ml-auto inline-flex shrink-0 flex-nowrap items-center justify-end gap-1.5">
                  <span className="hidden min-[701px]:inline-flex flex-nowrap items-center gap-1 whitespace-nowrap shrink-0 font-medium text-slate-400 text-[11px] leading-4" data-testid={`role-group-all-${group.id}`}>
                    <span className="whitespace-nowrap">Grubun tümü:</span>
                    <Segment compact disabled={locked} value="" onChange={(level) => setGroup(rows, level)} testPrefix={`perm-group-${group.id}`} />
                  </span>
                  <button type="button" className="whitespace-nowrap shrink-0 text-blue-600 text-[11px] leading-4 font-semibold" onClick={() => setHelpKey(rows[0].key)} data-testid={`role-help-group-${group.id}`}>? Açıklama</button>
                </span>
              </div>
              {rows.map((row) => {
                const state = rowLevel(perms, row.keys);
                return (
                  <div key={row.key} className="flex flex-col min-[701px]:flex-row min-[701px]:items-center min-[701px]:justify-between gap-1.5 px-2.5 py-1.5 border-t border-slate-100 min-w-0" data-testid={`perm-row-${row.key}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 min-w-0">
                        <button type="button" className="min-w-0 truncate whitespace-nowrap text-left text-[13px] leading-5 font-semibold text-slate-900" onClick={() => setHelpKey(row.key)}>{row.title}</button>
                        {state.mixed && <span className="shrink-0 rounded bg-amber-50 px-1 py-px text-[10px] font-bold leading-none text-amber-700" data-testid={`perm-mixed-${row.key}`}>karışık</span>}
                      </div>
                      <small className="block truncate whitespace-nowrap text-slate-500 text-[11px] leading-4">{row.help}</small>
                    </div>
                    <Segment value={state.level} disabled={locked} onChange={(level) => setRow(row.keys, level)} testPrefix={`perm-${row.key}`} />
                  </div>
                );
              })}
            </div>
          );
        })}

        <div className="border border-dashed border-amber-400 bg-amber-50 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3" data-testid="role-advanced">
          <div className="min-w-0">
            <div className="font-bold">▸ Gelişmiş ayarlar ({advancedCount})</div>
            <small className="block font-normal text-amber-800">Fiyat gizleme, personel portalı, kısayollar, sipariş butonları, hesap. Varsayılan kapalı görünüm.</small>
          </div>
          <button type="button" className="text-blue-600 text-[11px] font-semibold shrink-0" onClick={() => setAdvanced((open) => !open)} data-testid="role-advanced-toggle">{advanced ? "Kapat" : "Aç"}</button>
        </div>
        {advanced && (
          <div className="mt-2 space-y-2" data-testid="role-advanced-panel">
            {FEATURE_GROUPS.map((group) => {
              const items = group.keys.map((key) => featureByKey[key]).filter(Boolean).filter((item) => {
                if (!q) return true;
                return `${item.label} ${item.help || ""} ${group.title}`.toLocaleLowerCase("tr").includes(q);
              });
              if (!items.length) return null;
              return (
                <div key={group.id} className="border border-slate-200 rounded-xl p-2.5">
                  <div className="text-[11px] font-extrabold text-slate-600 mb-1.5">{group.title}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {items.map((item) => (
                      <label key={item.key} className="flex items-start gap-2 bg-white border rounded-lg px-2.5 py-1.5 min-w-0" title={item.help} data-testid={item.group === "portal" ? `portal-feature-row-${item.key}` : `feature-row-${item.key}`}>
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={features[item.key] === true || (item.group !== "portal" && features[item.key] !== false)}
                          onChange={(event) => setFeature(item.key, event.target.checked)}
                          className="mt-0.5 accent-emerald-600"
                          data-testid={item.group === "portal" ? `portal-feature-toggle-${item.key}` : `feature-toggle-${item.key}`}
                        />
                        <span className="min-w-0"><span className="font-semibold text-slate-800">{item.label}</span>{item.help && <span className="block text-[10px] text-slate-500 leading-tight">{item.help}</span>}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {help && (
        <div className="fixed inset-0 z-40" data-testid="role-help-drawer">
          <button type="button" className="absolute inset-0 bg-slate-900/35" aria-label="Yardımı kapat" onClick={() => setHelpKey("")} />
          <aside className="absolute right-0 top-0 bottom-0 w-full min-[701px]:w-[440px] max-w-full bg-white border-l border-slate-200 shadow-xl p-5 overflow-auto">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Yardım · {help.group}</span>
              <button type="button" onClick={() => setHelpKey("")} className="font-bold" data-testid="role-help-close">✕</button>
            </div>
            <h2 className="text-lg font-bold mt-2">{help.title}</h2>
            <p className="leading-relaxed text-slate-700 mt-2">{help.body}</p>
            {LEVELS.map(([key, label]) => (
              <div key={key} className={`border border-slate-200 rounded-[10px] px-2.5 py-2 my-1.5 ${key === "view" ? "bg-blue-50" : key === "edit" ? "bg-emerald-50" : key === "delete" ? "bg-red-50" : ""}`}>
                <b>{label}</b> — {help.levels?.[key]}
              </div>
            ))}
            {help.shot && (
              <div className="border-2 border-dashed border-slate-300 rounded-xl h-[150px] flex items-center justify-center text-center text-xs text-slate-400 my-2.5 bg-slate-50 px-3">
                Ekran görüntüsü yer tutucu<br />{help.shot}
              </div>
            )}
            {help.tip && <p><b>İpucu:</b> {help.tip}</p>}
            {help.related && <p className="text-xs text-slate-500">{help.related}</p>}
          </aside>
        </div>
      )}
    </div>
  );
}

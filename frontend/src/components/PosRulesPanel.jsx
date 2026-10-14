import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { KeyRound, Loader2, Save, ShoppingCart } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { pinIsValid } from "../utils/posCashier";
import { MoneyInput } from "./MoneyInput";

const BOOLS = [
  ["can_change_price", "Fiyat değiştirme"],
  ["can_refund", "İade"],
  ["can_cancel", "İptal (sepet / satış)"],
  ["can_credit_sale", "Veresiye satış"],
  ["can_exit", "Çıkış serbest"],
  ["can_delete_line", "Satır silme"],
  ["can_out_of_stock", "Stoksuz satış"],
  ["can_open_drawer", "Satışsız çekmece"],
  ["can_approve", "Yönetici onayı verebilir"],
];

export function PosRulesPanel({ companyId }) {
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState([]);
  const [idle, setIdle] = useState(120);
  const [cashiers, setCashiers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pinFor, setPinFor] = useState(null);
  const [pin, setPin] = useState("");

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([
      axios.get(`${API_URL}/pos/rules`, { params: { company_id: companyId } }),
      axios.get(`${API_URL}/pos/cashiers`, { params: { company_id: companyId } }),
    ]);
    setData(r.data);
    setRoles((r.data.roles || []).map((x) => ({ ...x, pos_rules: { ...(x.pos_rules || {}) } })));
    setIdle(r.data.idle_timeout_sec || 120);
    setCashiers(Array.isArray(c.data) ? c.data : []);
  }, [companyId]);

  useEffect(() => { load().catch(() => toast.error("POS kuralları yüklenemedi.")); }, [load]);

  const setRule = (code, key, value) => {
    setRoles((prev) => prev.map((r) => (r.code === code ? { ...r, pos_rules: { ...r.pos_rules, [key]: value } } : r)));
  };

  const save = async () => {
    setBusy(true);
    try {
      await axios.put(`${API_URL}/pos/rules`, {
        company_id: companyId,
        idle_timeout_sec: idle,
        roles: roles.map((r) => ({ id: r.id, code: r.code, pos_rules: r.pos_rules })),
      });
      toast.success("Hızlı Satış kuralları kaydedildi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const savePin = async (e) => {
    e.preventDefault();
    if (!pinFor || !pinIsValid(pin)) return;
    setBusy(true);
    try {
      await axios.post(`${API_URL}/pos/cashiers/${pinFor.id}/pin`, { company_id: companyId, pin });
      toast.success("Kasiyer PIN kaydedildi.");
      setPinFor(null);
      setPin("");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "PIN kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="text-xs text-slate-400">Yükleniyor…</div>;

  return (
    <div className="space-y-4" data-testid="pos-rules-panel">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-emerald-600" />
          <div>
            <h2 className="font-bold text-slate-900">Hızlı Satış Kuralları</h2>
            <p className="text-xs text-slate-500">Rol başına fiyat, iskonto, iade, iptal, veresiye ve çıkış. Kapalı işlemler yönetici PIN’i veya anlık onay ister.</p>
          </div>
        </div>
        <label className="text-xs font-semibold text-slate-700 block max-w-xs">
          İşlemsiz kilit (sn)
          <input type="number" min="15" max="3600" value={idle} onChange={(e) => setIdle(Number(e.target.value))} className="mt-1 w-full border rounded-lg p-2" data-testid="pos-idle-timeout" />
        </label>
        <div className="overflow-auto border rounded-xl">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left p-2">Rol</th>
                {BOOLS.map(([k, l]) => <th key={k} className="p-2 text-center whitespace-nowrap">{l}</th>)}
                <th className="p-2 text-center">İskonto %</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {roles.map((r) => (
                <tr key={r.code} data-testid={`pos-rule-row-${r.code}`}>
                  <td className="p-2 font-semibold">{r.name}</td>
                  {BOOLS.map(([k]) => (
                    <td key={k} className="p-2 text-center">
                      <input
                        type="checkbox"
                        disabled={r.code === "admin"}
                        checked={!!r.pos_rules?.[k]}
                        onChange={(e) => setRule(r.code, k, e.target.checked)}
                        data-testid={`pos-rule-${r.code}-${k}`}
                      />
                    </td>
                  ))}
                  <td className="p-2 text-center">
                    <MoneyInput
                      disabled={r.code === "admin"}
                      value={r.pos_rules?.max_discount_pct ?? 0}
                      onChange={(n) => setRule(r.code, "max_discount_pct", n ?? 0)}
                      className="w-16 border rounded p-1 text-right"
                      data-testid={`pos-rule-${r.code}-max_discount_pct`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-60" data-testid="pos-rules-save">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><KeyRound className="w-4 h-4" /> Kasiyer PIN</h3>
        <p className="text-xs text-slate-500">Her kasiyer 4-6 haneli PIN tanımlar. Giriş ve onayda kullanıcı seçimi + PIN zorunludur.</p>
        <div className="divide-y border rounded-xl">
          {cashiers.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2 text-xs" data-testid={`pos-cashier-row-${c.id}`}>
              <span className="font-semibold flex-1">{c.name}</span>
              <span className="text-slate-400">{c.role_name}</span>
              <span className={`px-2 py-0.5 rounded-full font-bold ${c.has_cashier_pin ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{c.has_cashier_pin ? "PIN var" : "PIN yok"}</span>
              <button type="button" onClick={() => { setPinFor(c); setPin(""); }} className="px-2 py-1 border rounded-lg font-semibold" data-testid={`pos-cashier-pin-${c.id}`}>PIN tanımla</button>
            </div>
          ))}
          {!cashiers.length && <div className="p-3 text-slate-400">Hızlı Satış yetkili kullanıcı yok.</div>}
        </div>
        {pinFor && (
          <form onSubmit={savePin} className="flex gap-2 items-end" data-testid="pos-pin-form">
            <label className="text-xs font-semibold flex-1">{pinFor.name} PIN
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-1 w-full border rounded-lg p-2 tracking-widest" inputMode="numeric" data-testid="pos-pin-input" />
            </label>
            <button type="submit" disabled={busy || !pinIsValid(pin)} className="px-3 py-2 bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-50">Kaydet</button>
            <button type="button" onClick={() => setPinFor(null)} className="px-3 py-2 border rounded-lg">İptal</button>
          </form>
        )}
      </div>
    </div>
  );
}

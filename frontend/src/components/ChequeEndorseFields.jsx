import React from "react";
import { ArrowLeftRight } from "lucide-react";
import { fmtDate, fmtMoney } from "../utils/money";

function rowId(ch) {
  return ch?.id || ch?._id || "";
}

function drawerName(ch) {
  return ch?.drawer_name || ch?.contact_name || "";
}

export function bankSerialLabel(ch) {
  if (ch?.instrument === "promissory") return `Senet · ${ch?.serial_no || "—"}`;
  const bank = String(ch?.bank_name || "").trim();
  const serial = String(ch?.serial_no || "").trim();
  if (bank && serial) return `${bank} · ${serial}`;
  return bank || serial || "—";
}

function matchesQuery(ch, query) {
  const needle = String(query || "").trim().toLocaleLowerCase("tr-TR");
  if (!needle) return true;
  const amount = Number(ch?.amount) || 0;
  const hay = [
    ch?.number,
    ch?.bank_name,
    ch?.serial_no,
    drawerName(ch),
    String(ch?.amount ?? ""),
    fmtMoney(amount),
    bankSerialLabel(ch),
  ].join(" ").toLocaleLowerCase("tr-TR");
  return hay.includes(needle);
}

export function ChequeEndorseFields({ form, onChange, narrow = false, onCancel, contactId }) {
  const portfolio = form?.portfolioCheques || [];
  const selected = new Set(form?.selectedEndorseIds || []);
  const visible = portfolio.filter((ch) => String(ch?.contact_id || "") !== String(contactId || "") && matchesQuery(ch, form?.endorseQuery));
  const picked = portfolio.filter((ch) => selected.has(rowId(ch)));
  const total = picked.reduce((sum, ch) => sum + (Number(ch.amount) || 0), 0);
  const noun = picked.length && picked.every((ch) => ch.instrument === "promissory") ? "senet" : "çek";
  const patch = (next) => onChange?.({ ...form, ...next });
  const toggle = (id) => {
    const ids = new Set(form?.selectedEndorseIds || []);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    patch({ selectedEndorseIds: [...ids] });
  };

  const line = (ch) => {
    const id = rowId(ch);
    const on = selected.has(id);
    return {
      id,
      on,
      number: ch.number || id,
      due: fmtDate(ch.due_date),
      bank: bankSerialLabel(ch),
      drawer: drawerName(ch) || "—",
      amount: fmtMoney(ch.amount),
    };
  };

  return (
    <div className="space-y-3" data-testid="endorse-fields">
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-semibold text-rose-800" data-testid="endorse-type-band">
        Ödeme (Çıkış) · Seçilen çekler bu cariye ciro edilir; kasa/banka değişmez
      </div>
      <div>
        <div className="font-semibold text-slate-800 mb-1">Portföydeki açık alınan çek / senetler</div>
        <input
          value={form?.endorseQuery || ""}
          onChange={(e) => patch({ endorseQuery: e.target.value })}
          placeholder="Ara: çek no, banka, seri, asıl cari, tutar"
          className="w-full bg-slate-50 border rounded-lg p-2"
          data-testid="endorse-search"
        />
      </div>
      {narrow ? (
        <div className="space-y-2" data-testid="endorse-cards">
          {visible.length === 0 && <div className="text-center text-slate-400 py-4">Açık portföy çeki yok.</div>}
          {visible.map((ch) => {
            const row = line(ch);
            return (
              <label key={row.id} className={`block rounded-lg border p-2 ${row.on ? "bg-emerald-50 border-emerald-200" : "border-slate-200"}`} data-testid={`endorse-card-${row.number}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <input type="checkbox" checked={row.on} onChange={() => toggle(row.id)} data-testid={`endorse-pick-card-${row.number}`} />
                    <span className="font-mono font-semibold truncate">{row.number}</span>
                  </span>
                  <span className="font-bold shrink-0">{row.amount}</span>
                </div>
                <div className="mt-1 text-[10px] text-slate-500">Vade {row.due} · {row.bank}</div>
                <div className="text-[10px] text-slate-500">Asıl cari: {row.drawer}</div>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-left" data-testid="endorse-table">
            <thead className="text-slate-500 uppercase text-[10px] font-semibold border-b bg-slate-50">
              <tr>
                <th className="py-2 px-2 w-8" />
                <th className="py-2">No</th>
                <th className="py-2">Vade</th>
                <th className="py-2">Banka / Seri</th>
                <th className="py-2">Asıl cari</th>
                <th className="py-2 text-right pr-2">Tutar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-slate-400">Açık portföy çeki yok.</td></tr>
              )}
              {visible.map((ch) => {
                const row = line(ch);
                return (
                  <tr key={row.id} className={row.on ? "bg-emerald-50" : ""} data-testid={`endorse-row-${row.number}`}>
                    <td className="py-2 px-2">
                      <input type="checkbox" checked={row.on} onChange={() => toggle(row.id)} aria-label={`${row.number} seç`} data-testid={`endorse-pick-${row.number}`} />
                    </td>
                    <td className="py-2 font-mono font-semibold">{row.number}</td>
                    <td className="py-2 font-mono">{row.due}</td>
                    <td className="py-2">{row.bank}</td>
                    <td className="py-2">{row.drawer}</td>
                    <td className="py-2 text-right font-bold pr-2">{row.amount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-[11px]" data-testid="endorse-summary">
        <span>{picked.length} {noun} seçildi</span>
        <span className="font-bold">Toplam {fmtMoney(total)}</span>
      </div>
      <div className={narrow ? "space-y-2" : "grid grid-cols-2 gap-2"}>
        <div>
          <label className="block font-semibold mb-1">Tarih</label>
          <input
            type="date"
            value={form?.endorse_date || ""}
            onChange={(e) => patch({ endorse_date: e.target.value })}
            className="w-full bg-slate-50 border rounded-lg p-2"
            data-testid="endorse-date"
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Açıklama</label>
          <input
            value={form?.description || ""}
            onChange={(e) => patch({ description: e.target.value })}
            className="w-full bg-slate-50 border rounded-lg p-2"
            data-testid="collect-desc-input"
          />
        </div>
      </div>
      <p className="text-[10px] text-slate-500" data-testid="endorse-note">
        Bu carinin kendi verdiği çekler listelenmez. Ciro, Çek/Senet modülündeki ciro ile aynı işlemdir; karşılıksız çıkarsa otomatik geri alınır.
      </p>
      <div className="flex justify-end gap-2 pt-2 border-t">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">Vazgeç</button>
        <button
          type="submit"
          disabled={!picked.length}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50"
          data-testid="endorse-save-btn"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          Cirola ({fmtMoney(total)})
        </button>
      </div>
    </div>
  );
}

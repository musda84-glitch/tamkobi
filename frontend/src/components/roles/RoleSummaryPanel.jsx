import React from "react";
import { roleSummary } from "../roleEditorModel";

/**
 * "Bu rol neler yapabilir?" içeriği.
 * Yeniden tasarım (tek satırlık açılır şerit) bu dosyada yapılır.
 * RoleEditor yalnız RoleSummarySlot ile yerini tutar.
 */
export function RoleSummaryPanel({ perms, features, userCount, mobile = false }) {
  const { can, cannot } = roleSummary(perms, features);
  return (
    <div className={mobile ? "" : "space-y-1"} data-testid={mobile ? "role-summary-mobile" : "role-summary"}>
      <h3 className="m-0 mb-2 text-sm font-bold text-slate-900">Bu rol neler yapabilir?</h3>
      <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mt-2">Yapabilir</div>
      <ul className="mt-1 mb-2 list-disc pl-4 text-slate-700 leading-relaxed marker:text-emerald-600">
        {can.length ? can.map((line) => <li key={line}>{line}</li>) : <li>Açık yetki yok</li>}
      </ul>
      <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Yapamaz</div>
      <ul className="mt-1 mb-2 list-disc pl-4 text-slate-700 leading-relaxed marker:text-red-600">
        {cannot.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {!mobile && userCount > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-[10px] p-2 text-[11px]" data-testid="role-user-warn">
          Bu rolde {userCount} kullanıcı var. Değişiklikler &quot;Kaydet&quot; ile uygulanır.
        </div>
      )}
    </div>
  );
}

const SLOT = {
  inline: "min-[1024px]:hidden mb-2.5 bg-slate-50 border border-slate-200 rounded-[14px] p-3",
  side: "hidden min-[1024px]:block min-[1024px]:max-[1279px]:col-start-2 min-[1024px]:max-[1279px]:row-start-2 min-[1280px]:col-start-3 min-[1280px]:row-start-1 min-[1280px]:sticky min-[1280px]:top-20 min-[1280px]:z-10 min-[1280px]:max-h-[calc(100vh-5.5rem)] min-[1280px]:self-start min-[1280px]:overflow-y-auto w-full bg-white border border-slate-200 rounded-[14px] p-3.5",
};

/** Yerleşim kabuğu. İçerik RoleSummaryPanel'dedir; şerit tasarımı gelince bu kabuk taşınır. */
export function RoleSummarySlot({ placement, perms, features, userCount }) {
  const inline = placement === "inline";
  return (
    <div className={inline ? SLOT.inline : SLOT.side} data-testid={inline ? "role-summary-mobile-wrap" : "role-summary-side"}>
      <RoleSummaryPanel perms={perms} features={features} userCount={userCount} mobile={inline} />
    </div>
  );
}

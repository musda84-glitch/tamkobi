import React from "react";

export default function NoCompanyNotice({ className = "" }) {
  return (
    <div
      data-testid="no-company"
      role="status"
      className={`rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 ${className}`.trim()}
    >
      Firma seçili değil
    </div>
  );
}

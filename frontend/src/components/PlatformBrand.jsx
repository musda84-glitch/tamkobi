import React, { useLayoutEffect } from "react";
import { Helmet } from "react-helmet-async";
import { ShieldCheck } from "lucide-react";
import TamKobiMark from "./TamKobiMark";
import { applyPlatformDocumentBrand, isYntHost, TAI_LOGO_SRC, TAI_PLATFORM_TITLE } from "../utils/platformBrand";

/** Sekme başlığı + favicon. App kabuğunda bir kez, ynt sayfalarında da. */
export function PlatformDocumentBrand() {
  const ynt = isYntHost();
  useLayoutEffect(() => {
    applyPlatformDocumentBrand();
  }, [ynt]);
  if (!ynt) return null;
  return (
    <Helmet>
      <title>{TAI_PLATFORM_TITLE}</title>
    </Helmet>
  );
}

/**
 * Giriş ve sol menü başlığı.
 * ynt host: TAI logosu ve "TAI Yazılım · Platform Yönetimi".
 * Diğer hostlar: mevcut TamKobi (veya plainTitle) başlığı.
 */
export function PlatformBrandLockup({ testId = "sys-brand", variant = "sidebar", subtitle = "Platform Yönetimi", plainTitle = null }) {
  const ynt = isYntHost();
  useLayoutEffect(() => {
    applyPlatformDocumentBrand();
  }, [ynt]);

  if (ynt) {
    return (
      <div className="flex flex-col items-start gap-1.5 min-w-0">
        <img src={TAI_LOGO_SRC} alt="TAI Yazılım" className="h-10 w-auto max-w-full shrink-0 bg-white rounded-md px-1.5 py-0.5" data-testid="tai-logo" />
        <div className={`font-bold leading-snug text-white ${variant === "sidebar" ? "text-xs" : "text-sm"}`} data-testid={testId}>{TAI_PLATFORM_TITLE}</div>
      </div>
    );
  }

  if (plainTitle) {
    return (
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-amber-400 flex items-center justify-center text-slate-900 shrink-0"><ShieldCheck className="w-5 h-5" /></div>
        <div>
          <div className="font-bold text-white text-sm" data-testid={testId}>{plainTitle}</div>
          {subtitle ? <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{subtitle}</div> : null}
        </div>
      </div>
    );
  }

  if (variant === "login") {
    return (
      <div className="flex items-center gap-2.5">
        <TamKobiMark className="w-9 h-9 shrink-0 rounded-xl" />
        <div>
          <div className="tracking-tight" data-testid={testId}>
            <span className="font-bold text-white">Tam</span>
            <span className="font-medium text-slate-300">Kobi</span>
          </div>
          {subtitle ? <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{subtitle}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="w-8 h-8 rounded-lg bg-amber-400 flex items-center justify-center text-slate-900 shrink-0"><ShieldCheck className="w-4 h-4" /></div>
      <div className="min-w-0">
        <div className="font-bold text-sm leading-tight" data-testid={testId}>Tam<span className="text-amber-400">Kobi</span></div>
        <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Platform Yönetimi</div>
      </div>
    </>
  );
}

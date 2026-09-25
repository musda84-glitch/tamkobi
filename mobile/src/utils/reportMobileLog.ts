import { Platform } from "react-native";
import type { ApiClient } from "../api/client";
import { post } from "../api/client";
import { appVersionLabel } from "./appVersion";

type ReporterCtx = {
  client: ApiClient | null;
  companyId: string | null;
};

const ctx: ReporterCtx = { client: null, companyId: null };

/** AuthContext login sonrası çağırır; hata sınırları log gönderebilsin. */
export function setMobileLogContext(client: ApiClient | null, companyId: string | null) {
  ctx.client = client;
  ctx.companyId = companyId;
}

export async function reportMobileLog(opts: {
  message: string;
  stack?: string;
  screen?: string;
  level?: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  path?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  if (!ctx.client?.token || !ctx.companyId) return;
  try {
    await post(ctx.client, "/mobile/logs", {
      company_id: ctx.companyId,
      source: "mobile",
      level: opts.level || "ERROR",
      message: opts.message,
      stack: opts.stack || "",
      screen: opts.screen || "",
      path: opts.path || "",
      platform: `${Platform.OS} ${String(Platform.Version ?? "")}`,
      app_version: appVersionLabel(),
      details: opts.details || {},
    });
  } catch {
    /* fire-and-forget */
  }
}

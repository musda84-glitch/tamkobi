import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  applyRobotsMeta,
  getHostKind,
  hostUrl,
  pathAllowedOnHost,
  preferredHostForPath,
} from "../utils/hosts";

/**
 * Fallback guard: if the current path does not belong on this host,
 * hard-navigate to the correct subdomain (nginx 301 is the primary path).
 */
export default function HostRouteGuard({ children }) {
  const { pathname, search, hash } = useLocation();
  const kind = getHostKind();

  useEffect(() => {
    applyRobotsMeta(kind);
  }, [kind]);

  useEffect(() => {
    if (pathAllowedOnHost(pathname, kind)) return;
    const target = preferredHostForPath(pathname);
    if (!target || target === kind) return;
    const dest = hostUrl(target, `${pathname}${search || ""}${hash || ""}`);
    try {
      window.location.replace(dest);
    } catch {
      window.location.href = dest;
    }
  }, [pathname, search, hash, kind]);

  return children;
}

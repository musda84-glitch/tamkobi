import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  applyRobotsMeta,
  getHostKind,
  hostUrl,
  pathAllowedOnHost,
  preferredHostForPath,
  yntRedirectEnabled,
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
    const suffix = `${pathname}${search || ""}${hash || ""}`;

    // ynt: only /sistem*, /sso, /yasal*; "/" → /sistem; everything else → /sistem
    if (kind === "ynt") {
      if (pathname === "/" || pathname === "") {
        try {
          window.location.replace("/sistem");
        } catch {
          window.location.href = "/sistem";
        }
        return;
      }
      if (pathAllowedOnHost(pathname, "ynt")) return;
      try {
        window.location.replace(`/sistem`);
      } catch {
        window.location.href = "/sistem";
      }
      return;
    }

    // Other hosts: optional client redirect of /sistem* → ynt when flag on
    if (
      (pathname === "/sistem" || pathname.startsWith("/sistem/")) &&
      yntRedirectEnabled()
    ) {
      const dest = hostUrl("ynt", suffix);
      try {
        window.location.replace(dest);
      } catch {
        window.location.href = dest;
      }
      return;
    }

    if (pathAllowedOnHost(pathname, kind)) return;
    const target = preferredHostForPath(pathname);
    if (!target || target === kind) return;
    const dest = hostUrl(target, suffix);
    try {
      window.location.replace(dest);
    } catch {
      window.location.href = dest;
    }
  }, [pathname, search, hash, kind]);

  return children;
}

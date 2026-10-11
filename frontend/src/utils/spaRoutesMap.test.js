import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../../..");
const APP_JS = readFileSync(join(ROOT, "frontend/src/App.js"), "utf8");
const MAP_CONF = readFileSync(join(ROOT, "deploy/nginx/spa-routes.map.conf"), "utf8");

/** App.js Route path="..." listesi (* hariç). */
export function extractAppRoutePaths(src = APP_JS) {
  return [...src.matchAll(/\bpath="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p && p !== "*");
}

/** React path → örnek URI (/yasal/:slug → /yasal/x). */
export function sampleUri(routePath) {
  if (routePath === "/") return "/";
  return routePath.replace(/:[^/]+/g, "x");
}

/** spa-routes.map.conf satırlarından eşleştiriciler. */
export function parseSpaMapMatchers(conf = MAP_CONF) {
  const matchers = [];
  for (const line of conf.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("map ") || t.startsWith("default") || t === "{" || t === "}") continue;
    const m = t.match(/^(~?\*?[^\s]+)\s+1\s*;?\s*$/);
    if (!m) continue;
    const key = m[1];
    if (key.startsWith("~*")) {
      matchers.push({ type: "re", re: new RegExp(key.slice(2), "i") });
    } else if (key.startsWith("~")) {
      matchers.push({ type: "re", re: new RegExp(key.slice(1)) });
    } else {
      matchers.push({ type: "exact", value: key });
    }
  }
  return matchers;
}

export function uriMatchesSpaMap(uri, matchers) {
  return matchers.some((m) => (m.type === "exact" ? m.value === uri : m.re.test(uri)));
}

test("spa-routes.map.conf covers every App.js route", () => {
  const routes = extractAppRoutePaths();
  expect(routes.length).toBeGreaterThan(20);
  const matchers = parseSpaMapMatchers();
  expect(matchers.some((m) => m.type === "exact" && m.value === "/")).toBe(true);

  const missing = [];
  for (const route of routes) {
    const uri = sampleUri(route);
    if (!uriMatchesSpaMap(uri, matchers)) missing.push(`${route} → ${uri}`);
  }
  expect(missing).toEqual([]);
});

test("unknown marketing path is not in spa map", () => {
  const matchers = parseSpaMapMatchers();
  expect(uriMatchesSpaMap("/bu-yol-kesinlikle-yok", matchers)).toBe(false);
});

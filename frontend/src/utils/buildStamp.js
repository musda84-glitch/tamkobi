/** Frontend bundle identity vs the running API. */

export const MESSAGE_MAX = 160;
export const DEFAULT_VERSION = "2.0.0";

export function cleanMessage(raw) {
  if (!raw) return null;
  const text = String(raw).split(/\s+/).join(" ").trim();
  if (!text) return null;
  if (text.length > MESSAGE_MAX) return `${text.slice(0, MESSAGE_MAX - 1).trimEnd()}…`;
  return text;
}

export function appVersion(raw) {
  const fromArg = (raw || "").trim();
  if (fromArg) return fromArg;
  return (process.env.REACT_APP_VERSION || "").trim() || DEFAULT_VERSION;
}

export function versionLabel(raw) {
  const v = appVersion(raw);
  return v.startsWith("v") ? v : `v${v}`;
}

export function frontendStamp() {
  const sha = (process.env.REACT_APP_GIT_SHA || "").trim();
  const branch = (process.env.REACT_APP_GIT_BRANCH || "").trim();
  const builtAt = (process.env.REACT_APP_BUILD_TIME || "").trim();
  const message = cleanMessage(process.env.REACT_APP_GIT_MESSAGE || "");
  return {
    version: appVersion(),
    git_sha: sha || null,
    git_sha_short: sha ? sha.slice(0, 7) : null,
    git_branch: branch || null,
    git_message: message,
    built_at: builtAt || null,
    source: sha ? "env" : "unknown",
  };
}

export function shortSha(sha) {
  if (!sha) return null;
  return String(sha).slice(0, 7);
}

/**
 * Compare the JS bundle's baked SHA with `/api/version`.
 *
 * `missing` — neither side knows its commit (images built without GIT_SHA).
 * `partial` — only one side was rebuilt.
 * `mismatch` — both present and they differ: the classic "git is on main
 *    but the container is still last week's image".
 * `match` — same commit (first 7 chars, so a full SHA matches a short one).
 */
export function compareStamps(ui, api) {
  const a = shortSha(ui && ui.git_sha);
  const b = shortSha(api && api.git_sha);
  if (!a && !b) return { match: false, known: false, reason: "missing" };
  if (!a || !b) return { match: false, known: false, reason: "partial" };
  if (a === b) return { match: true, known: true, reason: "match" };
  return { match: false, known: true, reason: "mismatch" };
}

export function stampLabel(ui, api) {
  const cmp = compareStamps(ui, api);
  const ver = versionLabel((api && api.version) || (ui && ui.version));
  const uiShort = shortSha(ui && ui.git_sha);
  const apiShort = shortSha(api && api.git_sha);
  if (cmp.reason === "mismatch") return `${ver} · arayüz ${uiShort} ≠ api ${apiShort}`;
  if (cmp.reason === "missing") return ver;
  if (cmp.reason === "partial") {
    if (uiShort) return `${ver} · arayüz ${uiShort}`;
    return `${ver} · api ${apiShort}`;
  }
  return uiShort ? `${ver} · ${uiShort}` : ver;
}

export function stampTitle(ui, api) {
  const ver = versionLabel((api && api.version) || (ui && ui.version));
  const lines = [
    `sürüm: ${ver}`,
    `arayüz: ${(ui && ui.git_sha) || "—"} (${(ui && ui.source) || "unknown"})`,
    `api: ${(api && api.git_sha) || "—"} (${(api && api.source) || "unknown"})`,
  ];
  const message = (api && api.git_message) || (ui && ui.git_message);
  if (message) lines.push(`konu: ${message}`);
  const built = (ui && ui.built_at) || (api && api.built_at);
  if (built) lines.push(`derleme: ${built}`);
  const cmp = compareStamps(ui, api);
  if (cmp.reason === "mismatch") lines.push("Bu ekran ile API farklı commit'lerden. Sayfayı yenileyin (Ctrl+Shift+R).");
  if (cmp.reason === "missing") lines.push("İmaj GIT_SHA ile derlenmemiş. scripts/rebuild-preview.sh kullanın.");
  return lines.join("\n");
}

export function formatBuiltAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
  } catch (_err) {
    return String(iso);
  }
}

/**
 * Copy for the sidebar version card.
 * Prefers the live API stamp so a just-merged deploy shows up before the
 * cached JS bundle is refreshed.
 */
export function updateCard(ui, api) {
  const cmp = compareStamps(ui, api);
  const version = versionLabel((api && api.version) || (ui && ui.version));
  const sha = shortSha((api && api.git_sha) || (ui && ui.git_sha));
  const branch = ((api && api.git_branch) || (ui && ui.git_branch) || "").trim() || null;
  const message = cleanMessage((api && api.git_message) || (ui && ui.git_message) || "");
  const builtAt = formatBuiltAt((api && api.built_at) || (ui && ui.built_at));
  let statusKind = "muted";
  let statusText = null;
  if (cmp.reason === "match") {
    statusKind = "ok";
    statusText = "Sunucu bu sürümü çalıştırıyor";
  } else if (cmp.reason === "mismatch") {
    statusKind = "warn";
    statusText = "Arayüz eski — sayfayı yenile";
  } else if (cmp.reason === "partial") {
    statusKind = "warn";
    statusText = ui && ui.git_sha ? "API sürüm bildirmedi" : "Arayüz sürüm bildirmedi";
  }
  return { version, sha, branch, message, builtAt, statusKind, statusText, reason: cmp.reason };
}

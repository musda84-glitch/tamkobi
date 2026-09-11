/** Frontend bundle identity vs the running API. */

export function frontendStamp() {
  const sha = (process.env.REACT_APP_GIT_SHA || "").trim();
  const branch = (process.env.REACT_APP_GIT_BRANCH || "").trim();
  const builtAt = (process.env.REACT_APP_BUILD_TIME || "").trim();
  return {
    git_sha: sha || null,
    git_sha_short: sha ? sha.slice(0, 7) : null,
    git_branch: branch || null,
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
  const uiShort = shortSha(ui && ui.git_sha);
  const apiShort = shortSha(api && api.git_sha);
  if (cmp.reason === "mismatch") return `arayüz ${uiShort} ≠ api ${apiShort}`;
  if (cmp.reason === "missing") return "derleme bilgisi yok";
  if (cmp.reason === "partial") {
    if (uiShort) return `arayüz ${uiShort}`;
    return `api ${apiShort}`;
  }
  const branch = (ui && ui.git_branch) || (api && api.git_branch) || "";
  return branch ? `${uiShort} · ${branch}` : uiShort;
}

export function stampTitle(ui, api) {
  const lines = [
    `arayüz: ${(ui && ui.git_sha) || "—"} (${(ui && ui.source) || "unknown"})`,
    `api: ${(api && api.git_sha) || "—"} (${(api && api.source) || "unknown"})`,
  ];
  const built = (ui && ui.built_at) || (api && api.built_at);
  if (built) lines.push(`derleme: ${built}`);
  const cmp = compareStamps(ui, api);
  if (cmp.reason === "mismatch") lines.push("Bu ekran ile API farklı commit'lerden. İmaj yeniden derlenmemiş.");
  if (cmp.reason === "missing") lines.push("İmaj GIT_SHA ile derlenmemiş. scripts/rebuild-preview.sh kullanın.");
  return lines.join("\n");
}

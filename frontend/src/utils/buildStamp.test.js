import { appVersion, cleanMessage, compareStamps, frontendStamp, shortSha, stampLabel, stampTitle, updateCard, versionLabel } from "./buildStamp";

test("shortSha keser", () => {
  expect(shortSha("abcdef1234")).toBe("abcdef1");
  expect(shortSha(null)).toBe(null);
});

test("versionLabel v öneki ekler", () => {
  expect(versionLabel("2.0.0")).toBe("v2.0.0");
  expect(versionLabel("v2.0.0")).toBe("v2.0.0");
  expect(appVersion("3.1.0")).toBe("3.1.0");
});

test("ikisi de yoksa missing", () => {
  expect(compareStamps({}, {}).reason).toBe("missing");
  expect(stampLabel({}, {})).toBe("v2.0.0");
});

test("yalnızca api varsa partial", () => {
  const api = { git_sha: "abcdef1234" };
  expect(compareStamps({}, api).reason).toBe("partial");
  expect(stampLabel({}, api)).toBe("v2.0.0 · api abcdef1");
});

test("yalnızca arayüz varsa partial", () => {
  const ui = { git_sha: "abcdef1234" };
  expect(compareStamps(ui, {}).reason).toBe("partial");
  expect(stampLabel(ui, {})).toBe("v2.0.0 · arayüz abcdef1");
});

test("aynı kısa sha eşleşir", () => {
  const ui = { git_sha: "abcdef1234", git_branch: "main", version: "2.0.0" };
  const api = { git_sha: "abcdef1", version: "2.0.0" };
  expect(compareStamps(ui, api)).toEqual({ match: true, known: true, reason: "match" });
  expect(stampLabel(ui, api)).toBe("v2.0.0 · abcdef1");
});

test("farklı sha mismatch", () => {
  const ui = { git_sha: "aaaaaaa111" };
  const api = { git_sha: "bbbbbbb222" };
  expect(compareStamps(ui, api).reason).toBe("mismatch");
  expect(stampLabel(ui, api)).toBe("v2.0.0 · arayüz aaaaaaa ≠ api bbbbbbb");
  expect(stampTitle(ui, api)).toMatch(/farklı commit/);
  expect(stampTitle(ui, api)).toMatch(/sürüm: v2\.0\.0/);
});

test("frontendStamp env yokken unknown", () => {
  const stamp = frontendStamp();
  expect(stamp.source).toBe("unknown");
  expect(stamp.git_sha).toBe(null);
  expect(stamp.git_message).toBe(null);
  expect(stamp.version).toBe("2.0.0");
});

test("cleanMessage tek satır ve kısaltır", () => {
  expect(cleanMessage("  a \n b  ")).toBe("a b");
  expect(cleanMessage("")).toBe(null);
  const long = "x".repeat(200);
  const cleaned = cleanMessage(long);
  expect(cleaned.endsWith("…")).toBe(true);
  expect(cleaned.length).toBe(160);
});

test("updateCard API konusunu ve eşleşmeyi gösterir", () => {
  const ui = { git_sha: "abcdef1234", git_branch: "main", git_message: "eski konu" };
  const api = {
    git_sha: "abcdef1234",
    git_branch: "main",
    git_message: "Merge pull request #8 from musda84-glitch/cursor/use-backend-unit-70ae",
    built_at: "2026-09-11T15:00:00Z",
  };
  const card = updateCard(ui, api);
  expect(card.version).toBe("v2.0.0");
  expect(card.sha).toBe("abcdef1");
  expect(card.branch).toBe("main");
  expect(card.message).toMatch(/Merge pull request #8/);
  expect(card.statusKind).toBe("ok");
  expect(card.statusText).toMatch(/Sunucu/);
  expect(card.builtAt).toBeTruthy();
});

test("updateCard mismatch yenile der", () => {
  const ui = { git_sha: "aaaaaaa111", git_message: "eski" };
  const api = { git_sha: "bbbbbbb222", git_message: "yeni merge" };
  const card = updateCard(ui, api);
  expect(card.reason).toBe("mismatch");
  expect(card.message).toBe("yeni merge");
  expect(card.statusKind).toBe("warn");
  expect(card.statusText).toMatch(/yenile/);
});

test("stampTitle konuyu ekler", () => {
  const title = stampTitle(
    { git_sha: "abc", source: "env" },
    { git_sha: "abc", source: "env", git_message: "Restart tamkobi-backend" },
  );
  expect(title).toMatch(/Restart tamkobi-backend/);
});

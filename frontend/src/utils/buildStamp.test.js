import { compareStamps, frontendStamp, shortSha, stampLabel, stampTitle } from "./buildStamp";

test("shortSha keser", () => {
  expect(shortSha("abcdef1234")).toBe("abcdef1");
  expect(shortSha(null)).toBe(null);
});

test("ikisi de yoksa missing", () => {
  expect(compareStamps({}, {}).reason).toBe("missing");
  expect(stampLabel({}, {})).toBe("derleme bilgisi yok");
});

test("yalnızca api varsa partial", () => {
  const api = { git_sha: "abcdef1234" };
  expect(compareStamps({}, api).reason).toBe("partial");
  expect(stampLabel({}, api)).toBe("api abcdef1");
});

test("yalnızca arayüz varsa partial", () => {
  const ui = { git_sha: "abcdef1234" };
  expect(compareStamps(ui, {}).reason).toBe("partial");
  expect(stampLabel(ui, {})).toBe("arayüz abcdef1");
});

test("aynı kısa sha eşleşir", () => {
  const ui = { git_sha: "abcdef1234", git_branch: "main" };
  const api = { git_sha: "abcdef1" };
  expect(compareStamps(ui, api)).toEqual({ match: true, known: true, reason: "match" });
  expect(stampLabel(ui, api)).toBe("abcdef1 · main");
});

test("farklı sha mismatch", () => {
  const ui = { git_sha: "aaaaaaa111" };
  const api = { git_sha: "bbbbbbb222" };
  expect(compareStamps(ui, api).reason).toBe("mismatch");
  expect(stampLabel(ui, api)).toBe("arayüz aaaaaaa ≠ api bbbbbbb");
  expect(stampTitle(ui, api)).toMatch(/farklı commit/);
});

test("frontendStamp env yokken unknown", () => {
  const stamp = frontendStamp();
  expect(stamp.source).toBe("unknown");
  expect(stamp.git_sha).toBe(null);
});

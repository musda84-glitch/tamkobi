import { resolveSetupStatus } from "./setupStatus";

test("explicit not-installed opens the wizard", () => {
  expect(resolveSetupStatus({ installed: false })).toEqual({ installed: false, fromCache: false });
});

test("explicit installed stays on the site", () => {
  expect(resolveSetupStatus({ installed: true })).toEqual({ installed: true, fromCache: false });
});

test("status failure with cache does not open the wizard", () => {
  const r = resolveSetupStatus(null, { error: true, cached: true });
  expect(r.installed).toBe(true);
  expect(r.fromCache).toBe(true);
});

test("status failure without cache still does not open the wizard", () => {
  const r = resolveSetupStatus(null, { error: true, cached: false });
  expect(r.installed).toBe(true);
  expect(r.unreachable).toBe(true);
});

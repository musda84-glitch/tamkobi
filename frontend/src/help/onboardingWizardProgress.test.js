import { ONBOARDING_STEPS, progressLabel, firstRemainingIndex } from "./onboarding";

test("progress bar percent is 0-100 and six skippable steps exist", () => {
  expect(ONBOARDING_STEPS).toHaveLength(6);
  ONBOARDING_STEPS.forEach((s) => {
    expect(s.label).toBeTruthy();
    expect(s.hint).toBeTruthy();
  });
  expect(progressLabel(0)).toBe("%0 tamamlandı");
  expect(progressLabel(100)).toBe("%100 tamamlandı");
  expect(firstRemainingIndex({ remaining: [] })).toBe(0);
});

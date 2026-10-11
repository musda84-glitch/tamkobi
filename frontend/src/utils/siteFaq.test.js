import { buildSiteFaq } from "./siteFaq";

test("buildSiteFaq uses trial_days in deneme sorusu", () => {
  const faq = buildSiteFaq(21);
  const trial = faq.find((x) => x.q.includes("deneme"));
  expect(trial.q).toContain("21");
  expect(trial.a).toContain("21");
  expect(trial.a.toLowerCase()).toContain("kredi kartı");
});

test("FAQ avoids unverified brand migration claims", () => {
  const text = buildSiteFaq(14).map((x) => `${x.q} ${x.a}`).join(" ");
  expect(text).not.toMatch(/İşNet/);
  expect(text).not.toMatch(/Logo/);
  expect(text).not.toMatch(/Paraşüt/);
  expect(text).not.toMatch(/zorunlu uzun süreli taahhüt/);
});

import { buildSiteFaq } from "./siteFaq";
import {
  DEFAULT_FEATURE_LINES,
  DEFAULT_HERO_TITLE,
  defaultHeroText,
  demoVideoEmbed,
  resolveVitrinContent,
} from "./vitrinContent";

test("empty site content keeps the hardcoded vitrin copy", () => {
  const copy = resolveVitrinContent(null, 21);
  expect(copy.useDefaultHero).toBe(true);
  expect(copy.useDefaultText).toBe(true);
  expect(copy.useDefaultFeatures).toBe(true);
  expect(copy.useDefaultFaq).toBe(true);
  expect(copy.heroTitle).toBe(DEFAULT_HERO_TITLE);
  expect(copy.heroText).toBe(defaultHeroText(21));
  expect(copy.heroText).toContain("21 gün");
  expect(copy.lines).toEqual(DEFAULT_FEATURE_LINES);
  expect(copy.image).toBe("");
  expect(copy.videoUrl).toBe("");
  expect(copy.faq).toEqual(buildSiteFaq(21));
});

test("edited faq, video, features and hero replace the defaults", () => {
  const copy = resolveVitrinContent({
    pages: { home: { hero_title: "Yeni başlık", hero_text: "", hero_image: "/brand/ekran.png" } },
    features: { lines: ["  Tek satır  ", ""] },
    demo_video: { url: "https://youtu.be/abcdefghijk", published: true },
    faq: [
      { question: "Gizli", answer: "yok", order: 0, published: false },
      { question: "İkinci", answer: "B", order: 2, published: true },
      { question: "Birinci", answer: "A", order: 1, published: true },
    ],
  }, 14);
  expect(copy.useDefaultHero).toBe(false);
  expect(copy.heroTitle).toBe("Yeni başlık");
  expect(copy.useDefaultText).toBe(true);
  expect(copy.image).toBe("/brand/ekran.png");
  expect(copy.lines).toEqual(["Tek satır"]);
  expect(copy.videoUrl).toContain("youtu.be");
  expect(copy.faq.map((item) => item.q)).toEqual(["Birinci", "İkinci"]);
  expect(copy.useDefaultFaq).toBe(false);
});

test("unpublished video stays on the placeholder", () => {
  const copy = resolveVitrinContent({ demo_video: { url: "https://vimeo.com/9", published: false } }, 14);
  expect(copy.videoUrl).toBe("");
});

test("demo video embed accepts youtube and vimeo and drops javascript", () => {
  expect(demoVideoEmbed("https://www.youtube.com/watch?v=abcdefghijk").src).toContain("/embed/abcdefghijk");
  expect(demoVideoEmbed("https://vimeo.com/99").src).toBe("https://player.vimeo.com/video/99");
  expect(demoVideoEmbed("https://cdn.example/demo.mp4").kind).toBe("video");
  expect(demoVideoEmbed("javascript:alert(1)")).toBeNull();
});

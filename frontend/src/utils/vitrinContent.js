import { buildSiteFaq } from "./siteFaq";

/** PricingPage'deki sabit metin. site_content boşken görüntü değişmez. */
export const DEFAULT_HERO_TITLE = "İşletmenizi tek panelden yönetin, ihtiyacınız kadar ödeyin.";
export const DEFAULT_FEATURE_LINES = ["e-Fatura & cari", "Stok ve depo", "Üretim & e-ticaret"];

export function defaultHeroText(trialDays = 14) {
  const days = Number(trialDays) > 0 ? Number(trialDays) : 14;
  return `Fatura, cari, stok, e-ticaret, kargo, personel ve üretim. Hazır paketlerden birini seçin veya modülleri tek tek işaretleyerek kendi paketini oluşturun. ${days} gün ücretsiz deneyin, kredi kartı gerekmez.`;
}

function linesOf(features) {
  const raw = Array.isArray(features) ? features : features?.lines;
  if (!Array.isArray(raw)) return [];
  return raw.map((line) => String(line || "").trim()).filter(Boolean);
}

export function resolveVitrinContent(content, trialDays = 14) {
  const home = content?.pages?.home || {};
  const heroTitle = String(home.hero_title || "").trim();
  const heroText = String(home.hero_text || "").trim();
  const image = String(home.hero_image || "").trim();
  const lines = linesOf(content?.features);
  const video = content?.demo_video || {};
  const videoUrl = video.published && String(video.url || "").trim() ? String(video.url).trim() : "";
  const customFaq = (Array.isArray(content?.faq) ? content.faq : [])
    .filter((item) => item && item.published !== false && String(item.question || "").trim())
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.question).localeCompare(String(b.question), "tr"));
  return {
    heroTitle: heroTitle || DEFAULT_HERO_TITLE,
    heroText: heroText || defaultHeroText(trialDays),
    useDefaultHero: !heroTitle,
    useDefaultText: !heroText,
    image,
    lines: lines.length ? lines : DEFAULT_FEATURE_LINES,
    useDefaultFeatures: lines.length === 0,
    videoUrl,
    faq: customFaq.length
      ? customFaq.map((item) => ({ q: String(item.question).trim(), a: String(item.answer || "").trim() }))
      : buildSiteFaq(trialDays),
    useDefaultFaq: customFaq.length === 0,
  };
}

/** YouTube / Vimeo gömme, doğrudan video veya düz bağlantı. javascript: yok. */
export function demoVideoEmbed(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    let id = "";
    if (host === "youtu.be") id = parsed.pathname.split("/").filter(Boolean)[0] || "";
    else if (parsed.pathname.startsWith("/embed/")) id = parsed.pathname.split("/")[2] || "";
    else if (parsed.pathname.startsWith("/shorts/")) id = parsed.pathname.split("/")[2] || "";
    else id = parsed.searchParams.get("v") || "";
    if (/^[\w-]{6,}$/.test(id)) {
      return { kind: "iframe", src: `https://www.youtube.com/embed/${encodeURIComponent(id)}` };
    }
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = (parsed.pathname.split("/").filter(Boolean).pop() || "");
    if (/^\d+$/.test(id)) return { kind: "iframe", src: `https://player.vimeo.com/video/${id}` };
  }
  if (/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) return { kind: "video", src: raw };
  return { kind: "link", href: raw };
}

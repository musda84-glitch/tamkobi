/** Future AI assistant payload. Keep stable so /api/ai/help-chat can consume it later. */

export const HELP_CHAT_ENDPOINT = "/api/ai/help-chat";

export function buildClientAssistantContext({ product = "tamkobi", pageHelp, articles = [], remote } = {}) {
  const related = Array.isArray(articles) ? articles : [];
  const prompts = [];
  related.forEach((a) => {
    (a.assistant?.suggested_prompts || []).forEach((p) => {
      if (p && !prompts.includes(p)) prompts.push(p);
    });
  });
  return {
    product,
    page_key: pageHelp?.pageKey || pageHelp?.key || "",
    page_summary: pageHelp?.intro || "",
    related_articles: related.map((a) => ({
      slug: a.slug,
      title: a.title,
      summary: a.summary,
      content_type: a.content_type,
    })),
    suggested_prompts: prompts.slice(0, 8),
    chat_endpoint: remote?.chat_endpoint || HELP_CHAT_ENDPOINT,
    chat_ready: Boolean(remote?.chat_ready),
    source: remote ? "api" : "client",
  };
}

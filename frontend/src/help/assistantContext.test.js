import { HELP_CHAT_ENDPOINT, buildClientAssistantContext } from "./assistantContext";

test("assistant context is stable for a future chat endpoint", () => {
  const ctx = buildClientAssistantContext({
    pageHelp: { pageKey: "/invoices", intro: "Faturalar" },
    articles: [{
      slug: "fatura-nasil-kesilir",
      title: "Satış faturası",
      summary: "Kes",
      content_type: "article",
      assistant: { suggested_prompts: ["Nasıl keserim?"] },
    }],
  });
  expect(ctx.chat_endpoint).toBe(HELP_CHAT_ENDPOINT);
  expect(ctx.chat_ready).toBe(false);
  expect(ctx.page_key).toBe("/invoices");
  expect(ctx.related_articles[0].slug).toBe("fatura-nasil-kesilir");
  expect(ctx.suggested_prompts).toContain("Nasıl keserim?");
});

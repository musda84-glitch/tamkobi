import { router, type Href } from "expo-router";

export function goHref(href: string) {
  return router.push(href as Href);
}

export function go(name: string, params?: Record<string, unknown>) {
  switch (name) {
    case "Search":
      return router.push("/search");
    case "Notifications":
      return router.push("/notifications");
    case "Contacts":
      return router.push("/contacts");
    case "ContactDetail":
      return router.push({ pathname: "/contacts/[id]", params: { id: String(params?.id || ""), name: String(params?.name || "") } });
    case "Invoices":
      return router.push("/invoices");
    case "InvoiceDetail":
      return router.push({ pathname: "/invoices/[id]", params: { id: String(params?.id || "") } });
    case "InvoiceNew":
      return router.push({
        pathname: "/invoices/new",
        params: { type: String(params?.type || "all") },
      });
    case "InvoiceEdit":
      return router.push({ pathname: "/invoices/edit/[id]", params: { id: String(params?.id || "") } });
    case "Orders":
      return router.push("/orders");
    case "OrderDetail":
      return router.push({ pathname: "/orders/[id]", params: { id: String(params?.id || "") } });
    case "Settings":
      return router.push("/settings");
    case "Mesai":
      return router.push("/mesai");
    case "Personelim":
      return router.push("/personelim");
    case "Stock":
      return router.push("/stok");
    case "Field":
      return router.push("/saha");
    case "StockNew":
      return router.push("/stock/new");
    case "StockDetail":
      return router.push({ pathname: "/stock/[id]", params: { id: String(params?.id || ""), name: String(params?.name || "") } });
    case "Banking":
      return router.push("/banking");
    case "BankingNew":
      return router.push("/banking/new");
    case "BankingVirman":
      return router.push("/banking/virman");
    case "BankingAccount":
      return router.push({ pathname: "/banking/[id]", params: { id: String(params?.id || ""), name: String(params?.name || "") } });
    case "BankingEdit":
      return router.push({ pathname: "/banking/edit/[id]", params: { id: String(params?.id || "") } });
    case "Expenses":
      return router.push("/expenses");
    case "ExpenseNew":
      return router.push("/expenses/new");
    case "ExpenseDetail":
      return router.push({ pathname: "/expenses/[id]", params: { id: String(params?.id || "") } });
    case "Quotes":
      return router.push("/quotes");
    case "QuoteNew":
      return router.push("/quotes/new");
    case "QuoteDetail":
      return router.push({ pathname: "/quotes/[id]", params: { id: String(params?.id || "") } });
    case "Projects":
      return router.push("/projects");
    case "ProjectNew":
      return router.push("/projects/new");
    case "ProjectDetail":
      return router.push({ pathname: "/projects/[id]", params: { id: String(params?.id || "") } });
    case "Surveys":
      return router.push("/surveys");
    case "SurveyNew":
      return router.push("/surveys/new");
    case "SurveyDetail":
      return router.push({ pathname: "/surveys/[id]", params: { id: String(params?.id || "") } });
    default:
      return;
  }
}

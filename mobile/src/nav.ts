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
    case "ContactNew":
      return router.push("/contacts/new");
    case "ContactEdit":
      return router.push({ pathname: "/contacts/edit/[id]", params: { id: String(params?.id || "") } });
    case "ContactStatement":
      return router.push({ pathname: "/contacts/statement/[id]", params: { id: String(params?.id || ""), name: String(params?.name || "") } });
    case "Invoices":
      return router.push("/invoices");
    case "EdocInbox":
      return router.push("/edoc-inbox");
    case "InvoiceDetail":
      return router.push({ pathname: "/invoices/[id]", params: { id: String(params?.id || "") } });
    case "InvoiceNew":
      return router.push({
        pathname: "/invoices/new",
        params: {
          type: String(params?.type || "all"),
          contact_id: String(params?.contact_id || ""),
          contact_name: String(params?.contact_name || ""),
        },
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
    case "Personnel":
      return router.push("/personnel");
    case "Stock":
      return router.push("/stok");
    case "Field":
      return params?.contact_id
        ? router.push({ pathname: "/saha", params: { contact_id: String(params.contact_id), contact_name: String(params.contact_name || "") } })
        : router.push("/saha");
    case "Sevk":
      return router.push("/sevk");
    case "Atolye":
      return router.push("/atolye");
    case "SevkPick":
      return router.push({ pathname: "/sevk/[id]", params: { id: String(params?.id || ""), name: String(params?.name || "") } });
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
    case "Installments":
      return router.push("/installments");
    case "Cheques":
      return router.push("/cheques");
    case "ChequeNew":
      return router.push("/cheques/new");
    case "Expenses":
      return router.push("/expenses");
    case "ExpenseNew":
      return router.push("/expenses/new");
    case "ExpenseDetail":
      return router.push({ pathname: "/expenses/[id]", params: { id: String(params?.id || "") } });
    case "Quotes":
      return router.push("/quotes");
    case "QuoteNew":
      return router.push({
        pathname: "/quotes/new",
        params: { contact_id: String(params?.contact_id || ""), contact_name: String(params?.contact_name || "") },
      });
    case "QuoteDetail":
      return router.push({ pathname: "/quotes/[id]", params: { id: String(params?.id || "") } });
    case "Projects":
      return router.push("/projects");
    case "ProjectNew":
      return router.push({
        pathname: "/projects/new",
        params: { contact_id: String(params?.contact_id || ""), contact_name: String(params?.contact_name || "") },
      });
    case "ProjectDetail":
      return router.push({ pathname: "/projects/[id]", params: { id: String(params?.id || "") } });
    case "Surveys":
      return router.push("/surveys");
    case "SurveyNew":
      return router.push({
        pathname: "/surveys/new",
        params: { contact_id: String(params?.contact_id || ""), contact_name: String(params?.contact_name || "") },
      });
    case "SurveyDetail":
      return router.push({ pathname: "/surveys/[id]", params: { id: String(params?.id || "") } });
    default:
      return;
  }
}

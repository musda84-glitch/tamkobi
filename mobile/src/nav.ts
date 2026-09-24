import { router, type Href } from "expo-router";
import { hrefNav } from "./utils/quickMenu";

export function goHref(href: string) {
  const { method, target } = hrefNav(href);
  return method === "navigate" ? router.navigate(target as Href) : router.push(target as Href);
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
      return router.push({
        pathname: "/contacts/[id]",
        params: {
          id: String(params?.id || ""),
          name: String(params?.name || ""),
          ...(params?.collect ? { collect: String(params.collect) } : {}),
        },
      });
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
    case "OrderEdit":
      return router.push({ pathname: "/orders/edit/[id]", params: { id: String(params?.id || "") } });
    case "Settings":
      return router.push("/settings");
    case "Mesai":
      return goHref("/mesai");
    case "Personelim":
      return goHref("/personelim");
    case "Personnel":
      return router.push("/personnel");
    case "Stock":
      return goHref("/stok");
    case "Field":
      return params?.contact_id
        ? router.navigate({ pathname: "/saha", params: { contact_id: String(params.contact_id), contact_name: String(params.contact_name || "") } })
        : goHref("/saha");
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
    case "Pay":
      return router.push("/pay");
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
      return router.push({
        pathname: "/cheques/new",
        params: {
          contact_id: String(params?.contact_id || ""),
          contact_name: String(params?.contact_name || ""),
          instrument: String(params?.instrument || ""),
          direction: String(params?.direction || ""),
          amount: String(params?.amount || ""),
          notes: String(params?.notes || ""),
          serial_no: String(params?.serial_no || ""),
          bank_name: String(params?.bank_name || ""),
          bank_branch: String(params?.bank_branch || ""),
          account_no: String(params?.account_no || ""),
          drawer_name: String(params?.drawer_name || ""),
          issue_date: String(params?.issue_date || ""),
          due_date: String(params?.due_date || ""),
        },
      });
    case "ChequeDetail":
      return router.push({ pathname: "/cheques/[id]", params: { id: String(params?.id || "") } });
    case "Expenses":
      return router.push("/expenses");
    case "ExpenseNew":
      return router.push({
        pathname: "/expenses/new",
        params: {
          account_id: String(params?.account_id || ""),
          amount: String(params?.amount || ""),
          description: String(params?.description || ""),
          category: String(params?.category || ""),
          date: String(params?.date || ""),
          document_no: String(params?.document_no || ""),
          vat_rate: String(params?.vat_rate || ""),
          vat_included: String(params?.vat_included || ""),
          notes: String(params?.notes || ""),
          contact_id: String(params?.contact_id || ""),
        },
      });
    case "ExpenseDetail":
      return router.push({ pathname: "/expenses/[id]", params: { id: String(params?.id || "") } });
    case "Quotes":
      return router.push("/quotes");
    case "QuoteNew":
      return router.push({
        pathname: "/quotes/new",
        params: {
          contact_id: String(params?.contact_id || ""),
          contact_name: String(params?.contact_name || ""),
          project_id: String(params?.project_id || ""),
          title: String(params?.title || ""),
        },
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
      return router.push({
        pathname: "/projects/[id]",
        params: {
          id: String(params?.id || ""),
          open_expense: String(params?.open_expense || ""),
          section: String(params?.section || ""),
        },
      });
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

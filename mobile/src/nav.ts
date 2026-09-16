import { router } from "expo-router";

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
    case "StockNew":
      return router.push("/stock/new");
    case "StockDetail":
      return router.push({ pathname: "/stock/[id]", params: { id: String(params?.id || ""), name: String(params?.name || "") } });
    default:
      return;
  }
}

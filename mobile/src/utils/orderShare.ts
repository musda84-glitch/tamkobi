import { Platform, Share } from "react-native";
import type { Order } from "../types";
import {
  cargoLabelHtml,
  cargoLabelText,
  openPrintHtml,
  orderFormHtml,
  orderFormText,
  type PrintCompany,
} from "./orderPrint";

export async function printOrderForm(order: Order, company?: PrintCompany | null): Promise<boolean> {
  const title = `Sipariş ${order.order_number || ""}`.trim();
  if (Platform.OS === "web" && openPrintHtml(title, orderFormHtml(order, company))) return true;
  await Share.share({ message: orderFormText(order, company), title }).catch(() => null);
  return true;
}

export async function printCargoLabel(order: Order, company?: PrintCompany | null): Promise<boolean> {
  const title = `Kargo ${order.order_number || ""}`.trim();
  if (Platform.OS === "web" && openPrintHtml(title, cargoLabelHtml(order, company))) return true;
  await Share.share({ message: cargoLabelText(order, company), title }).catch(() => null);
  return true;
}

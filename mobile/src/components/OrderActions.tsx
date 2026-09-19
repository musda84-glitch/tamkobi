import React, { useState } from "react";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import type { Order } from "../types";
import { idOf } from "../utils/money";
import { printCargoLabel, printOrderForm } from "../utils/orderShare";
import { ActionTiles, type ActionTile } from "./ActionTiles";
import { confirmAction } from "./chips";
import { Muted } from "./kit";

export function OrderActions({
  order,
  size = "xs",
  onMessage,
  onError,
}: {
  order: Order;
  size?: "xs" | "sm";
  onMessage?: (text: string) => void;
  onError?: (text: string) => void;
}) {
  const { client, activeCompany, can } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const canProduce = can("/production", "edit") || can("/sevk", "edit") || can("/orders", "edit");

  const ensure = async () => {
    if (order.items?.length) return order;
    return get<Order>(client, `/orders/${idOf(order)}`);
  };

  const printForm = async () => {
    setBusy("print");
    try {
      await printOrderForm(await ensure(), activeCompany);
      onMessage?.("Sipariş formu yazdırmaya gönderildi.");
    } catch (err) {
      onError?.(apiErrorMessage(err, "Yazdırılamadı."));
    } finally {
      setBusy(null);
    }
  };

  const printLabel = async () => {
    setBusy("label");
    try {
      const full = await ensure();
      await printCargoLabel(full, activeCompany);
      post(client, "/orders/mark-labels-printed", { ids: [idOf(full)] }).catch(() => null);
      onMessage?.("Kargo etiketi yazdırmaya gönderildi.");
    } catch (err) {
      onError?.(apiErrorMessage(err, "Etiket yazdırılamadı."));
    } finally {
      setBusy(null);
    }
  };

  const toProduction = () => {
    confirmAction(
      "Üretim emri",
      `${order.order_number || "Sipariş"} için eksik kalemler üretime alınsın mı?`,
      async () => {
        setBusy("prod");
        try {
          const r = await post<{ message?: string }>(client, `/order-picks/${idOf(order)}/to-production`, {});
          onMessage?.(r.message || "Üretim emri açıldı.");
        } catch (err) {
          onError?.(apiErrorMessage(err, "Üretim emri açılamadı."));
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const items: ActionTile[] = [
    { key: "print", label: "Yazdır", icon: "print", tone: "slate", busy: busy === "print", testID: `order-print-${idOf(order)}`, onPress: printForm },
    { key: "label", label: "Kargo etiketi", icon: "pricetag", tone: "teal", busy: busy === "label", testID: `order-label-${idOf(order)}`, onPress: printLabel },
    canProduce ? { key: "prod", label: "Üretim emri", icon: "construct", tone: "orange", busy: busy === "prod", testID: `order-prod-${idOf(order)}`, onPress: toProduction } : null,
  ].filter(Boolean) as ActionTile[];

  return (
    <>
      <ActionTiles items={items} columns={3} size={size} />
      {busy ? <Muted>Hazırlanıyor…</Muted> : null}
    </>
  );
}

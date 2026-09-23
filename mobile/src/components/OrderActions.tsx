import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { colors } from "../theme";
import type { Order } from "../types";
import { approveOrderBody, approveOrderConfirm, canApproveOrder, isMarketplaceChannel } from "../utils/orderApprove";
import {
  approveActionLabel,
  canApproveMarketplaceOrder,
  canChangeMarketplaceCargo,
  canShowMarketplaceApprove,
  cargoChangeBody,
  cargoChangeConfirm,
  cargoNameOf,
  cargoSelectGroups,
  FALLBACK_CARGO_CATALOG,
  type CargoCatalogItem,
} from "../utils/orderCargo";
import { idOf } from "../utils/money";
import { go } from "../nav";
import { canStaffDeleteOrder, canStaffEditOrder } from "../utils/orderEdit";
import {
  canCreateOrderDraftInvoice,
  canIssueOrderEBelge,
  canPostOrderDraftInvoice,
  convertToDraftBody,
  eBelgeCreateBody,
  faturalaActionLabel,
  isOrderFullyInvoiced,
} from "../utils/orderInvoice";
import { printCargoLabel, printOrderForm } from "../utils/orderShare";
import { QUICK_TONE_COLORS, type QuickTone } from "../utils/quickMenu";
import { ActionTiles, type ActionTile } from "./ActionTiles";
import { B2BSheet } from "./b2b/B2BSheet";
import { confirmAction } from "./chips";
import { GroupedSelect } from "./GroupedSelect";
import { Muted, PrimaryButton } from "./kit";

type ActionDef = {
  key: string;
  label: string;
  icon: ActionTile["icon"];
  tone: QuickTone;
  busyKey: string;
  testID: string;
  onPress: () => void;
};

function ActionPills({ items, busy }: { items: ActionDef[]; busy: string | null }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 4, paddingBottom: 8 }}>
      {items.map((item) => {
        const tone = QUICK_TONE_COLORS[item.tone];
        const waiting = busy === item.busyKey;
        return (
          <Pressable
            key={item.key}
            testID={item.testID}
            onPress={item.onPress}
            disabled={!!busy}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: tone.border,
              backgroundColor: tone.bg,
              opacity: busy && !waiting ? 0.45 : pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name={waiting ? "hourglass-outline" : item.icon} size={13} color={tone.solid} />
            <Text style={{ fontWeight: "800", fontSize: 11, color: colors.text }}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function OrderActions({
  order,
  size = "xs",
  compact = false,
  onMessage,
  onError,
  onChanged,
  onDeleted,
}: {
  order: Order;
  size?: "xs" | "sm";
  compact?: boolean;
  onMessage?: (text: string) => void;
  onError?: (text: string) => void;
  onChanged?: () => void;
  onDeleted?: () => void;
}) {
  const { client, activeCompany, companyId, can } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [cargoOpen, setCargoOpen] = useState(false);
  const [carriers, setCarriers] = useState<CargoCatalogItem[]>(FALLBACK_CARGO_CATALOG);
  const [carrier, setCarrier] = useState(String(order.cargo_carrier || ""));
  const canProduce = can("/production", "edit") || can("/sevk", "edit") || can("/orders", "edit");
  const canEdit = can("/orders", "edit");
  const canMutate = canEdit || can("/saha", "edit");
  const marketplace = isMarketplaceChannel(order.channel);
  const oid = idOf(order);

  const ensure = async () => {
    if (order.items?.length) return order;
    return get<Order>(client, `/orders/${oid}`);
  };

  const printForm = async () => {
    setBusy("print");
    try {
      await printOrderForm(await ensure(), activeCompany, client);
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
      const full = await get<Order>(client, `/orders/${oid}`);
      const kind = await printCargoLabel(full, activeCompany, client);
      post(client, "/orders/mark-labels-printed", { ids: [idOf(full)] }).catch(() => null);
      onMessage?.(kind === "official"
        ? "Pazaryeri / kargo etiketi yazdırmaya gönderildi."
        : "Kargo etiketi yazdırmaya gönderildi.");
    } catch (err) {
      onError?.(apiErrorMessage(err, "Etiket yazdırılamadı."));
    } finally {
      setBusy(null);
    }
  };

  const approve = () => {
    if (marketplace && !canApproveMarketplaceOrder(order)) {
      onError?.("Sipariş pazaryerinde onaylanacak durumda değil.");
      return;
    }
    if (!marketplace && !canApproveOrder(order)) return;
    confirmAction(approveActionLabel(order), approveOrderConfirm(order), async () => {
      setBusy("approve");
      try {
        const r = await post<{ message?: string }>(client, `/orders/${oid}/approve`, approveOrderBody(order));
        onMessage?.(r.message || "Sipariş onaylandı; pazaryeri entegrasyonuna iletildi.");
        onChanged?.();
      } catch (err) {
        onError?.(apiErrorMessage(err, "Sipariş onaylanamadı."));
      } finally {
        setBusy(null);
      }
    });
  };

  const openCargo = async () => {
    setCarrier(String(order.cargo_carrier || ""));
    setCargoOpen(true);
    try {
      const list = await get<CargoCatalogItem[]>(client, "/integrations/cargo/catalog", { company_id: companyId });
      setCarriers(list?.length ? list : FALLBACK_CARGO_CATALOG);
    } catch {
      setCarriers(FALLBACK_CARGO_CATALOG);
    }
  };

  const saveCargo = () => {
    if (!carrier) {
      onError?.("Kargo firması seçin.");
      return;
    }
    const name = cargoNameOf(carriers, carrier, order.cargo_carrier_name);
    confirmAction("Kargo firması", cargoChangeConfirm(order, name), async () => {
      setBusy("cargo");
      try {
        const r = await put<{ message?: string }>(client, `/orders/${oid}/cargo-carrier`, cargoChangeBody(carrier));
        onMessage?.(r.message || "Pazaryeri kargo firması güncellendi.");
        setCargoOpen(false);
        onChanged?.();
      } catch (err) {
        onError?.(apiErrorMessage(err, "Kargo firması güncellenemedi."));
      } finally {
        setBusy(null);
      }
    });
  };

  const remove = () => {
    if (!canStaffDeleteOrder(order)) {
      onError?.("Faturalanmış sipariş silinemez.");
      return;
    }
    confirmAction("Siparişi sil", `${order.order_number || "Sipariş"} çöp kutusuna taşınsın mı?`, async () => {
      setBusy("delete");
      try {
        const r = await del<{ message?: string }>(client, `/orders/${oid}`);
        onMessage?.(r.message || "Sipariş silindi.");
        onChanged?.();
        onDeleted?.();
      } catch (err) {
        onError?.(apiErrorMessage(err, "Silinemedi."));
      } finally {
        setBusy(null);
      }
    });
  };

  const toProduction = () => {
    confirmAction(
      "Üretim emri",
      `${order.order_number || "Sipariş"} için eksik kalemler üretime alınsın mı?`,
      async () => {
        setBusy("prod");
        try {
          const r = await post<{ message?: string }>(client, `/order-picks/${oid}/to-production`, {});
          onMessage?.(r.message || "Üretim emri açıldı.");
        } catch (err) {
          onError?.(apiErrorMessage(err, "Üretim emri açılamadı."));
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const createDraftInvoice = () => {
    confirmAction(
      "Taslak fatura",
      `${order.order_number || "Sipariş"} için taslak fatura oluşturulsun mu? Cari bakiyesine hemen işlenmez.`,
      async () => {
        setBusy("invoice");
        try {
          const r = await post<{ message?: string; invoice_number?: string }>(
            client,
            `/orders/${oid}/convert-to-invoice`,
            convertToDraftBody("e_archive"),
          );
          onMessage?.(r.message || `Taslak fatura kaydedildi${r.invoice_number ? `: ${r.invoice_number}` : ""}.`);
          onChanged?.();
        } catch (err) {
          onError?.(apiErrorMessage(err, "Taslak fatura oluşturulamadı."));
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const postDraftInvoice = () => {
    const invId = order.invoice_id;
    if (!invId) {
      onError?.("Bu siparişte taslak fatura yok.");
      return;
    }
    confirmAction(
      "Cariye işle",
      `${order.order_number || "Sipariş"} taslak faturası onaylansın mı?\nCari bakiyesi ve stok işlenecek.`,
      async () => {
        setBusy("invoice");
        try {
          const r = await post<{ message?: string }>(client, `/invoices/${invId}/approve`, {});
          onMessage?.(r.message || "Fatura onaylandı; cari bakiyesi işlendi.");
          onChanged?.();
        } catch (err) {
          onError?.(apiErrorMessage(err, "Fatura onaylanamadı."));
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const issueEBelge = (eType: "e_invoice" | "e_archive") => {
    const label = eType === "e_invoice" ? "E-Fatura" : "E-Arşiv";
    confirmAction(
      `${label} (GİB)`,
      `${order.order_number || "Sipariş"} için ${label} GİB'e iletilsin mi?`,
      async () => {
        setBusy("ebelge");
        try {
          let invoiceId = order.invoice_id;
          if (!invoiceId) {
            const draft = await post<{ invoice_id?: string }>(
              client,
              `/orders/${oid}/convert-to-invoice`,
              convertToDraftBody(eType),
            );
            invoiceId = draft.invoice_id;
          }
          const r = await post<{ message?: string }>(
            client,
            "/e-invoice/create",
            eBelgeCreateBody({
              orderId: oid,
              invoiceId,
              companyId: companyId || activeCompany?.id || "",
              eType,
            }),
          );
          onMessage?.(r.message || `${label} GİB'e iletildi.`);
          onChanged?.();
        } catch (err) {
          onError?.(apiErrorMessage(err, `${label} kesilemedi.`));
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const showApprove = canEdit && (marketplace ? canShowMarketplaceApprove(order) : canApproveOrder(order));
  const showCargo = canEdit && canChangeMarketplaceCargo(order);
  const showEdit = canMutate && canStaffEditOrder(order);
  const showDelete = canMutate && canStaffDeleteOrder(order);
  const canInvoice = can("/invoices", "edit") || canEdit;
  const showDraftCreate = canInvoice && canCreateOrderDraftInvoice(order);
  const showDraftPost = canInvoice && canPostOrderDraftInvoice(order);
  const showEBelge = canInvoice && canIssueOrderEBelge(order);
  const showInvoiced = isOrderFullyInvoiced(order);

  const defs: ActionDef[] = [
    ...(showEdit
      ? [{ key: "edit", label: "Düzenle", icon: "create" as const, tone: "slate" as const, busyKey: "edit", testID: `order-edit-${oid}`, onPress: () => go("OrderEdit", { id: oid }) }]
      : []),
    ...(showDelete
      ? [{ key: "delete", label: "Sil", icon: "trash" as const, tone: "rose" as const, busyKey: "delete", testID: `order-delete-${oid}`, onPress: remove }]
      : []),
    ...(showDraftCreate
      ? [{ key: "invoice", label: faturalaActionLabel(order), icon: "document-text" as const, tone: "emerald" as const, busyKey: "invoice", testID: `order-faturala-${oid}`, onPress: createDraftInvoice }]
      : []),
    ...(showDraftPost
      ? [{ key: "invoice", label: faturalaActionLabel(order), icon: "document-text" as const, tone: "amber" as const, busyKey: "invoice", testID: `order-faturala-${oid}`, onPress: postDraftInvoice }]
      : []),
    ...(showInvoiced
      ? [{ key: "invoiced", label: "Faturalandı", icon: "checkmark-done" as const, tone: "emerald" as const, busyKey: "invoiced", testID: `order-invoiced-${oid}`, onPress: () => onMessage?.(order.invoice_number ? `Fatura: ${order.invoice_number}` : "Sipariş faturalandı.") }]
      : []),
    ...(showEBelge
      ? [
          { key: "efatura", label: "E-Fatura", icon: "receipt" as const, tone: "indigo" as const, busyKey: "ebelge", testID: `order-ebelge-efatura-${oid}`, onPress: () => issueEBelge("e_invoice") },
          { key: "earsiv", label: "E-Arşiv", icon: "receipt" as const, tone: "violet" as const, busyKey: "ebelge", testID: `order-ebelge-earsiv-${oid}`, onPress: () => issueEBelge("e_archive") },
        ]
      : []),
    ...(showCargo
      ? [{ key: "cargo", label: "Kargo firma", icon: "car" as const, tone: "violet" as const, busyKey: "cargo", testID: `order-cargo-${oid}`, onPress: openCargo }]
      : []),
    ...(showApprove
      ? [{ key: "approve", label: approveActionLabel(order), icon: "checkmark-circle" as const, tone: "emerald" as const, busyKey: "approve", testID: `order-approve-${oid}`, onPress: approve }]
      : []),
    { key: "print", label: "Yazdır", icon: "print", tone: "slate", busyKey: "print", testID: `order-print-${oid}`, onPress: printForm },
    { key: "label", label: "Kargo etiketi", icon: "pricetag", tone: "teal", busyKey: "label", testID: `order-label-${oid}`, onPress: printLabel },
    ...(canProduce
      ? [{ key: "prod", label: "Üretim emri", icon: "construct" as const, tone: "orange" as const, busyKey: "prod", testID: `order-prod-${oid}`, onPress: toProduction }]
      : []),
  ];

  const sheet = (
    <B2BSheet
      visible={cargoOpen}
      title="Pazaryeri kargo firması"
      subtitle={order.order_number}
      onClose={() => setCargoOpen(false)}
      testID={`order-cargo-sheet-${oid}`}
    >
      <GroupedSelect
        label="Kargo firması"
        testID={`order-cargo-select-${oid}`}
        value={carrier}
        onChange={setCarrier}
        groups={cargoSelectGroups(carriers, order.cargo_carrier, order.cargo_carrier_name)}
        emptyLabel="Kargo firması seçin"
      />
      <View style={{ height: 10 }} />
      <PrimaryButton
        title="Pazaryerine kaydet"
        testID={`order-cargo-save-${oid}`}
        loading={busy === "cargo"}
        disabled={!carrier || !!busy}
        onPress={saveCargo}
      />
    </B2BSheet>
  );

  if (compact) {
    return (
      <>
        <ActionPills items={defs} busy={busy} />
        {busy ? <Muted>Hazırlanıyor…</Muted> : null}
        {sheet}
      </>
    );
  }

  const items: ActionTile[] = defs.map((d) => ({
    key: d.key,
    label: d.label,
    icon: d.icon,
    tone: d.tone,
    busy: busy === d.busyKey,
    testID: d.testID,
    onPress: d.onPress,
  }));

  return (
    <>
      <ActionTiles items={items} columns={3} size={size} />
      {busy ? <Muted>Hazırlanıyor…</Muted> : null}
      {sheet}
    </>
  );
}

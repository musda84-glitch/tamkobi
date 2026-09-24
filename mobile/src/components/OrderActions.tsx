import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { go } from "../nav";
import { colors } from "../theme";
import type { Invoice, Order } from "../types";
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
import { waDigits } from "../utils/contactStatement";
import { idOf } from "../utils/money";
import { canStaffDeleteOrder, canStaffEditOrder } from "../utils/orderEdit";
import {
  canCreateOrderDraftInvoice,
  canIssueOrderEBelge,
  canPostOrderDraftInvoice,
  canShowEFaturaOption,
  convertToDraftBody,
  eBelgeCreateBody,
  faturalaActionLabel,
  isOrderFullyInvoiced,
  orderEBelgeTypeFromContact,
} from "../utils/orderInvoice";
import {
  canReturnOrder,
  dispatchMenuLabel,
  eBelgeMenuItems,
  orderMoreMenuSections,
  orderNotifyMessage,
  orderNotifySubject,
  orderToolbarKeys,
  printMenuLabel,
  type OrderMoreKey,
} from "../utils/orderMoreMenu";
import { printCargoLabel, printInvoiceForm, printOrderForm } from "../utils/orderShare";
import { emailComposerHref, smsComposerHref, smsSendFailed } from "../utils/quoteApproval";
import { QUICK_TONE_COLORS, type QuickTone } from "../utils/quickMenu";
import { B2BSheet } from "./b2b/B2BSheet";
import { Chip, confirmAction } from "./chips";
import { GroupedSelect } from "./GroupedSelect";
import { Field, Muted, PrimaryButton, Row } from "./kit";

type ActionDef = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: QuickTone;
  busyKey: string;
  testID: string;
  onPress: () => void;
};

function IconBtn({
  item,
  busy,
  title,
  testID,
}: {
  item: ActionDef;
  busy: string | null;
  title?: string;
  testID?: string;
}) {
  const tone = QUICK_TONE_COLORS[item.tone];
  const waiting = busy === item.busyKey;
  return (
    <Pressable
      testID={testID || item.testID}
      accessibilityLabel={title || item.label}
      onPress={item.onPress}
      disabled={!!busy && item.key !== "more"}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tone.bg,
        borderWidth: 1,
        borderColor: tone.border,
        opacity: busy && !waiting && item.key !== "more" ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={waiting ? "hourglass-outline" : item.icon} size={16} color={tone.solid} />
    </Pressable>
  );
}

export function OrderActions({
  order,
  compact: _compact = false,
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyPhone, setNotifyPhone] = useState(order.customer_phone || "");
  const [notifyEmail, setNotifyEmail] = useState(order.customer_email || "");
  const [notifyBody, setNotifyBody] = useState(() => orderNotifyMessage(order));
  const [notifyChannel, setNotifyChannel] = useState<"sms" | "email" | "whatsapp">(order.customer_phone ? "sms" : "email");
  const [carriers, setCarriers] = useState<CargoCatalogItem[]>(FALLBACK_CARGO_CATALOG);
  const [carrier, setCarrier] = useState(String(order.cargo_carrier || ""));
  const [contactFlag, setContactFlag] = useState<{ is_e_invoice_user?: boolean } | null>(null);
  const canProduce = can("/production", "edit") || can("/sevk", "edit") || can("/orders", "edit");
  const canEdit = can("/orders", "edit");
  const canMutate = canEdit || can("/saha", "edit");
  const marketplace = isMarketplaceChannel(order.channel);
  const oid = idOf(order);
  const num = order.order_number || oid;

  useEffect(() => {
    const cid = order.contact_id;
    if (!cid) {
      setContactFlag(null);
      return;
    }
    let cancelled = false;
    get<{ contact?: { is_e_invoice_user?: boolean }; is_e_invoice_user?: boolean }>(client, `/contacts/${cid}/overview`)
      .then((ov) => {
        if (cancelled) return;
        const flag = !!(ov?.contact?.is_e_invoice_user ?? ov?.is_e_invoice_user);
        setContactFlag({ is_e_invoice_user: flag });
      })
      .catch(() => { if (!cancelled) setContactFlag(null); });
    return () => { cancelled = true; };
  }, [client, order.contact_id]);

  const ensure = async () => {
    if (order.items?.length) return order;
    return get<Order>(client, `/orders/${oid}`);
  };

  const printForm = async () => {
    setMoreOpen(false);
    setBusy("print");
    try {
      await printOrderForm(await ensure(), activeCompany, client);
      post(client, "/orders/mark-form-printed", { ids: [oid] }).catch(() => null);
      onMessage?.("Sipariş formu yazdırmaya gönderildi.");
      onChanged?.();
    } catch (err) {
      onError?.(apiErrorMessage(err, "Yazdırılamadı."));
    } finally {
      setBusy(null);
    }
  };

  const printLabel = async () => {
    setMoreOpen(false);
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
    setMoreOpen(false);
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
    setMoreOpen(false);
    const resolved = eType === "e_invoice" && !canShowEFaturaOption(contactFlag)
      ? "e_archive"
      : (eType || orderEBelgeTypeFromContact(contactFlag));
    const label = resolved === "e_invoice" ? "E-Fatura" : "E-Arşiv";
    confirmAction(
      `${label} (GİB)`,
      resolved !== eType && eType === "e_invoice"
        ? `${order.order_number || "Sipariş"} cari e-fatura mükellefi değil; E-Arşiv GİB'e iletilsin mi?`
        : `${order.order_number || "Sipariş"} için ${label} GİB'e iletilsin mi?`,
      async () => {
        setBusy("ebelge");
        try {
          let invoiceId = order.invoice_id;
          if (!invoiceId) {
            const draft = await post<{ invoice_id?: string }>(
              client,
              `/orders/${oid}/convert-to-invoice`,
              convertToDraftBody(resolved),
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
              eType: resolved,
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

  const makeDispatch = () => {
    setMoreOpen(false);
    confirmAction(
      "E-İrsaliye",
      order.dispatch_number
        ? `${order.dispatch_number} irsaliyesi yazdırılsın mı?`
        : `${order.order_number || "Sipariş"} için e-irsaliye oluşturulsun ve yazdırılsın mı?`,
      async () => {
        setBusy("dispatch");
        try {
          const r = await post<{ message?: string; dispatch?: Invoice }>(client, `/orders/${oid}/create-dispatch`, {});
          if (r.dispatch) {
            await printInvoiceForm(r.dispatch, activeCompany, client);
          }
          onMessage?.(r.message || "E-irsaliye hazır.");
          onChanged?.();
        } catch (err) {
          onError?.(apiErrorMessage(err, "İrsaliye oluşturulamadı."));
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const openReturn = () => {
    setMoreOpen(false);
    setReturnReason("");
    setReturnOpen(true);
  };

  const saveReturn = () => {
    confirmAction(
      "İade Al",
      `${order.order_number || "Sipariş"} iade alınsın mı? Tüm kalemler iade edilir ve stok geri eklenir.`,
      async () => {
        setBusy("return");
        try {
          const r = await post<{ message?: string }>(client, `/orders/${oid}/return`, {
            reason: returnReason.trim(),
            restock: true,
          });
          onMessage?.(r.message || "İade kaydedildi.");
          setReturnOpen(false);
          onChanged?.();
        } catch (err) {
          onError?.(apiErrorMessage(err, "İade kaydedilemedi."));
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const openNotify = () => {
    setMoreOpen(false);
    setNotifyPhone(order.customer_phone || "");
    setNotifyEmail(order.customer_email || "");
    setNotifyBody(orderNotifyMessage(order));
    setNotifyChannel(order.customer_phone ? "sms" : order.customer_email ? "email" : "whatsapp");
    setNotifyOpen(true);
  };

  const sendNotify = async () => {
    const body = notifyBody.trim();
    if (!body) {
      onError?.("Mesaj boş olamaz.");
      return;
    }
    setBusy("notify");
    try {
      if (notifyChannel === "whatsapp") {
        const digits = waDigits(notifyPhone);
        if (!digits) throw new Error("Telefon numarası girin.");
        await Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(body)}`);
        post(client, "/comm/whatsapp/logs", {
          company_id: companyId,
          phone: notifyPhone,
          message: body,
          context: "order",
          ref_id: oid,
        }).catch(() => null);
        onMessage?.("WhatsApp açıldı.");
        setNotifyOpen(false);
        return;
      }
      if (notifyChannel === "sms") {
        if (!notifyPhone.trim()) throw new Error("Telefon numarası girin.");
        const r = await post<{ status?: string; sent?: number; failed?: number; simulated?: boolean; message?: string; error?: string }>(
          client,
          "/comm/sms/send",
          {
            company_id: companyId,
            phone: notifyPhone,
            message: body,
            contact_id: order.contact_id,
            contact_name: order.customer_name,
            context: "order",
            ref_id: oid,
          },
        );
        if (r.simulated || smsSendFailed(r)) {
          await Linking.openURL(smsComposerHref(notifyPhone, body));
          onMessage?.(r.message || "Telefon SMS uygulaması açıldı.");
        } else {
          onMessage?.(r.message || "SMS gönderildi.");
        }
        setNotifyOpen(false);
        return;
      }
      if (!notifyEmail.trim()) throw new Error("E-posta girin.");
      try {
        await post(client, "/comm/mail/send", {
          company_id: companyId,
          to: notifyEmail,
          subject: orderNotifySubject(order.order_number),
          body,
          context: "order",
          ref_id: oid,
          contact_id: order.contact_id,
          contact_name: order.customer_name,
        });
        onMessage?.("E-posta gönderildi.");
      } catch {
        await Linking.openURL(emailComposerHref(notifyEmail, orderNotifySubject(order.order_number), body));
        onMessage?.("E-posta uygulaması açıldı.");
      }
      setNotifyOpen(false);
    } catch (err) {
      onError?.(apiErrorMessage(err, "Bildirim gönderilemedi."));
    } finally {
      setBusy(null);
    }
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
  const showEFatura = canShowEFaturaOption(contactFlag);
  const showReturn = canMutate && canReturnOrder(order.order_status);
  const formPrinted = !!order.form_printed_at;

  const flags = {
    showDelete,
    showInvoice: showDraftCreate || showDraftPost,
    showInvoiced,
    showCargo,
    showApprove,
    showEBelge,
    showEFatura,
    showEdit,
    showReturn,
    showProduce: canProduce,
    dispatchNumber: order.dispatch_number,
    formPrinted,
  };

  const invoicePress = showDraftPost ? postDraftInvoice : createDraftInvoice;
  const byKey: Record<string, ActionDef> = {
      delete: { key: "delete", label: "Sil", icon: "trash", tone: "rose", busyKey: "delete", testID: `order-delete-${oid}`, onPress: remove },
      invoice: {
        key: "invoice",
        label: faturalaActionLabel(order),
        icon: "document-text",
        tone: showDraftPost ? "amber" : "emerald",
        busyKey: "invoice",
        testID: `order-faturala-${oid}`,
        onPress: invoicePress,
      },
      invoiced: {
        key: "invoiced",
        label: "Faturalandı",
        icon: "checkmark-done",
        tone: "emerald",
        busyKey: "invoiced",
        testID: `order-invoiced-${oid}`,
        onPress: () => onMessage?.(order.invoice_number ? `Fatura: ${order.invoice_number}` : "Sipariş faturalandı."),
      },
      cargo: { key: "cargo", label: "Kargo firma", icon: "car", tone: "violet", busyKey: "cargo", testID: `order-cargo-${oid}`, onPress: openCargo },
      approve: { key: "approve", label: approveActionLabel(order), icon: "checkmark-circle", tone: "emerald", busyKey: "approve", testID: `order-approve-${oid}`, onPress: approve },
      print: {
        key: "print",
        label: printMenuLabel(formPrinted),
        icon: "print",
        tone: formPrinted ? "violet" : "slate",
        busyKey: "print",
        testID: `print-order-btn-${num}`,
        onPress: printForm,
      },
      more: {
        key: "more",
        label: "Diğer işlemler",
        icon: "ellipsis-vertical",
        tone: moreOpen ? "slate" : "slate",
        busyKey: "more",
        testID: `order-more-btn-${num}`,
        onPress: () => setMoreOpen(true),
      },
      edit: {
        key: "edit",
        label: "Siparişi Düzenle",
        icon: "create",
        tone: "slate",
        busyKey: "edit",
        testID: `edit-order-menu-${num}`,
        onPress: () => { setMoreOpen(false); go("OrderEdit", { id: oid }); },
      },
      dispatch: {
        key: "dispatch",
        label: dispatchMenuLabel(order.dispatch_number),
        icon: "cube-outline",
        tone: "orange",
        busyKey: "dispatch",
        testID: `dispatch-btn-${num}`,
        onPress: makeDispatch,
      },
      return: {
        key: "return",
        label: "İade Al",
        icon: "return-down-back",
        tone: "rose",
        busyKey: "return",
        testID: `return-order-btn-${num}`,
        onPress: openReturn,
      },
      label: {
        key: "label",
        label: "Kargo Etiketi Yazdır",
        icon: "pricetag",
        tone: "teal",
        busyKey: "label",
        testID: `cargo-label-btn-${num}`,
        onPress: printLabel,
      },
      notify: {
        key: "notify",
        label: "Müşteriye Bildirim Gönder",
        icon: "chatbubble-ellipses",
        tone: "indigo",
        busyKey: "notify",
        testID: `notify-order-btn-${num}`,
        onPress: openNotify,
      },
      prod: {
        key: "prod",
        label: "Üretim emri",
        icon: "construct",
        tone: "orange",
        busyKey: "prod",
        testID: `order-prod-${oid}`,
        onPress: toProduction,
      },
    };
  for (const item of eBelgeMenuItems(showEFatura)) {
    byKey[item.key] = {
      key: item.key,
      label: item.label,
      icon: "receipt",
      tone: item.eType === "e_invoice" ? "indigo" : "violet",
      busyKey: "ebelge",
      testID: `e-belge-${item.testIdSuffix}-${num}`,
      onPress: () => issueEBelge(item.eType),
    };
  }

  const toolbar = orderToolbarKeys(flags).map((key) => byKey[key]).filter(Boolean);
  const sections = orderMoreMenuSections(flags);

  return (
    <>
      <View
        testID={`order-actions-${num}`}
        style={{ flexDirection: "row", alignItems: "center", flexWrap: "nowrap", gap: 4, paddingTop: 4, paddingBottom: 8 }}
      >
        {toolbar.map((item) => (
          <IconBtn key={item.key} item={item} busy={busy} title={item.label} />
        ))}
      </View>
      {busy ? <Muted>Hazırlanıyor…</Muted> : null}

      <B2BSheet
        visible={moreOpen}
        title="Diğer işlemler"
        subtitle={order.order_number}
        onClose={() => setMoreOpen(false)}
        testID={`order-more-menu-${num}`}
      >
        {sections.map((section, si) => (
          <View key={section.title || `sec-${si}`} style={{ marginBottom: 8 }}>
            {section.title ? (
              <Text style={{ fontSize: 10, fontWeight: "800", color: "#94A3B8", letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 4, paddingBottom: 6 }}>
                {section.title}
              </Text>
            ) : null}
            {section.keys.map((key: OrderMoreKey, idx) => {
              const item = byKey[key];
              if (!item) return null;
              const tone = QUICK_TONE_COLORS[item.tone];
              const last = idx === section.keys.length - 1 && si === 0;
              return (
                <Pressable
                  key={item.key}
                  testID={item.testID}
                  onPress={item.onPress}
                  disabled={!!busy}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingVertical: 11,
                    paddingHorizontal: 8,
                    borderRadius: 10,
                    backgroundColor: pressed ? colors.slate50 : "transparent",
                    borderBottomWidth: last ? 1 : 0,
                    borderBottomColor: colors.border,
                    marginBottom: last ? 6 : 0,
                    opacity: busy ? 0.5 : 1,
                  })}
                >
                  <Ionicons name={busy === item.busyKey ? "hourglass-outline" : item.icon} size={18} color={tone.solid} />
                  <Text style={{ flex: 1, fontWeight: "700", fontSize: 13, color: colors.text }} numberOfLines={1}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </B2BSheet>

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

      <B2BSheet
        visible={returnOpen}
        title="İade Al"
        subtitle={order.order_number}
        onClose={() => setReturnOpen(false)}
        testID="return-modal"
      >
        <Muted>Tüm kalemler iade alınır, stok geri eklenir ve iade kaydı oluşturulur.</Muted>
        <View style={{ height: 10 }} />
        <Field
          label="İade nedeni"
          testID="return-reason-input"
          value={returnReason}
          onChangeText={setReturnReason}
          placeholder="İade nedeni"
          multiline
        />
        <View style={{ height: 10 }} />
        <PrimaryButton
          title="İadeyi Kaydet"
          testID="return-confirm-btn"
          loading={busy === "return"}
          disabled={!!busy}
          onPress={saveReturn}
        />
      </B2BSheet>

      <B2BSheet
        visible={notifyOpen}
        title="Müşteriye Bildirim Gönder"
        subtitle={order.order_number}
        onClose={() => setNotifyOpen(false)}
        testID={`notify-order-sheet-${num}`}
      >
        <Row style={{ gap: 6, marginBottom: 10 }}>
          <Chip compact label="SMS" active={notifyChannel === "sms"} testID="notify-tab-sms" onPress={() => setNotifyChannel("sms")} />
          <Chip compact label="E-posta" active={notifyChannel === "email"} testID="notify-tab-email" onPress={() => setNotifyChannel("email")} />
          <Chip compact label="WhatsApp" active={notifyChannel === "whatsapp"} testID="notify-tab-whatsapp" color="#128C7E" onPress={() => setNotifyChannel("whatsapp")} />
        </Row>
        {notifyChannel === "email" ? (
          <Field label="E-posta" testID="notify-email" value={notifyEmail} onChangeText={setNotifyEmail} keyboardType="email-address" />
        ) : (
          <Field label="Telefon" testID="notify-phone" value={notifyPhone} onChangeText={setNotifyPhone} keyboardType="phone-pad" />
        )}
        <Field label="Mesaj" testID="notify-body" value={notifyBody} onChangeText={setNotifyBody} multiline />
        <View style={{ height: 10 }} />
        <PrimaryButton
          title="Gönder"
          testID="notify-send"
          loading={busy === "notify"}
          disabled={!!busy}
          onPress={sendNotify}
        />
      </B2BSheet>
    </>
  );
}

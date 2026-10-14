import React, { useState } from "react";
import { Alert, Platform, Pressable, Text } from "react-native";
import { post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import type { Invoice } from "../types";
import type { EfaturaOnayPayload } from "../utils/efaturaOnay";
import {
  canFaturalastirDraftInvoice,
  DRAFT_FATURALASTIR_TYPES,
  draftFaturalastirNeedsOnay,
  issueInvoiceFromOnay,
  type DraftFaturalastirType,
} from "../utils/invoiceFaturalastir";
import { askInvoiceDatePrompt, INVOICE_DATE_PROMPT, shouldAskInvoiceDatePrompt } from "../utils/invoiceDocDate";
import { colors } from "../theme";
import { B2BSheet } from "./b2b/B2BSheet";
import { ElektronikFaturaOnayModal } from "./ElektronikFaturaOnayModal";
import { Muted, PrimaryButton, Row } from "./kit";

export function DraftInvoiceFaturalastir({
  invoice,
  allowed,
  busy = false,
  onIssued,
  onError,
  testID,
}: {
  invoice: Invoice;
  allowed: boolean;
  busy?: boolean;
  onIssued?: (message: string) => void;
  onError?: (message: string) => void;
  testID?: string;
}) {
  const { client } = useAuth();
  const [typeOpen, setTypeOpen] = useState(false);
  const [onayOpen, setOnayOpen] = useState(false);
  const [preferred, setPreferred] = useState<"e_invoice" | "e_archive" | null>(null);
  const [stampNow, setStampNow] = useState(true);
  const [sending, setSending] = useState(false);

  if (!allowed || !canFaturalastirDraftInvoice(invoice)) return null;
  const id = invoice.id || invoice._id;
  const tid = testID || `draft-faturalastir-${invoice.invoice_number || id || "inv"}`;

  const openOnay = (eType: "e_invoice" | "e_archive", stamp: boolean) => {
    setPreferred(eType);
    setStampNow(stamp);
    setOnayOpen(true);
  };

  const pickType = (eType: DraftFaturalastirType) => {
    setTypeOpen(false);
    if (draftFaturalastirNeedsOnay(eType)) {
      const open = (stamp: boolean) => openOnay(eType === "e_archive" ? "e_archive" : "e_invoice", stamp);
      if (shouldAskInvoiceDatePrompt(invoice)) {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const stamp = window.confirm(`${INVOICE_DATE_PROMPT.message}\n\nTamam = ${INVOICE_DATE_PROMPT.stampNowLabel}`);
          open(stamp);
          return;
        }
        askInvoiceDatePrompt((choice) => open(choice === "stamp_now"), (title, message, buttons) => {
          Alert.alert(title, message, buttons as never);
        });
        return;
      }
      open(true);
      return;
    }
    setSending(true);
    const label = DRAFT_FATURALASTIR_TYPES.find((t) => t.key === eType)?.label || eType;
    post(client, `/invoices/${id}/send-to-gib`, { e_type: eType })
      .then(() => onIssued?.(`${label} olarak kesildi.`))
      .catch((err) => onError?.(apiErrorMessage(err, "Fatura kesilemedi.")))
      .finally(() => setSending(false));
  };

  const confirmOnay = async (payload: EfaturaOnayPayload) => {
    const label = payload.eType === "e_invoice" ? "E-Fatura" : "E-Arşiv";
    setSending(true);
    try {
      await issueInvoiceFromOnay(client, invoice, payload);
      setOnayOpen(false);
      onIssued?.(`${label} olarak kesildi.`);
    } catch (err) {
      onError?.(apiErrorMessage(err, "Fatura kesilemedi."));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PrimaryButton
        title="Taslağı faturalaştır"
        testID={tid}
        color={colors.primary}
        loading={busy || sending}
        onPress={() => setTypeOpen(true)}
      />
      <B2BSheet
        visible={typeOpen}
        title="Taslağı faturalaştır"
        subtitle="Belge türünü seçin — E-Fatura / E-Arşiv siparişteki onay penceresini açar."
        onClose={() => setTypeOpen(false)}
        testID={`${tid}-types`}
      >
        <Muted>E-Fatura, E-Arşiv, e-İhracat veya GİB&apos;e gönderilmeyen / kağıt fatura.</Muted>
        <Row style={{ flexWrap: "wrap" }}>
          {DRAFT_FATURALASTIR_TYPES.map((t) => (
            <Pressable
              key={t.key}
              testID={`${tid}-type-${t.key}`}
              onPress={() => pickType(t.key)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: "#fff",
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ fontWeight: "700", fontSize: 12, color: colors.text }}>{t.label}</Text>
            </Pressable>
          ))}
        </Row>
      </B2BSheet>
      <ElektronikFaturaOnayModal
        visible={onayOpen}
        invoice={invoice}
        preferredEType={preferred}
        initialStampNow={stampNow}
        onClose={() => setOnayOpen(false)}
        onConfirm={confirmOnay}
      />
    </>
  );
}

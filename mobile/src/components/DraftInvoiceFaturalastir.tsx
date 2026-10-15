import React, { useState } from "react";
import { post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import type { Invoice } from "../types";
import { canFaturalastirDraftInvoice } from "../utils/invoiceFaturalastir";
import { faturalastirConfirmMessage } from "../utils/orderMoreMenu";
import { PrimaryButton } from "./kit";
import { confirmAction } from "./chips";

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
  const [sending, setSending] = useState(false);

  if (!allowed || !canFaturalastirDraftInvoice(invoice)) return null;
  const id = invoice.id || invoice._id;
  const tid = testID || `draft-faturalastir-${invoice.invoice_number || id || "inv"}`;

  const approve = () => {
    confirmAction(
      "Taslağı Faturalaştır",
      faturalastirConfirmMessage({ invoice_number: invoice.invoice_number }),
      async () => {
        setSending(true);
        try {
          const res = await post<{ message?: string }>(client, `/invoices/${id}/approve`, {});
          onIssued?.(res?.message || "Faturalaştı — cari bakiyesi işlendi.");
        } catch (err) {
          onError?.(apiErrorMessage(err, "Faturalaştırılamadı."));
        } finally {
          setSending(false);
        }
      },
    );
  };

  return (
    <PrimaryButton
      title="Taslağı Faturalaştır"
      testID={tid}
      loading={busy || sending}
      onPress={approve}
    />
  );
}

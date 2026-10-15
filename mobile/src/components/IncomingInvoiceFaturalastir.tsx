import React, { useRef, useState } from "react";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import type { Invoice } from "../types";
import { incomingPurchaseLedgerPosted, isIncomingPurchaseInvoice } from "../utils/invoiceDraft";
import { postIncomingPurchaseInvoice } from "../utils/invoiceFaturalastir";
import { colors } from "../theme";
import { confirmAction } from "./chips";
import { Muted, PrimaryButton } from "./kit";

/**
 * Gelen fatura: sipariş taslağını faturalaştır gibi tek onay.
 * e-Fatura / e-Arşiv / kağıt listesi yok.
 */
export function IncomingInvoiceFaturalastir({
  invoice,
  onPosted,
  onError,
  testID,
}: {
  invoice: Invoice;
  onPosted?: (message: string) => void;
  onError?: (message: string) => void;
  testID?: string;
}) {
  const { client } = useAuth();
  const [sending, setSending] = useState(false);
  const guard = useRef(false);
  if (!isIncomingPurchaseInvoice(invoice)) return null;
  const posted = incomingPurchaseLedgerPosted(invoice);
  const id = invoice.id || invoice._id;
  const tid = testID || `incoming-faturalastir-${invoice.invoice_number || id || "inv"}`;

  const run = () => {
    if (posted || guard.current || !id) return;
    guard.current = true;
    setSending(true);
    postIncomingPurchaseInvoice(client, invoice)
      .then(() => onPosted?.("Cariye işlendi."))
      .catch((err) => onError?.(apiErrorMessage(err, "Faturalaştırılamadı.")))
      .finally(() => {
        guard.current = false;
        setSending(false);
      });
  };

  return (
    <>
      <Muted>Alış faturası olarak cariye ve stoğa işlenir. GİB&apos;e yeniden gönderilmez.</Muted>
      <PrimaryButton
        title={posted ? "Cariye işlendi" : "Faturalaştır"}
        testID={tid}
        color={colors.primary}
        disabled={posted}
        loading={sending}
        onPress={() => {
          if (posted || sending || guard.current) return;
          confirmAction(
            "Faturalaştır",
            `${invoice.invoice_number || "Fatura"} alış faturası olarak cariye işlensin mi?\nCari bakiyesi ve stok işlenecek.`,
            run,
            "Faturalaştır",
          );
        }}
      />
    </>
  );
}

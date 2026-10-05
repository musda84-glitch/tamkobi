import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Mail, Phone, Printer, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { QuickMessageModal } from "./QuickMessageModal";
import {
  INVOICE_PRINT_SHARE_NOTE,
  fetchInvoicePdfFile,
  invoicePdfPublicUrl,
  invoicePrintShareDocFromOrder,
  invoicePrintShareKindLabel,
  invoicePrintShareMessage,
  invoicePrintShareNumber,
  invoicePrintShareSubject,
  whatsappMeUrl,
} from "../utils/invoicePrintShare";

function shareBtnClass(extra) {
  return `flex flex-col items-center justify-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-semibold transition hover:shadow-sm disabled:opacity-50 ${extra}`;
}

export function InvoicePrintShareModal({
  order,
  contact = {},
  companyId,
  companyName,
  onPrint,
  onClose,
}) {
  useEscape(onClose);
  const [busy, setBusy] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailFile, setEmailFile] = useState(null);

  const kind = invoicePrintShareKindLabel(order);
  const no = invoicePrintShareNumber(order);
  const phone = contact.phone || order?.customer_phone || "";
  const email = contact.email || order?.customer_email || "";
  const recipient = {
    contact_id: order?.contact_id || contact.id,
    name: order?.customer_name || contact.name || "",
    phone,
    email,
  };
  const pdfUrl = invoicePdfPublicUrl(
    typeof window !== "undefined" ? window.location.origin : "",
    order?.invoice_id,
  );
  const message = invoicePrintShareMessage(order, { pdfUrl, companyName });
  const subject = invoicePrintShareSubject(order);

  const printNow = () => {
    const doc = invoicePrintShareDocFromOrder(order);
    if (!doc) {
      toast.error("Önce fatura oluşturun.");
      return;
    }
    onPrint?.(doc);
  };

  const openEmail = async () => {
    setBusy("email");
    try {
      let file = null;
      try {
        file = await fetchInvoicePdfFile(
          axios,
          API_URL,
          order.invoice_id,
          `${no || kind}.pdf`,
        );
      } catch {
        /* ek yoksa metin + link gider */
      }
      setEmailFile(file);
      setEmailOpen(true);
    } finally {
      setBusy("");
    }
  };

  const openWhatsApp = async () => {
    const url = whatsappMeUrl(phone, message);
    if (!url) {
      toast.error("Carinin telefon numarası yok.");
      return;
    }
    const popup = window.open("about:blank", "_blank");
    setBusy("whatsapp");
    try {
      let file = null;
      try {
        file = await fetchInvoicePdfFile(axios, API_URL, order.invoice_id, `${no || kind}.pdf`);
      } catch {
        /* dosya paylaşılamazsa wa.me gider */
      }
      const data = { title: subject, text: message };
      if (file) data.files = [file];
      const canFileShare = !data.files || (typeof navigator.canShare === "function" && navigator.canShare(data));
      let shared = false;
      if (typeof navigator.share === "function" && canFileShare) {
        try {
          await navigator.share(data);
          shared = true;
        } catch (err) {
          if (err?.name === "AbortError") {
            if (popup && !popup.closed) popup.close();
            return;
          }
        }
      }
      if (!shared) {
        if (popup && !popup.closed) popup.location.href = url;
        else window.open(url, "_blank", "noopener,noreferrer");
      } else if (popup && !popup.closed) {
        popup.close();
      }
      try {
        await axios.post(`${API_URL}/comm/whatsapp/logs`, {
          company_id: companyId,
          contact_id: recipient.contact_id,
          contact_name: recipient.name,
          phone,
          message,
          direction: "outbound",
          context: "invoice",
          ref_id: order.invoice_id,
        });
      } catch {
        /* log optional */
      }
      toast.success("WhatsApp açıldı.");
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      {!emailOpen && (
      <div
        className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
        {...backdropDismissProps(onClose)}
      >
        <div
          className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200"
          onClick={(e) => e.stopPropagation()}
          data-testid="invoice-print-share-modal"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">{kind} Yazdır & Gönder</h3>
              {no ? <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{no}</p> : null}
            </div>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="invoice-print-share-close">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed" data-testid="invoice-print-share-note">
            {INVOICE_PRINT_SHARE_NOTE}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={printNow}
              disabled={!!busy}
              className={shareBtnClass("bg-slate-900 text-white border-slate-900")}
              data-testid="invoice-print-share-print"
            >
              <Printer className="w-5 h-5" />
              Yazdır
            </button>
            <button
              type="button"
              onClick={openEmail}
              disabled={!!busy}
              className={shareBtnClass("bg-white text-emerald-700 border-emerald-200")}
              data-testid="invoice-print-share-email"
            >
              <Mail className="w-5 h-5" />
              {busy === "email" ? "…" : "E-posta"}
            </button>
            <button
              type="button"
              onClick={openWhatsApp}
              disabled={!!busy}
              className={shareBtnClass("bg-white text-green-700 border-green-200")}
              data-testid="invoice-print-share-whatsapp"
            >
              <Phone className="w-5 h-5" />
              {busy === "whatsapp" ? "…" : "WhatsApp"}
            </button>
          </div>
        </div>
      </div>
      )}
      {emailOpen && (
        <QuickMessageModal
          companyId={companyId}
          channel="email"
          initialFiles={emailFile ? [emailFile] : []}
          recipient={recipient}
          defaultSubject={subject}
          defaultMessage={message}
          context="invoice"
          refId={order.invoice_id}
          onClose={() => { setEmailOpen(false); setEmailFile(null); }}
        />
      )}
    </>
  );
}

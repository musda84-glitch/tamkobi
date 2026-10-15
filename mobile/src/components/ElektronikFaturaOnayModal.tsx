import React, { useEffect, useMemo, useRef, useState } from "react";
import { Switch, Text, View } from "react-native";
import { get } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { colors } from "../theme";
import {
  buildIadeNote,
  invoiceNeedsExemptionPrompt,
  invoiceNeedsWithholdingPrompt,
  isReturnInvoiceDoc,
  parseWithholdingValue,
  prefillReturnBillingRef,
  TAX_EXEMPTION_LABELS,
  TAX_EXEMPTION_OPTIONS,
  type EfaturaOnayPayload,
} from "../utils/efaturaOnay";
import { WITHHOLDING, withholdingSelectGroups } from "../utils/invoiceDraft";
import {
  contactIdOf,
  docBuyerTaxId,
  dropGibMukellef,
  eTypeFromGib,
  fetchGibMukellef,
  gibLookupPresentation,
  type GibEntry,
  type GibMukellef,
} from "../utils/gibMukellef";
import { docDocumentDate, docHasOldDocumentDate } from "../utils/invoiceDocDate";
import { formatIssueStamp, nowIssueDateTime, showEfaturaStampNow } from "../utils/invoiceIssueNow";
import { B2BSheet } from "./b2b/B2BSheet";
import { GroupedSelect } from "./GroupedSelect";
import { Field, Muted, PrimaryButton, Row } from "./kit";

type ContactLike = {
  id?: string;
  _id?: string;
  tax_number_or_id?: string;
  tax_id?: string;
  tax_number?: string;
  vkn?: string;
  tckn?: string;
  name?: string;
};

type DocLike = {
  id?: string;
  _id?: string;
  invoice_number?: string;
  order_number?: string;
  contact_name?: string;
  customer_name?: string;
  contact_id?: string;
  contact_tax_id?: string;
  buyer_tax_id?: string;
  customer_tax_id?: string;
  tax_number_or_id?: string;
  tax_id?: string;
  invoice_type?: string;
  e_type?: string;
  trade_kind?: string;
  tax_exemption_code?: string;
  vat_exemption_code?: string;
  withholding_rate?: number;
  withholding_code?: string;
  issue_date?: string;
  issue_time?: string;
  notes?: string;
  original_invoice_number?: string;
  return_of_invoice_number?: string;
  billing_reference_id?: string;
  referenced_invoice_number?: string;
  original_issue_date?: string;
  return_of_issue_date?: string;
  billing_reference_date?: string;
  items?: Array<{ vat_rate?: number; vat_exemption_code?: string; tax_exemption_code?: string }>;
  is_e_invoice_user?: boolean;
  contact_is_e_invoice_user?: boolean;
};

export function ElektronikFaturaOnayModal({
  visible,
  order,
  invoice,
  contact,
  preferredEType,
  contactIsEInvoiceUser,
  initialStampNow = true,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  order?: DocLike | null;
  invoice?: DocLike | null;
  contact?: ContactLike | null;
  preferredEType?: "e_invoice" | "e_archive" | null;
  contactIsEInvoiceUser?: boolean | null;
  /** Hızlı gönderim tarih sorusu sonucu (web #1154 stamp_now). */
  initialStampNow?: boolean;
  onClose: () => void;
  onConfirm: (payload: EfaturaOnayPayload) => void | Promise<void>;
}) {
  const { client, companyId } = useAuth();
  const doc = invoice || order || null;
  const askExemption = invoiceNeedsExemptionPrompt(invoice || doc);
  const askWithholding = invoiceNeedsWithholdingPrompt(invoice || doc);
  const isReturn = isReturnInvoiceDoc(doc);
  const prefilled = useMemo(() => prefillReturnBillingRef(doc), [doc]);
  const offerStamp = showEfaturaStampNow({ isBulk: false, isPrint: false, mode: "send" });
  const stampPreview = nowIssueDateTime();
  const docDateYmd = docDocumentDate(doc);
  const docDateIsOld = docHasOldDocumentDate(doc);

  const [loadingMeta, setLoadingMeta] = useState(true);
  const [credits, setCredits] = useState<number | null>(null);
  const [creditsSource, setCreditsSource] = useState("");
  const [gibMeta, setGibMeta] = useState<GibMukellef | null>(null);
  const [gibEntry, setGibEntry] = useState<GibEntry | null>(null);
  const [gibStatus, setGibStatus] = useState<"loading" | "ok" | "error">("loading");
  const [gibError, setGibError] = useState("");
  const [gibRetry, setGibRetry] = useState(0);
  const gibRefreshRef = useRef(false);
  const [stampNow, setStampNow] = useState(initialStampNow);
  const [exemptionCode, setExemptionCode] = useState(
    String(doc?.tax_exemption_code || doc?.vat_exemption_code || "").trim(),
  );
  const [withholdingValue, setWithholdingValue] = useState("");
  const [withholdingTouched, setWithholdingTouched] = useState(false);
  const [returnInvoiceNo, setReturnInvoiceNo] = useState(prefilled.number);
  const [returnInvoiceDate, setReturnInvoiceDate] = useState(prefilled.date);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fetchedContact, setFetchedContact] = useState<ContactLike | null>(null);
  const [contactFetchDone, setContactFetchDone] = useState(false);
  const resolvedContact = contact || fetchedContact || null;
  const contactPending = !contact && !!contactIdOf(doc) && !contactFetchDone;

  useEffect(() => {
    if (!visible) return;
    setExemptionCode(String(doc?.tax_exemption_code || doc?.vat_exemption_code || "").trim());
    setReturnInvoiceNo(prefilled.number);
    setReturnInvoiceDate(prefilled.date);
    setWithholdingValue("");
    setWithholdingTouched(false);
    setStampNow(initialStampNow !== false);
    setFormError(null);
    setSubmitting(false);
  }, [visible, doc, prefilled.number, prefilled.date, initialStampNow]);

  useEffect(() => {
    if (!visible) return;
    setFetchedContact(null);
    setContactFetchDone(false);
  }, [visible, doc?.contact_id, contact]);

  useEffect(() => {
    if (!visible || contact || !contactIdOf(doc)) {
      if (visible && (!contactIdOf(doc) || contact)) setContactFetchDone(true);
      return;
    }
    let cancelled = false;
    get<ContactLike>(client, `/contacts/${contactIdOf(doc)}`)
      .then((row) => {
        if (cancelled) return;
        setFetchedContact(row || null);
        setContactFetchDone(true);
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedContact(null);
          setContactFetchDone(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible, client, doc, contact]);

  useEffect(() => {
    if (!visible || !companyId) {
      setLoadingMeta(false);
      return;
    }
    if (contactPending) {
      setLoadingMeta(true);
      return;
    }
    let cancelled = false;
    setLoadingMeta(true);
    const tax = docBuyerTaxId(doc, resolvedContact);
    const refresh = gibRefreshRef.current;
    gibRefreshRef.current = false;

    const loadCredits = get<{ balance?: number; source?: string; provider?: string }>(
      client,
      "/e-invoice/integrator-credits",
      { company_id: companyId },
    )
      .then((r) => {
        if (cancelled) return;
        const bal = r?.balance;
        setCredits(bal == null || Number.isNaN(Number(bal)) ? null : Number(bal));
        setCreditsSource(r?.source || r?.provider || "");
      })
      .catch(() => {
        if (!cancelled) {
          setCredits(null);
          setCreditsSource("");
        }
      });

    if (!cancelled) {
      setGibStatus("loading");
      setGibError("");
    }
    const loadGib = fetchGibMukellef(client, companyId, tax, { refresh })
      .then((entry) => {
        if (cancelled) return;
        const decided = entry.status === "ok" ? eTypeFromGib(entry.data) : null;
        if (entry.status !== "ok" || !decided) {
          const msg = entry.status === "error"
            ? entry.error
            : (entry.data?.message || "GİB mükellefiyeti doğrulanamadı.");
          setGibMeta(entry.status === "ok" ? entry.data : null);
          setGibEntry(entry.status === "error" ? entry : { status: "error", error: msg });
          setGibStatus("error");
          setGibError(msg);
          return;
        }
        setGibEntry(entry);
        setGibMeta(entry.data || null);
        setGibStatus("ok");
        setGibError("");
      })
      .catch((err: { message?: string; gibEntry?: { error?: string } }) => {
        if (cancelled) return;
        const msg = err?.gibEntry?.error || err?.message || "GİB sorgusu başarısız.";
        setGibMeta(null);
        setGibEntry({ status: "error", error: msg });
        setGibStatus("error");
        setGibError(msg);
      });

    Promise.all([loadCredits, loadGib]).finally(() => {
      if (!cancelled) setLoadingMeta(false);
    });

    return () => {
      cancelled = true;
    };
  }, [visible, companyId, client, doc, resolvedContact, contactPending, gibRetry]);

  const gibView = gibLookupPresentation(
    doc,
    resolvedContact,
    gibStatus === "loading" || contactPending ? null : gibEntry,
    { contactPending },
  );
  const resolvedType = gibStatus === "ok" ? eTypeFromGib(gibMeta) : null;
  const gibBlocked = resolvedType !== "e_invoice" && resolvedType !== "e_archive";
  const isTaxpayer = resolvedType === "e_invoice";
  const message = gibError
    ? gibError
    : gibBlocked
      ? "GİB mükellef sorgusu tamamlanmadan gönderilemez."
      : isTaxpayer
        ? "Bu müşteri e-fatura mükellefidir, karşı tarafa e-fatura gönderilecek. Onaylıyor musunuz?"
        : "Bu müşteri e-fatura mükellefi değildir, e-arşiv faturası oluşturulacak. Onaylıyor musunuz?";
  void preferredEType;
  void contactIsEInvoiceUser;

  const submit = async (opts?: { scenario?: "TEMEL" | "TICARI"; forceArchive?: boolean }) => {
    setFormError(null);
    if (isReturn) {
      const no = String(returnInvoiceNo || "").trim();
      const dt = String(returnInvoiceDate || "").trim();
      if (!no) {
        setFormError("İade edilen fatura numarasını girin.");
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
        setFormError("İade edilen faturanın tarihini YYYY-AA-GG girin.");
        return;
      }
    }
    if (askExemption && !String(exemptionCode || "").trim()) {
      setFormError("KDV %0 satır var — vergi muafiyet / istisna kodunu seçin.");
      return;
    }
    if (askWithholding && !withholdingTouched) {
      setFormError("KDV %0 satır var — tevkifat seçin veya «Tevkifat yok» deyin.");
      return;
    }

    if (gibBlocked || (resolvedType !== "e_invoice" && resolvedType !== "e_archive")) {
      setFormError(gibError || "GİB sorgusu tamamlanmadan gönderilemez.");
      return;
    }
    let resolvedEType: "e_invoice" | "e_archive";
    let sc: "TEMEL" | "TICARI" | undefined;
    if (opts?.forceArchive || !isTaxpayer) {
      resolvedEType = "e_archive";
    } else if (opts?.scenario) {
      resolvedEType = "e_invoice";
      sc = isReturn || opts.scenario === "TEMEL" ? "TEMEL" : "TICARI";
    } else if (isTaxpayer) {
      resolvedEType = "e_invoice";
      sc = isReturn ? "TEMEL" : "TICARI";
    } else {
      resolvedEType = resolvedType;
    }

    const wh = askWithholding ? parseWithholdingValue(withholdingValue) : undefined;
    const exCode = String(exemptionCode || "").trim();
    const exemption = exCode
      ? {
          tax_exemption_code: exCode,
          tax_exemption_reason: (
            TAX_EXEMPTION_LABELS[exCode] || `Vergi muafiyet kodu ${exCode}`
          ).replace(/^\d+\s*[–-]\s*/, ""),
        }
      : undefined;
    const returnRef = isReturn
      ? {
          original_invoice_number: String(returnInvoiceNo || "").trim().toUpperCase(),
          original_issue_date: String(returnInvoiceDate || "").trim().slice(0, 10),
          notes: buildIadeNote(returnInvoiceNo, returnInvoiceDate),
        }
      : undefined;

    const payload: EfaturaOnayPayload = {
      eType: resolvedEType,
      scenario: resolvedEType === "e_invoice" ? (sc || "TICARI") : undefined,
      stampNow: !!(offerStamp && stampNow),
      alias: gibMeta?.alias || undefined,
      gibMeta: gibMeta || undefined,
      withholding: wh,
      exemption,
      returnRef,
    };

    // Modal hemen kapanır; gönderim arka planda sürer (web Devam Et davranışı).
    setSubmitting(true);
    onClose();
    try {
      await Promise.resolve(onConfirm(payload));
    } finally {
      setSubmitting(false);
    }
  };

  const retryGib = (forceRefresh = false) => {
    gibRefreshRef.current = !!forceRefresh;
    dropGibMukellef(companyId || "", docBuyerTaxId(doc, resolvedContact));
    setGibEntry(null);
    setGibMeta(null);
    setGibError("");
    setGibStatus("loading");
    setGibRetry((n) => n + 1);
  };

  const docLabel = doc?.invoice_number || doc?.order_number || "Belge";
  const contactLabel = doc?.contact_name || doc?.customer_name || "";

  return (
    <B2BSheet
      visible={visible}
      title="Elektronik Fatura Onayı"
      subtitle={[docLabel, contactLabel].filter(Boolean).join(" · ")}
      onClose={onClose}
      testID="efatura-onay-modal"
      footer={
        <View style={{ gap: 8 }}>
          {formError ? (
            <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 12 }} testID="efatura-onay-error">
              {formError}
            </Text>
          ) : null}
          {gibBlocked ? (
            <>
              <PrimaryButton
                title={gibError ? "GİB sorgusu başarısız" : "GİB sorgulanıyor…"}
                testID="efatura-onay-continue"
                disabled
                onPress={() => {}}
              />
              <PrimaryButton
                title="Tekrar sorgula"
                testID="efatura-onay-retry"
                color={colors.slate800}
                onPress={() => retryGib(true)}
              />
            </>
          ) : isTaxpayer ? (
            <Row style={{ gap: 8 }}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title={submitting ? "…" : (isReturn ? "İade — Temel" : "Temel")}
                  testID="efatura-onay-temel"
                  color={colors.slate800}
                  loading={submitting}
                  onPress={() => submit({ scenario: "TEMEL" })}
                />
              </View>
              {!isReturn ? (
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    title={submitting ? "…" : "Ticari"}
                    testID="efatura-onay-ticari"
                    color={colors.primary}
                    loading={submitting}
                    onPress={() => submit({ scenario: "TICARI" })}
                  />
                </View>
              ) : null}
            </Row>
          ) : (
            <PrimaryButton
              title={submitting ? "Gönderiliyor…" : "e-Arşiv Fatura Gönder"}
              testID="efatura-onay-earsiv"
              color={colors.primary}
              loading={submitting}
              onPress={() => submit({ forceArchive: true })}
            />
          )}
        </View>
      }
    >
      <Muted testID="efatura-onay-message">{loadingMeta || contactPending ? "Yükleniyor…" : message}</Muted>
      <View style={{ marginTop: 10, gap: 4 }} testID="efatura-onay-gib-meta">
        <Text testID="efatura-onay-vkn" style={{ color: colors.text, fontSize: 12 }}>VKN: {gibView.tax || "—"}</Text>
        <Text testID="efatura-onay-vkn-origin" style={{ color: colors.text, fontSize: 12 }}>
          VKN kaynağı: {gibView.taxSource || "—"}
        </Text>
        <Text testID="efatura-onay-unvan" style={{ color: colors.text, fontSize: 12 }}>Unvan: {gibView.name || "—"}</Text>
        <Text testID="efatura-onay-source" style={{ color: colors.text, fontSize: 12 }}>Kaynak: {gibView.source || "—"}</Text>
        <Text testID="efatura-onay-aliases" style={{ color: colors.text, fontSize: 12 }}>
          Etiket: {gibView.aliases.length ? gibView.aliases.join(", ") : "—"}
        </Text>
        {gibView.mismatch ? (
          <Text testID="efatura-onay-tax-mismatch" style={{ color: "#B45309", fontSize: 12, fontWeight: "700" }}>
            Fatura VKN {gibView.docTax} ile cari VKN {gibView.contactTax} farklı. Sorgu fatura VKN ile yapıldı.
          </Text>
        ) : null}
        <PrimaryButton
          title="GİB'i yeniden sorgula"
          testID="efatura-onay-gib-refresh"
          color={colors.slate800}
          onPress={() => retryGib(true)}
        />
      </View>

      {credits != null ? (
        <View
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 10,
            backgroundColor: "#F8FAFC",
            borderWidth: 1,
            borderColor: colors.border,
          }}
          testID="efatura-onay-credits"
        >
          <Text style={{ fontWeight: "700", color: colors.text, fontSize: 13 }}>
            Kontör: {credits}
            {creditsSource ? ` · ${creditsSource}` : ""}
          </Text>
        </View>
      ) : null}

      {offerStamp ? (
        <View style={{ marginTop: 12, gap: 8 }} testID="efatura-onay-stamp-block">
          {docDateIsOld ? (
            <View
              style={{
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#FCD34D",
                backgroundColor: "#FFFBEB",
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
              testID="efatura-onay-old-date-warn"
            >
              <Text style={{ color: "#78350F", fontSize: 12, fontWeight: "600" }}>
                Belge tarihi {formatIssueStamp(docDateYmd, "")} — GİB'e eski tarihle gidecek
              </Text>
            </View>
          ) : null}
          <Row style={{ justifyContent: "space-between", alignItems: "center" }} testID="efatura-onay-stamp">
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ fontWeight: "700", color: colors.text, fontSize: 13 }}>Tarih/saat şimdi</Text>
              <Muted>
                {stampNow
                  ? `GİB’e ${formatIssueStamp(stampPreview.issue_date, stampPreview.issue_time)} yazılır.`
                  : `Belgedeki tarih kalır: ${formatIssueStamp(doc?.issue_date || docDateYmd, doc?.issue_time)}.`}
              </Muted>
            </View>
            <Switch value={stampNow} onValueChange={setStampNow} testID="efatura-onay-stamp-switch" />
          </Row>
        </View>
      ) : null}

      {isReturn ? (
        <View style={{ marginTop: 12, gap: 8 }} testID="efatura-onay-return">
          <Field
            label="İade edilen fatura no"
            testID="efatura-onay-return-no"
            value={returnInvoiceNo}
            onChangeText={setReturnInvoiceNo}
            autoCapitalize="characters"
          />
          <Field
            label="İade edilen fatura tarihi (YYYY-AA-GG)"
            testID="efatura-onay-return-date"
            value={returnInvoiceDate}
            onChangeText={setReturnInvoiceDate}
            placeholder="2026-10-01"
          />
        </View>
      ) : null}

      {askExemption ? (
        <View style={{ marginTop: 12 }} testID="efatura-onay-exemption">
          <GroupedSelect
            label="Vergi muafiyet / istisna kodu"
            testID="efatura-onay-exemption-select"
            value={exemptionCode}
            onChange={setExemptionCode}
            groups={[{ label: "Muafiyet", options: TAX_EXEMPTION_OPTIONS.map((o) => ({ value: o.value, label: o.label })) }]}
          />
        </View>
      ) : null}

      {askWithholding ? (
        <View style={{ marginTop: 12 }} testID="efatura-onay-withholding">
          <GroupedSelect
            label="Tevkifat"
            testID="efatura-onay-withholding-select"
            value={withholdingValue}
            onChange={(v) => {
              setWithholdingValue(v);
              setWithholdingTouched(true);
            }}
            groups={withholdingSelectGroups().length ? withholdingSelectGroups() : [{
              label: "Tevkifat",
              options: WITHHOLDING.map((w) => ({ value: w.value, label: w.label })),
            }]}
          />
        </View>
      ) : null}
    </B2BSheet>
  );
}

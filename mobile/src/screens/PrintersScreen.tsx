import React, { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, ErrorBanner, Field, H1, Muted, PrimaryButton, Screen } from "../components/kit";
import { colors } from "../theme";
import {
  defaultLabelPrinter,
  fetchCompanyLabelPrinter,
  labelPrinterConfigError,
  loadLabelPrinter,
  printTestLabel,
  saveCompanyLabelPrinter,
  saveLabelPrinter,
  type LabelPrinterSettings,
} from "../utils/labelPrinter";

export function PrintersScreen() {
  const { client, companyId } = useAuth();
  const [form, setForm] = useState<LabelPrinterSettings>(defaultLabelPrinter());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((next: LabelPrinterSettings) => {
    setForm(next);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const local = await loadLabelPrinter(companyId);
      if (!live) return;
      if (local.host) {
        apply(local);
        return;
      }
      try {
        const remote = await fetchCompanyLabelPrinter(client, companyId);
        if (!live) return;
        if (remote.configured) {
          apply(remote);
          setMessage("Şirket varsayılanı yüklendi. Kaydet derseniz bu telefonda da saklanır.");
          return;
        }
      } catch {
        /* şirket varsayılanı okunamadı */
      }
      apply(local);
    })();
    return () => {
      live = false;
    };
  }, [apply, client, companyId]);

  const set = <K extends keyof LabelPrinterSettings>(key: K, value: LabelPrinterSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validated = (): LabelPrinterSettings | null => {
    const err = labelPrinterConfigError(form);
    if (err) {
      setError(err);
      setMessage(null);
      return null;
    }
    setError(null);
    return form;
  };

  const saveDevice = async () => {
    const next = validated();
    if (!next) return;
    setBusy(true);
    try {
      const saved = await saveLabelPrinter(next, companyId);
      apply(saved);
      setMessage("Yazıcı bu cihazda saklandı.");
    } catch (err) {
      setError(apiErrorMessage(err, "Yazıcı kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const saveCompany = async () => {
    const next = validated();
    if (!next) return;
    setBusy(true);
    try {
      const saved = await saveLabelPrinter(next, companyId);
      await saveCompanyLabelPrinter(client, companyId, saved);
      apply(saved);
      setMessage("Şirket varsayılanı kaydedildi ve bu cihazda da saklandı.");
    } catch (err) {
      setError(apiErrorMessage(err, "Şirket yazıcı varsayılanı kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const loadCompany = async () => {
    setBusy(true);
    setError(null);
    try {
      const remote = await fetchCompanyLabelPrinter(client, companyId);
      if (!remote.configured) {
        setError("Bu şirket için kayıtlı yazıcı varsayılanı yok.");
        return;
      }
      apply(remote);
      setMessage("Şirket varsayılanı forma alındı.");
    } catch (err) {
      setError(apiErrorMessage(err, "Şirket yazıcı varsayılanı okunamadı."));
    } finally {
      setBusy(false);
    }
  };

  const testPrint = async () => {
    const next = validated();
    if (!next) return;
    setBusy(true);
    try {
      const saved = await saveLabelPrinter(next, companyId);
      apply(saved);
      const r = await printTestLabel(saved);
      setMessage(`Test etiketi gönderildi (${saved.host}:${saved.port}, ${r.bytes} bayt).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : apiErrorMessage(err, "Test etiketi basılamadı.");
      setError(msg);
      setMessage(null);
    } finally {
      setBusy(false);
    }
  };

  const cfgErr = labelPrinterConfigError(form);

  return (
    <Screen>
      <H1>Yazıcılar</H1>
      <Muted>Xprinter XP-490B · TSPL · ham TCP port 9100. Telefon yazıcıyla aynı Wi-Fi ağında olmalı.</Muted>
      <ErrorBanner message={error} />
      {message ? <Card><Text style={{ color: colors.accent, fontWeight: "700" }}>{message}</Text></Card> : null}
      <Card testID="printer-settings">
        <Field
          label="Yazıcı adı"
          testID="printer-name"
          value={form.name}
          onChangeText={(v) => set("name", v)}
          placeholder="Xprinter XP-490B"
        />
        <Field
          label="IP"
          testID="printer-host"
          value={form.host}
          onChangeText={(v) => set("host", v.trim())}
          placeholder="192.168.1.117"
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
        />
        <Field
          label="Port"
          testID="printer-port"
          value={form.port ? String(form.port) : ""}
          onChangeText={(v) => set("port", Number(v.replace(/[^\d]/g, "")) || 0)}
          placeholder="9100"
          keyboardType="number-pad"
        />
        <Field
          label="Etiket genişliği (mm)"
          testID="printer-width"
          value={String(form.widthMm)}
          onChangeText={(v) => set("widthMm", Number(v.replace(",", ".")) || 0)}
          keyboardType="decimal-pad"
        />
        <Field
          label="Etiket yüksekliği (mm)"
          testID="printer-height"
          value={String(form.heightMm)}
          onChangeText={(v) => set("heightMm", Number(v.replace(",", ".")) || 0)}
          keyboardType="decimal-pad"
        />
        <Field
          label="Boşluk / gap (mm)"
          testID="printer-gap"
          value={String(form.gapMm)}
          onChangeText={(v) => set("gapMm", Number(v.replace(",", ".")) || 0)}
          keyboardType="decimal-pad"
        />
        <GroupedSelect
          label="DPI"
          testID="printer-dpi"
          value={String(form.dpi)}
          onChange={(v) => set("dpi", Number(v) === 300 ? 300 : 203)}
          groups={[{ label: "Çözünürlük", options: [{ value: "203", label: "203 DPI" }, { value: "300", label: "300 DPI" }] }]}
        />
        <GroupedSelect
          label="Türkçe karakter"
          testID="printer-text-mode"
          value={form.textMode}
          onChange={(v) => set("textMode", v === "bitmap" ? "bitmap" : "codepage")}
          groups={[{
            label: "Yazı",
            options: [
              { value: "codepage", label: "CODEPAGE 1254" },
              { value: "bitmap", label: "Metni bitmap bas" },
            ],
          }]}
        />
        {cfgErr ? <Muted testID="printer-config-error">{cfgErr}</Muted> : null}
        <PrimaryButton title={busy ? "Kaydediliyor…" : "Bu cihaza kaydet"} testID="printer-save" onPress={saveDevice} loading={busy} color={colors.primary} />
        <PrimaryButton title="Şirket varsayılanını yükle" testID="printer-load-company" onPress={loadCompany} disabled={busy} color={colors.secondary} />
        <PrimaryButton title="Şirket varsayılanı olarak kaydet" testID="printer-save-company" onPress={saveCompany} disabled={busy} color={colors.secondary} />
        <PrimaryButton title={busy ? "Basılıyor…" : "Test etiketi bas"} testID="printer-test" icon="print" onPress={testPrint} loading={busy} color={colors.indigo} />
      </Card>
      <Muted>Ayar bu telefonda saklanır. Şirket varsayılanı diğer cihazların boş ayarına önerilir. Bağlantı Expo Go'da yok; EAS preview derlemesi gerekir.</Muted>
    </Screen>
  );
}

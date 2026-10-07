import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { colors } from "../theme";
import { Card, Field, Muted, PrimaryButton, Row } from "./kit";

const QUICK = [
  "Güncel üretim ve reçete durumunu yönetici için özetle.",
  "Darboğaz ve eksik hammadde risklerini önceliklendir.",
  "Atölye iş emirlerinde geciken / duraklayan adımları yorumla.",
];

type Metrics = {
  recipes?: number;
  open_orders?: number;
  in_production?: number;
  missing_notifications?: number;
  open_work_orders?: number;
  paused_work_orders?: number;
};

/** Şirket ai.production eklentisi + production_ai özellik bayrağı açıkken (web ProductionAiAdvisor). */
export function ProductionAiAdvisor({ companyId, compact = true }: { companyId: string; compact?: boolean }) {
  const { client, addonOn, feature } = useAuth();
  const [open, setOpen] = useState(!compact);
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!addonOn("ai.production") || !feature("production_ai")) return null;

  const run = async (message?: string) => {
    const text = String(message || q || "").trim();
    setBusy(true);
    setError(null);
    try {
      let data: { advice?: string; metrics?: Metrics } | null = null;
      if (!text || text === QUICK[0]) {
        data = await get<{ advice?: string; metrics?: Metrics }>(client, "/ai/production-summary", { company_id: companyId });
      } else {
        data = await post<{ advice?: string; metrics?: Metrics }>(client, "/ai/production-advisor", { company_id: companyId, message: text });
      }
      setAdvice(data?.advice || "");
      setMetrics(data?.metrics || null);
      setOpen(true);
      if (message) setQ("");
    } catch (err) {
      setError(apiErrorMessage(err, "AI üretim analizi alınamadı."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="production-ai-advisor" style={{ borderColor: "#A7F3D0", backgroundColor: "#ECFDF5" }}>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13 }}>AI Üretim & Reçete</Text>
          <Muted>Yönetici özeti · Emir / reçete / atölye</Muted>
        </View>
        <PrimaryButton title={busy ? "…" : "Analiz"} onPress={() => run(QUICK[0])} disabled={busy} color="#059669" testID="production-ai-analyze" />
        <Pressable onPress={() => setOpen((v) => !v)} testID="production-ai-toggle" style={{ padding: 6 }}>
          <Text style={{ fontWeight: "800", color: colors.muted }}>{open ? "▲" : "▼"}</Text>
        </Pressable>
      </Row>
      {error ? <Text style={{ color: colors.danger, fontWeight: "700", marginTop: 6 }}>{error}</Text> : null}
      {open ? (
        <View style={{ marginTop: 8, gap: 8 }}>
          {metrics ? (
            <Row style={{ flexWrap: "wrap", gap: 6 }} testID="production-ai-metrics">
              {[
                ["Reçete", metrics.recipes],
                ["Açık emir", metrics.open_orders],
                ["Üretimde", metrics.in_production],
                ["Atölye WO", metrics.open_work_orders],
                ["Duraklatılmış", metrics.paused_work_orders],
              ].map(([l, v]) => (
                <View key={String(l)} style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 10, color: colors.muted }}>
                    <Text style={{ fontWeight: "800", color: colors.text }}>{v ?? 0}</Text> {l}
                  </Text>
                </View>
              ))}
            </Row>
          ) : null}
          {advice ? (
            <Text testID="production-ai-advice" style={{ fontSize: 12, color: colors.text, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#A7F3D0", padding: 10 }}>
              {advice}
            </Text>
          ) : (
            <View style={{ gap: 6 }}>
              {QUICK.map((p) => (
                <Pressable key={p} disabled={busy} onPress={() => run(p)} style={{ backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#E2E8F0", padding: 8 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "600" }}>{p}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Field
            label="Yönetici sorusu"
            testID="production-ai-input"
            value={q}
            onChangeText={setQ}
            placeholder="örn. hangi istasyon yoğun?"
            editable={!busy}
          />
          <PrimaryButton title="Gönder" onPress={() => run(q)} disabled={busy || !q.trim()} color={colors.slate800} testID="production-ai-send" />
        </View>
      ) : null}
    </Card>
  );
}

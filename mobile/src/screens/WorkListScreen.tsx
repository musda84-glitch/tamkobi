import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Empty, ErrorBanner, Field, ListRow, PrimaryButton, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { statusTr } from "../utils/labels";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { newButtonLabel, type ProjectDoc, type QuoteDoc, type SurveyDoc, type WorkKind } from "../utils/workDocs";

const META: Record<WorkKind, { path: string; perm: string; empty: string; icon: "document-text-outline" | "briefcase-outline" | "construct-outline"; goNew: string; goDetail: string }> = {
  quote: { path: "/quotes", perm: "/quotes", empty: "Teklif yok", icon: "document-text-outline", goNew: "QuoteNew", goDetail: "QuoteDetail" },
  project: { path: "/projects", perm: "/projects", empty: "Proje yok", icon: "briefcase-outline", goNew: "ProjectNew", goDetail: "ProjectDetail" },
  survey: { path: "/surveys", perm: "/surveys", empty: "Keşif yok", icon: "construct-outline", goNew: "SurveyNew", goDetail: "SurveyDetail" },
};

export function WorkListScreen({ kind }: { kind: WorkKind }) {
  const meta = META[kind];
  const { client, companyId, can } = useAuth();
  const canEdit = can(meta.perm, "edit");
  const [quotes, setQuotes] = useState<QuoteDoc[]>([]);
  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [surveys, setSurveys] = useState<SurveyDoc[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      if (kind === "quote") {
        const rows = await get<QuoteDoc[]>(client, "/quotes", { company_id: companyId, summary: 1 });
        setQuotes(rows || []);
      } else if (kind === "project") {
        const rows = await get<ProjectDoc[]>(client, "/projects", { company_id: companyId, light: 1 });
        setProjects(rows || []);
      } else {
        const rows = await get<SurveyDoc[]>(client, "/surveys", { company_id: companyId });
        setSurveys(rows || []);
      }
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Liste yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, kind]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (kind === "quote") {
      const list = s ? quotes.filter((r) => [r.quote_number, r.title, r.contact_name].some((v) => String(v || "").toLowerCase().includes(s))) : quotes;
      return list.slice(0, 80).map((r) => ({
        id: idOf(r),
        title: r.quote_number || r.title || "Teklif",
        subtitle: `${r.contact_name || "—"} · ${statusTr(r.status)} · ${fmtDate(r.valid_until)}`,
        right: fmtMoney(r.grand_total),
      }));
    }
    if (kind === "project") {
      const list = s ? projects.filter((r) => [r.project_number, r.name, r.contact_name].some((v) => String(v || "").toLowerCase().includes(s))) : projects;
      return list.slice(0, 80).map((r) => ({
        id: idOf(r),
        title: r.name || r.project_number || "Proje",
        subtitle: `${r.project_number || ""} · ${r.contact_name || "—"} · ${statusTr(r.status)}`,
        right: fmtMoney(r.budget || r.quoted_total),
      }));
    }
    const list = s ? surveys.filter((r) => [r.survey_number, r.contact_name, r.address].some((v) => String(v || "").toLowerCase().includes(s))) : surveys;
    return list.slice(0, 80).map((r) => ({
      id: idOf(r),
      title: r.survey_number || "Keşif",
      subtitle: `${r.contact_name || "—"} · ${r.address || ""} · ${statusTr(r.status)} · ${fmtDate(r.survey_date)}`,
      right: "",
    }));
  }, [kind, q, quotes, projects, surveys]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      {canEdit ? (
        <PrimaryButton title={newButtonLabel(kind)} onPress={() => go(meta.goNew)} color={colors.primary} testID={`new-${kind}-btn`} />
      ) : null}
      <Field label="Ara" value={q} onChangeText={setQ} placeholder="No / cari / ad" />
      <ErrorBanner message={error} />
      {!filtered.length ? (
        <Empty icon={meta.icon} title={meta.empty} hint={canEdit ? `${newButtonLabel(kind)} ile başlayın.` : undefined} />
      ) : filtered.map((r) => (
        <ListRow
          key={r.id}
          testID={`${kind}-row-${r.id}`}
          title={r.title}
          subtitle={r.subtitle}
          right={r.right || undefined}
          onPress={() => go(meta.goDetail, { id: r.id })}
        />
      ))}
    </Screen>
  );
}

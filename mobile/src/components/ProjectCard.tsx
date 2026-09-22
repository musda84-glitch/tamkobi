import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, Share, Text, View } from "react-native";
import { get, post, put } from "../api/client";
import { normalizeApiBase } from "../api/url";
import { apiErrorMessage } from "../auth/AuthContext";
import { B2BSheet } from "./b2b/B2BSheet";
import { ProjectStagePhotos, ProjectWorkPreview } from "./ProjectStagePhotos";
import { Chip } from "./chips";
import { GroupedSelect } from "./GroupedSelect";
import { Badge, Card, ErrorBanner, Field, Muted, PrimaryButton, Row } from "./kit";
import { go } from "../nav";
import { colors } from "../theme";
import { statusTr } from "../utils/labels";
import { fmtMoney, idOf } from "../utils/money";
import { mapsLink } from "../utils/geo";
import type { ProjectStage } from "../utils/projectStages";
import type { Employee, ProjectTask } from "../utils/personnel";
import {
  approvalChannels,
  approvalPublicOrigin,
  channelResultLabel,
  defaultApprovalFlags,
  validateApprovalSend,
} from "../utils/quoteApproval";
import {
  PROJECT_QUOTE_ACTION,
  PROJECT_NEW_QUOTE_ACTION,
  PROJECT_MAPS_ACTION,
  projectQuoteNavParams,
  canCompleteProject,
  applyTaskAssignee,
  assigneeSelectGroups,
  cleanProjectTasks,
  emptyProjectTask,
  projectCardBits,
  addressToggleLabel,
  shouldCollapseAddress,
  projectStatusSelectGroups,
  projectTaskRows,
  projectTaskSummary,
  projectTrackingPayload,
  trackingAbsoluteLink,
  trackingBadgeLabel,
  trackingShareMessage,
  type ProjectDoc,
  type ProjectTrackingResult,
} from "../utils/workDocs";

export function Metric({
  label,
  value,
  testID,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  testID?: string;
  tone?: "green" | "rose";
  onPress?: () => void;
}) {
  const color = tone === "green" ? colors.primaryHover : tone === "rose" ? colors.danger : colors.text;
  const body = (
    <View style={{ flex: 1, backgroundColor: colors.slate50, borderRadius: 10, padding: 8, minWidth: 0 }}>
      <Muted>{label}</Muted>
      <Text testID={testID} numberOfLines={1} style={{ fontWeight: "800", fontSize: 12, color }}>{value}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable style={{ flex: 1, minWidth: 0 }} onPress={onPress} testID={testID ? `${testID}-open` : undefined}>
      {body}
    </Pressable>
  );
}

export function ActionBtn({
  title,
  onPress,
  testID,
  bg,
  border,
  color,
}: {
  title: string;
  onPress: () => void;
  testID: string;
  bg: string;
  border?: string;
  color: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 40,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        borderWidth: border ? 1 : 0,
        borderColor: border,
        paddingHorizontal: 8,
      }}
    >
      <Text style={{ fontWeight: "800", color, fontSize: 12 }}>{title}</Text>
    </Pressable>
  );
}

export function openWorkLocation(row: { location_url?: string | null; latitude?: number | null; longitude?: number | null; address?: string | null }, emptyMsg: string) {
  const href = mapsLink(row);
  if (!href) {
    Alert.alert("Konum yok", emptyMsg);
    return;
  }
  Linking.openURL(href).catch(() => Alert.alert("Harita açılamadı", "Konum linki açılamadı."));
}

export function openProjectLocation(project: ProjectDoc) {
  openWorkLocation(project, "Bu projeye konum veya adres eklenmemiş.");
}

export function ProjectCard({
  project,
  stages,
  canEdit,
  canExp,
  canQuote,
  statusBusy,
  onStatus,
  onTeam,
  onTrack,
  onCollect,
  onPhotos,
  onPreview,
}: {
  project: ProjectDoc;
  stages: ProjectStage[];
  canEdit: boolean;
  canExp: boolean;
  canQuote: boolean;
  statusBusy: boolean;
  onStatus: (status: string) => void;
  onTeam: () => void;
  onTrack: () => void;
  onCollect?: () => void;
  onPhotos: (id: string, patch: Pick<ProjectDoc, "stage_photos" | "images">) => void;
  onPreview: () => void;
}) {
  const id = idOf(project);
  const bits = projectCardBits(project);
  const collapseAddr = shouldCollapseAddress(bits.address);
  const [showAddr, setShowAddr] = useState(!collapseAddr);
  const taskBits = projectTaskSummary(project.tasks);
  const trackLabel = trackingBadgeLabel(project.tracking);
  return (
    <Card testID={`project-row-${id}`}>
      <Pressable onPress={() => go("ProjectDetail", { id })}>
        {bits.codes ? <Muted>{bits.codes}</Muted> : null}
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <Text style={{ flex: 1, fontWeight: "800", color: colors.text, fontSize: 15 }} numberOfLines={2}>{bits.name}</Text>
          <Badge
            label={statusTr(project.status)}
            tone={project.status === "completed" ? "green" : project.status === "on_hold" ? "amber" : project.status === "active" ? "indigo" : "slate"}
          />
        </Row>
        <Muted>{bits.contactName}</Muted>
      </Pressable>
      {bits.address ? (
        <View>
          {showAddr ? <Muted testID={`project-addr-${id}`}>{bits.address}</Muted> : null}
          {collapseAddr ? (
            <Pressable
              testID={`project-addr-toggle-${id}`}
              onPress={() => setShowAddr((v) => !v)}
              hitSlop={8}
              style={{ alignSelf: "flex-start", paddingTop: 2, paddingBottom: 2 }}
            >
              <Text style={{ fontWeight: "800", color: colors.primary, fontSize: 12 }}>{addressToggleLabel(showAddr)}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Row style={{ alignItems: "stretch", gap: 6, marginTop: 4 }}>
        <Metric label="Bütçe" value={fmtMoney(bits.budget)} testID={`project-budget-${id}`} onPress={() => go("ProjectDetail", { id })} />
        <Metric
          label="Teklif"
          value={`${bits.quoteCount} · ${fmtMoney(bits.quoted)}`}
          testID={`project-quoted-${id}`}
          onPress={() => go("ProjectDetail", { id, section: "quotes" })}
        />
      </Row>
      <Row style={{ alignItems: "stretch", gap: 6, marginTop: 6 }}>
        <Metric
          label="Faturalanan"
          value={fmtMoney(bits.invoiced)}
          testID={`project-invoiced-${id}`}
          tone="green"
          onPress={() => go("ProjectDetail", { id, section: "invoices" })}
        />
        <Metric
          label="Masraf"
          value={fmtMoney(bits.expense)}
          testID={`project-expense-total-${id}`}
          tone="rose"
          onPress={() => go("ProjectDetail", { id, section: "expenses" })}
        />
      </Row>
      {taskBits || trackLabel || onCollect ? (
        <Row style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {taskBits ? (
            <Pressable onPress={() => go("ProjectDetail", { id })} testID={`project-tasks-${id}`} style={{ backgroundColor: colors.indigo50, borderRadius: 8, borderWidth: 1, borderColor: "#C7D2FE", paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ fontWeight: "700", color: "#3730A3", fontSize: 11 }}>{taskBits.label}</Text>
            </Pressable>
          ) : null}
          {trackLabel ? (
            <Pressable onPress={() => go("ProjectDetail", { id })} testID={`project-track-badge-${id}`} style={{ backgroundColor: "#F0F9FF", borderRadius: 8, borderWidth: 1, borderColor: "#BAE6FD", paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ fontWeight: "700", color: "#0369A1", fontSize: 11 }}>{trackLabel}</Text>
            </Pressable>
          ) : null}
          {onCollect ? (
            <Pressable
              testID={`project-collect-badge-${id}`}
              onPress={onCollect}
              style={{ backgroundColor: colors.emerald50, borderRadius: 8, borderWidth: 1, borderColor: "#A7F3D0", paddingHorizontal: 8, paddingVertical: 4 }}
            >
              <Text style={{ fontWeight: "700", color: "#047857", fontSize: 11 }}>Tahsilat</Text>
            </Pressable>
          ) : null}
        </Row>
      ) : null}
      {canEdit ? (
        <View style={{ marginTop: 8 }}>
          <GroupedSelect
            dense
            label="Aşama"
            testID={`project-status-${id}`}
            value={project.status || "planning"}
            onChange={(v) => !statusBusy && onStatus(v)}
            groups={projectStatusSelectGroups(project.status, stages)}
            emptyLabel="Aşama seçin"
          />
        </View>
      ) : null}
      <ProjectStagePhotos
        project={project}
        stages={stages}
        editable={canEdit}
        onChanged={(patch) => onPhotos(id, patch)}
        onPreview={onPreview}
        testID={`project-stage-photos-${id}`}
      />
      <View style={{ gap: 6, marginTop: 8 }}>
        <Row style={{ flexWrap: "wrap" }}>
          {canQuote ? (
            <ActionBtn
              title={PROJECT_NEW_QUOTE_ACTION}
              testID={`project-new-quote-${id}`}
              onPress={() => go("QuoteNew", projectQuoteNavParams(project))}
              bg="#FFFBEB"
              border="#FDE68A"
              color="#92400E"
            />
          ) : null}
          <ActionBtn
            title={PROJECT_MAPS_ACTION}
            testID={`project-maps-${id}`}
            onPress={() => openProjectLocation(project)}
            bg="#FFF1F2"
            border="#FECDD3"
            color="#9F1239"
          />
        </Row>
        {canExp || canEdit ? (
          <Row style={{ flexWrap: "wrap" }}>
            {canExp ? (
              <ActionBtn
                title="Masraf Ekle"
                testID={`project-expense-${id}`}
                onPress={() => go("ProjectDetail", { id, open_expense: "1" })}
                bg={colors.rose50}
                border="#FECDD3"
                color="#9F1239"
              />
            ) : null}
            {canEdit ? (
              <ActionBtn
                title="Görev Ata"
                testID={`project-team-${id}`}
                onPress={onTeam}
                bg={colors.indigo50}
                border="#C7D2FE"
                color="#3730A3"
              />
            ) : null}
          </Row>
        ) : null}
        {canEdit || onCollect ? (
          <Row style={{ flexWrap: "wrap" }}>
            {onCollect ? (
              <ActionBtn
                title="Tahsilat"
                testID={`project-collect-${id}`}
                onPress={onCollect}
                bg={colors.emerald50}
                border="#A7F3D0"
                color="#047857"
              />
            ) : null}
            {canEdit ? (
              <ActionBtn
                title="Takip Linki"
                testID={`project-track-${id}`}
                onPress={onTrack}
                bg={colors.indigo50}
                border="#C7D2FE"
                color="#3730A3"
              />
            ) : null}
            {canEdit && canCompleteProject(project.status) ? (
              <ActionBtn
                title={PROJECT_QUOTE_ACTION}
                testID={`project-quote-${id}`}
                onPress={() => !statusBusy && onStatus("completed")}
                bg={colors.primary}
                color="#fff"
              />
            ) : null}
          </Row>
        ) : null}
      </View>
    </Card>
  );
}

export function ProjectTeamSheet({
  visible,
  project,
  client,
  companyId,
  onClose,
  onSaved,
  onError,
}: {
  visible: boolean;
  project: ProjectDoc | null;
  client: { baseUrl: string; token: string | null };
  companyId: string;
  onClose: () => void;
  onSaved: (id: string, tasks: ProjectTask[]) => void;
  onError: (msg: string) => void;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !project) return;
    let cancelled = false;
    setTasks(projectTaskRows(project.tasks));
    setLocalError(null);
    setLoading(true);
    (async () => {
      try {
        const emps = await get<Employee[]>(client, "/personnel/employees", { company_id: companyId });
        if (!cancelled) setEmployees(emps || []);
      } catch (err) {
        if (!cancelled) {
          setEmployees([]);
          setLocalError(apiErrorMessage(err, "Personel listesi yüklenemedi."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, project, client, companyId]);

  const save = async () => {
    if (!project) return;
    const id = idOf(project);
    const cleaned = cleanProjectTasks(tasks);
    setBusy(true);
    try {
      await put(client, `/projects/${id}`, { tasks: cleaned });
      onSaved(id, cleaned);
    } catch (err) {
      onError(apiErrorMessage(err, "Görevler kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <B2BSheet
      visible={visible}
      title="Görev ata"
      subtitle={project ? `${project.name || "Proje"}${project.project_number ? ` · ${project.project_number}` : ""}` : undefined}
      onClose={onClose}
      testID="project-team-sheet"
    >
      <ErrorBanner message={localError} />
      {loading ? <Muted>Personel yükleniyor…</Muted> : null}
      {tasks.map((t, i) => (
        <View
          key={t.id || `task-${i}`}
          testID={`project-task-row-${i}`}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, marginBottom: 8, backgroundColor: colors.slate50, gap: 8 }}
        >
          <Row style={{ alignItems: "center", gap: 8 }}>
            <Pressable
              testID={`project-task-done-${i}`}
              onPress={() => setTasks((rows) => rows.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
              hitSlop={8}
            >
              <Ionicons name={t.done ? "checkbox" : "square-outline"} size={22} color={t.done ? colors.primary : colors.muted} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Field
                dense
                label="Görev"
                testID={`project-task-title-${i}`}
                value={t.title || ""}
                onChangeText={(title) => setTasks((rows) => rows.map((x, j) => (j === i ? { ...x, title } : x)))}
                placeholder="Keşif, montaj…"
              />
            </View>
            <Pressable
              testID={`project-task-del-${i}`}
              onPress={() => setTasks((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : [emptyProjectTask()]))}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </Row>
          <GroupedSelect
            dense
            label="Personel"
            testID={`project-task-assignee-${i}`}
            value={t.assignee_id || ""}
            onChange={(v) => setTasks((rows) => rows.map((x, j) => (j === i ? applyTaskAssignee(x, employees, v) : x)))}
            groups={assigneeSelectGroups(employees)}
            emptyLabel="Personel seçin"
          />
        </View>
      ))}
      <Pressable
        testID="project-task-add"
        onPress={() => setTasks((rows) => [...rows, emptyProjectTask()])}
        style={{ minHeight: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#C7D2FE", backgroundColor: colors.indigo50, marginBottom: 10 }}
      >
        <Text style={{ fontWeight: "800", color: "#3730A3", fontSize: 13 }}>Görev ekle</Text>
      </Pressable>
      <PrimaryButton title="Dağılımı Kaydet" testID="project-team-save" color={colors.indigo} loading={busy} onPress={save} />
    </B2BSheet>
  );
}

function shareOrCopy(value: string) {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(value).catch(() => Share.share({ message: value }));
    return;
  }
  Share.share({ message: value }).catch(() => null);
}

export function ProjectTrackSheet({
  visible,
  project,
  client,
  baseUrl,
  onClose,
  onMinted,
  onError,
}: {
  visible: boolean;
  project: ProjectDoc | null;
  client: { baseUrl: string; token: string | null };
  baseUrl: string;
  onClose: () => void;
  onMinted: (id: string, tracking: ProjectDoc["tracking"]) => void;
  onError: (msg: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [flags, setFlags] = useState(defaultApprovalFlags("", ""));
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<ProjectTrackingResult | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPhone("");
    setEmail("");
    setFlags(defaultApprovalFlags("", ""));
    setLocalError(null);
    setResult(null);
  }, [visible, project]);

  const origin = approvalPublicOrigin(normalizeApiBase(baseUrl), project?.tracking?.link);
  const link = trackingAbsoluteLink(project?.tracking, result, baseUrl);

  const send = async (channels: string[]) => {
    if (!project) return;
    if (channels.length) {
      const invalid = validateApprovalSend(channels, phone, email);
      if (invalid) { setLocalError(invalid); return; }
    }
    const id = idOf(project);
    setBusy(true);
    try {
      const res = await post<ProjectTrackingResult>(client, `/projects/${id}/send-tracking`, projectTrackingPayload(channels, phone, email, origin));
      setResult(res);
      onMinted(id, {
        ...(project.tracking || {}),
        token: res.token,
        link: res.link,
        sent_count: (project.tracking?.sent_count || 0) + (channels.length ? 1 : 0),
      });
      setLocalError(null);
    } catch (err) {
      onError(apiErrorMessage(err, "Takip linki oluşturulamadı."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <B2BSheet
      visible={visible}
      title="Takip linki"
      subtitle={project ? `${project.contact_name || "Müşteri"} · giriş gerektirmez` : undefined}
      onClose={onClose}
      testID="project-track-sheet"
    >
      <ErrorBanner message={localError} />
      <Muted>SMS, WhatsApp veya e-posta ile gönderin; ya da yalnız link üretin. Aşama fotoğrafları müşteri sayfasında “Yapılan işler” olarak görünür.</Muted>
      <Row style={{ flexWrap: "wrap", gap: 6, marginVertical: 8 }}>
        {(["sms", "email", "whatsapp"] as const).map((k) => (
          <Chip
            key={k}
            compact
            label={k === "sms" ? "SMS" : k === "email" ? "E-posta" : "WhatsApp"}
            active={!!flags[k]}
            onPress={() => setFlags((f) => ({ ...f, [k]: !f[k] }))}
            testID={`track-ch-${k}`}
          />
        ))}
      </Row>
      <Field dense label="Telefon" testID="track-phone" value={phone} onChangeText={setPhone} placeholder="05XX…" keyboardType="phone-pad" />
      <Field dense label="E-posta" testID="track-email" value={email} onChangeText={setEmail} placeholder="musteri@firma.com" autoCapitalize="none" keyboardType="email-address" />
      {link ? (
        <View testID="track-result" style={{ backgroundColor: colors.slate50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10, marginVertical: 8, gap: 6 }}>
          <Muted>Takip linki</Muted>
          <Text testID="track-link" selectable style={{ fontWeight: "700", color: colors.primaryHover, fontSize: 12 }}>{link}</Text>
          <Row style={{ gap: 8 }}>
            <ActionBtn title="Paylaş" testID="track-share" onPress={() => shareOrCopy(trackingShareMessage(project || {}, link))} bg={colors.emerald50} border="#A7F3D0" color="#047857" />
            <ActionBtn title="Aç" testID="track-preview" onPress={() => Linking.openURL(link).catch(() => null)} bg="#fff" border={colors.border} color={colors.text} />
          </Row>
          {result?.results
            ? Object.entries(result.results).map(([k, v]) => (
              <Muted key={k}>{k}: {channelResultLabel(v.status)}{v.detail ? ` · ${v.detail}` : ""}</Muted>
            ))
            : null}
        </View>
      ) : null}
      <Row style={{ gap: 8, marginTop: 8 }}>
        <View style={{ flex: 1 }}>
          <PrimaryButton title="Sadece link üret" testID="track-mint" color={colors.slate800} loading={busy} onPress={() => send([])} />
        </View>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            title={(project?.tracking?.sent_count || 0) > 0 ? "Tekrar Gönder" : "Gönder"}
            testID="track-send"
            color={colors.primary}
            loading={busy}
            onPress={() => send(approvalChannels(flags))}
          />
        </View>
      </Row>
    </B2BSheet>
  );
}

/** Proje listesi / cari Proje sekmesi — kartlar + görev / takip / önizleme. */
export function ProjectCardsHost({
  projects,
  stages,
  canEdit,
  canExp,
  canQuote,
  client,
  companyId,
  baseUrl,
  onPatch,
  onError,
  onCollect,
}: {
  projects: ProjectDoc[];
  stages: ProjectStage[];
  canEdit: boolean;
  canExp: boolean;
  canQuote: boolean;
  client: { baseUrl: string; token: string | null };
  companyId: string;
  baseUrl: string;
  onPatch: (id: string, patch: Partial<ProjectDoc>) => void;
  onError: (msg: string) => void;
  onCollect?: (project: ProjectDoc) => void;
}) {
  const [teamProject, setTeamProject] = useState<ProjectDoc | null>(null);
  const [trackProject, setTrackProject] = useState<ProjectDoc | null>(null);
  const [previewProject, setPreviewProject] = useState<ProjectDoc | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const applyPatch = (id: string, patch: Partial<ProjectDoc>) => {
    onPatch(id, patch);
    setTeamProject((cur) => (cur && idOf(cur) === id ? { ...cur, ...patch } : cur));
    setTrackProject((cur) => (cur && idOf(cur) === id ? { ...cur, ...patch } : cur));
  };

  const setProjectStatus = async (id: string, status: string) => {
    const current = projects.find((p) => idOf(p) === id);
    if (!current || current.status === status || statusBusyId) return;
    setStatusBusyId(id);
    try {
      await put(client, `/projects/${id}`, { status });
      applyPatch(id, { status });
    } catch (err) {
      onError(apiErrorMessage(err, "Aşama güncellenemedi."));
    } finally {
      setStatusBusyId(null);
    }
  };

  return (
    <>
      {projects.map((project) => {
        const id = idOf(project);
        return (
          <ProjectCard
            key={id}
            project={project}
            stages={stages}
            canEdit={canEdit}
            canExp={canExp}
            canQuote={canQuote}
            statusBusy={statusBusyId === id}
            onStatus={(status) => setProjectStatus(id, status)}
            onTeam={() => setTeamProject(project)}
            onTrack={() => setTrackProject(project)}
            onCollect={onCollect ? () => onCollect(project) : undefined}
            onPhotos={(pid, patch) => applyPatch(pid, patch)}
            onPreview={() => setPreviewProject(project)}
          />
        );
      })}
      <ProjectTeamSheet
        visible={!!teamProject}
        project={teamProject}
        client={client}
        companyId={companyId}
        onClose={() => setTeamProject(null)}
        onSaved={(id, tasks) => {
          applyPatch(id, { tasks });
          setTeamProject(null);
        }}
        onError={onError}
      />
      <ProjectTrackSheet
        visible={!!trackProject}
        project={trackProject}
        client={client}
        baseUrl={baseUrl}
        onClose={() => setTrackProject(null)}
        onMinted={(id, tracking) => applyPatch(id, { tracking })}
        onError={onError}
      />
      <B2BSheet
        visible={!!previewProject}
        title="Yapılan işler"
        subtitle={previewProject ? `${previewProject.contact_name || "Müşteri"} · takip linkinde böyle görünür` : undefined}
        onClose={() => setPreviewProject(null)}
        testID="project-work-preview-sheet"
      >
        {previewProject ? (
          <ProjectWorkPreview
            project={projects.find((p) => idOf(p) === idOf(previewProject)) || previewProject}
            stages={stages}
          />
        ) : null}
      </B2BSheet>
    </>
  );
}
